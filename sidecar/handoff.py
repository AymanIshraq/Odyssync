"""Native handoff operations. Electron alone decides when a tab may close."""

from contextlib import contextmanager
import ctypes
import ntpath
import os
from pathlib import Path
import subprocess
import sys
import threading
import time
from urllib.parse import urlsplit

from sidecar.drag import is_new_tab_url, new_tab_url


@contextmanager
def browser_launch_environment():
    """Do not pass the frozen helper's DLL search path to an installed browser."""
    if not getattr(sys, "frozen", False):
        yield
        return
    bundle = os.path.normcase(os.path.abspath(sys._MEIPASS))
    original_path = os.environ.get("PATH", "")
    ctypes.windll.kernel32.SetDllDirectoryW(None)
    try:
        # UI Automation may add its bundled bin directory to PATH as well.
        os.environ["PATH"] = os.pathsep.join(
            entry for entry in original_path.split(os.pathsep)
            if not (os.path.normcase(os.path.abspath(entry.strip('"'))) == bundle
                    or os.path.normcase(os.path.abspath(entry.strip('"'))).startswith(bundle + os.sep)))
        yield
    finally:
        os.environ["PATH"] = original_path
        ctypes.windll.kernel32.SetDllDirectoryW(sys._MEIPASS)
from sidecar.documents import EDITOR_APPS, is_regular_file, title_mentions
from sidecar.drag import NOT_DOCUMENT_CLASSES
from sidecar.windows import browser_for_window, process_exe, window_process

# A lone new window whose title does not name the file is accepted only after
# this long, so an interim startup window is not mistaken for the document.
OPEN_FILE_GRACE_SECONDS = 1.5
DOCUMENT_APPS = frozenset({*EDITOR_APPS, "notepad.exe", "winword.exe", "excel.exe", "powerpnt.exe"})
OFFICE_EXTENSIONS = {
    "winword.exe": {".doc", ".docx", ".rtf", ".odt", ".txt"},
    "excel.exe": {".xls", ".xlsx", ".csv", ".ods"},
    "powerpnt.exe": {".ppt", ".pptx", ".odp"},
}


def clamp_rect(x, y, width, height, work_area):
    left, top, right, bottom = work_area
    width = min(max(1, width), right - left)
    height = min(max(1, height), bottom - top)
    return (max(left, min(x, right - width)), max(top, min(y, bottom - height)), width, height)


def bounce_target(rect, edge, work_area):
    left, top, right, bottom = rect
    area_left, area_top, area_right, area_bottom = work_area
    width, height = right - left, bottom - top
    if edge == "LEFT":
        left = max(left + 180, area_left + 180)
    elif edge == "RIGHT":
        left = min(left - 180, area_right - width - 180)
    elif edge == "TOP":
        top = max(top + 180, area_top + 180)
    elif edge == "BOTTOM":
        top = min(top - 180, area_bottom - height - 180)
    else:
        raise ValueError("Unknown bounce edge")
    return clamp_rect(left, top, width, height, work_area)


def validate_open(message):
    if not isinstance(message.get("transferId"), str) or not message["transferId"]:
        raise ValueError("OPEN_URL requires a transferId")
    url = message.get("url")
    if (not isinstance(url, str) or not url or any(ord(c) < 32 for c in url)
            or urlsplit(url).scheme.lower() not in ("http", "https", "chrome", "edge", "brave", "about", "file")):
        raise ValueError("OPEN_URL requires a browser URL with a supported scheme")
    if message.get("browser") not in ("chrome", "msedge", "brave"):
        raise ValueError("Unknown browser")
    validate_rect(message)


def validate_rect(message):
    for field in ("x", "y", "width", "height"):
        if type(message.get(field)) is not int:
            raise ValueError(f"{field} must be an integer physical-pixel coordinate")
    if message["width"] <= 0 or message["height"] <= 0:
        raise ValueError("Window dimensions must be positive")


def validate_open_file(message, is_file=is_regular_file):
    if not isinstance(message.get("transferId"), str) or not message["transferId"]:
        raise ValueError("OPEN_FILE requires a transferId")
    path = message.get("path")
    if (not isinstance(path, str) or not path or any(ord(c) < 32 for c in path)
            or not os.path.isabs(path) or not is_file(path)):
        raise ValueError("OPEN_FILE requires an absolute path to an existing regular file")
    app = message.get("app")  # Absent or null: the file's default program.
    if app is not None and (not isinstance(app, str) or app not in DOCUMENT_APPS):
        raise ValueError("OPEN_FILE app must be a supported document application")
    if app in OFFICE_EXTENSIONS and Path(path).suffix.lower() not in OFFICE_EXTENSIONS[app]:
        raise ValueError("This file type cannot be automatically opened in that Office application")
    expires = message.get("expiresAt")
    if expires is not None and (type(expires) not in (int, float) or not 0 < expires < float('inf')):
        raise ValueError("OPEN_FILE expiry must be a finite timestamp")
    validate_rect(message)


def choose_opened_window(before, after, name, grace_elapsed):
    """Which window shows a file just opened: (status, hwnd).

    `before` maps every top-level handle to its title before launch; `after`
    maps eligible visible windows now. status is "new" (place it), "existing"
    (a reused window that now names the file; leave it where the user put it),
    "wait", or "ambiguous" (keep waiting, fail if it never resolves).
    """
    new = [hwnd for hwnd in after if hwnd not in before]
    named = [hwnd for hwnd in new if title_mentions(after[hwnd], name)]
    gained = [hwnd for hwnd in after if hwnd in before and title_mentions(after[hwnd], name)
              and not title_mentions(before[hwnd], name)]
    if len(named) == 1:
        return "new", named[0]
    if len(named) > 1 or len(gained) > 1:
        return "ambiguous", None
    if gained:
        return "existing", gained[0]
    if len(new) > 1:
        return "ambiguous", None
    if new and grace_elapsed:
        return "new", new[0]
    return "wait", None


class DocumentWindows:
    """Window handles this sidecar itself qualified as document drags.

    Own lock: the poll loop adds handles and must never wait for a window command.
    """

    def __init__(self, limit=32):
        self.limit = limit
        self.handles = []
        self.lock = threading.Lock()

    def add(self, hwnd):
        with self.lock:
            if hwnd in self.handles:
                self.handles.remove(hwnd)
            self.handles.append(hwnd)
            del self.handles[:-self.limit]

    def allows(self, hwnd, is_window):
        with self.lock:
            self.handles = [handle for handle in self.handles if is_window(handle)]
            return hwnd in self.handles


def find_browser(browser):
    executable = {"chrome": "chrome.exe", "msedge": "msedge.exe", "brave": "brave.exe"}[browser]
    return registry_app_path(executable)


def registry_app_path(executable):
    """The program registered in App Paths for this exe name, or None."""
    import winreg
    key_path = "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\" + executable
    for hive in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
        for view in (winreg.KEY_WOW64_64KEY, winreg.KEY_WOW64_32KEY):
            try:
                with winreg.OpenKey(hive, key_path, 0, winreg.KEY_READ | view) as key:
                    value, _ = winreg.QueryValueEx(key, None)
                    path = os.path.expandvars(value.strip('"'))
                    if Path(path).is_file():
                        return path
            except OSError:
                continue
    return None


def editor_install_path(app, environ, exists):
    """The first existing usual install location of an editor, or None.

    User installs go to %LOCALAPPDATA%\\Programs, system installs to %ProgramFiles%.
    """
    for variable, folder in (("LOCALAPPDATA", "Programs"), ("ProgramFiles", "")):
        root = environ.get(variable)
        if not root:
            continue  # Never fall back to a relative path.
        path = ntpath.join(root, folder, EDITOR_APPS[app])
        if exists(path):
            return path
    return None


def find_editor(app):
    return registry_app_path(app) or editor_install_path(app, os.environ, lambda path: Path(path).is_file())


class WindowController:
    def __init__(self):
        import win32api
        import win32gui
        self.gui = win32gui
        self.api = win32api
        self.hidden = {}
        self.lock = threading.RLock()
        self.documents = DocumentWindows()

    def work_area(self):
        monitor = self.api.MonitorFromPoint((0, 0), 1)
        return self.api.GetMonitorInfo(monitor)["Work"]

    def require_browser(self, hwnd):
        """A live browser, or a document window this sidecar qualified for a drag.

        A window we hid always passes, so restoring it can never be refused.
        """
        if type(hwnd) is not int or not self.gui.IsWindow(hwnd):
            raise ValueError("Window handle is not a live supported browser")
        if (hwnd not in self.hidden and not self.documents.allows(hwnd, self.gui.IsWindow)
                and not browser_for_window(hwnd)):
            raise ValueError("Window handle is not a live supported browser or dragged document")

    def place(self, hwnd, rect):
        # NOZORDER | NOACTIVATE: placement must not explicitly steal focus.
        self.gui.SetWindowPos(hwnd, 0, *clamp_rect(*rect, self.work_area()), 0x0004 | 0x0010)

    def hide(self, hwnd):
        with self.lock:
            self.require_browser(hwnd)
            if hwnd not in self.hidden:
                self.hidden[hwnd] = self.gui.GetWindowRect(hwnd)
            self.gui.ShowWindow(hwnd, 0)  # SW_HIDE

    def show(self, hwnd):
        with self.lock:
            self.require_browser(hwnd)
            left, top, right, bottom = self.hidden.get(hwnd, self.gui.GetWindowRect(hwnd))
            self.gui.ShowWindow(hwnd, 4)  # SW_SHOWNOACTIVATE
            self.place(hwnd, (left, top, right - left, bottom - top))
            self.hidden.pop(hwnd, None)

    def close(self, hwnd):
        with self.lock:
            self.require_browser(hwnd)
            self.gui.PostMessage(hwnd, 0x0010, 0, 0)  # WM_CLOSE; browser can veto
            if hwnd not in self.hidden:
                return
        # Slow successful closes must stay hidden. Do not hold the controller
        # lock while waiting: a different window may need to hide immediately.
        deadline = time.monotonic() + 2.0
        while self.gui.IsWindow(hwnd):
            if time.monotonic() >= deadline:
                self.show(hwnd)  # A real browser veto still needs a visible recovery path.
                return
            time.sleep(0.025)
        with self.lock:
            self.hidden.pop(hwnd, None)

    def bounce(self, hwnd, edge, stopped):
        self.require_browser(hwnd)
        rect = self.gui.GetWindowRect(hwnd)
        target = bounce_target(rect, edge, self.work_area())
        start = (rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1])
        started = time.monotonic()
        while not stopped.is_set():
            progress = min(1.0, (time.monotonic() - started) / 0.3)
            eased = 1 - (1 - progress) ** 3
            current = tuple(round(a + (b - a) * eased) for a, b in zip(start, target))
            # Intermediate positions may be off-screen: clamping each frame
            # would jump immediately to the bezel instead of animating back.
            self.gui.SetWindowPos(hwnd, 0, *current, 0x0004 | 0x0010)
            if progress >= 1:
                return
            stopped.wait(0.016)
        self.place(hwnd, target)  # Never leave it stranded after disconnect.

    def restore_hidden(self):
        import logging
        with self.lock:
            for hwnd in list(self.hidden):
                try:
                    if self.gui.IsWindow(hwnd):
                        self.show(hwnd)
                    else:
                        self.hidden.pop(hwnd, None)
                except Exception:
                    logging.getLogger(__name__).exception("Could not restore hidden window %s", hwnd)

    def window_handles(self, *, visible_only=False):
        """Record Chromium-class handles without relying on process lookup."""
        handles = set()

        def visit(hwnd, _):
            if (self.gui.GetClassName(hwnd) == "Chrome_WidgetWin_1"
                    and (not visible_only or self.gui.IsWindowVisible(hwnd))):
                handles.add(hwnd)

        self.gui.EnumWindows(visit, None)
        return handles

    def browser_windows(self):
        windows = {}
        for hwnd in self.window_handles(visible_only=True):
            try:
                browser = browser_for_window(hwnd)
                if browser:
                    windows[hwnd] = browser
            except (OSError, ValueError):
                pass  # Window may disappear during enumeration.
        return windows

    def launch(self, url, executable):
        with browser_launch_environment():
            if executable:
                subprocess.Popen([executable, "--new-window", url], shell=False)
            else:
                os.startfile(url)

    def open_url(self, message, stopped):
        """Serialized on the command worker. Never claim success for an old window."""
        validate_open(message)
        # A preexisting hidden source may be restored while this launch is
        # pending. Visibility changes must never count as a new destination.
        before = self.window_handles()
        target_browser = message["browser"]
        executable = find_browser(target_browser)
        url = message["url"]
        if is_new_tab_url(url):
            # Internal schemes are not Windows URL handlers. If the sender's
            # browser is absent, open the receiver browser's own new-tab page.
            if not executable:
                for candidate in ("chrome", "msedge", "brave"):
                    if candidate == target_browser:
                        continue
                    executable = find_browser(candidate)
                    if executable:
                        target_browser = candidate
                        break
            if not executable:
                raise OSError("No supported browser is installed to open a new tab")
            url = new_tab_url(target_browser)
        if stopped.is_set():
            raise RuntimeError("Bridge disconnected before browser launch")
        remaining = 4.0
        if "expiresAt" in message:
            remaining = min(remaining, (message["expiresAt"] - time.time() * 1000) / 1000)
            if remaining <= 0:
                raise TimeoutError("Open command expired in the queue; no browser was launched")
        self.launch(url, executable)
        deadline = time.monotonic() + remaining
        while time.monotonic() < deadline and not stopped.is_set():
            candidates = {hwnd: browser for hwnd, browser in self.browser_windows().items()
                          if hwnd not in before and (not executable or browser == target_browser)}
            if len(candidates) > 1:
                raise RuntimeError("Ambiguous new browser windows; refusing to place an unrelated window")
            if candidates:
                hwnd = next(iter(candidates))
                self.place(hwnd, tuple(message[field] for field in ("x", "y", "width", "height")))
                # First place on the receiver's primary monitor, then maximize.
                # Source restore/bounce keep their original window dimensions.
                self.gui.ShowWindow(hwnd, 3)  # SW_SHOWMAXIMIZED
                return {"type": "WINDOW_PLACED", "transferId": message["transferId"], "hwnd": hwnd}
            stopped.wait(0.05)
        raise TimeoutError("No new browser window appeared within 4 seconds, or bridge disconnected")

    def titled_windows(self, *, everything=False):
        """Handle -> title. Unless `everything`, only windows that could show a document."""
        windows = {}

        def visit(hwnd, _):
            try:
                if everything:
                    windows[hwnd] = self.gui.GetWindowText(hwnd)
                    return
                if not self.gui.IsWindowVisible(hwnd):
                    return
                title = self.gui.GetWindowText(hwnd)
                class_name = self.gui.GetClassName(hwnd)
                left, top, right, bottom = self.gui.GetWindowRect(hwnd)
                if (not title or class_name in NOT_DOCUMENT_CLASSES or right <= left or bottom <= top
                        or self.gui.GetWindowLong(hwnd, -20) & 0x80):  # GWL_EXSTYLE, WS_EX_TOOLWINDOW
                    return
                if class_name == "Chrome_WidgetWin_1" and self.is_own_app(hwnd):
                    return
                windows[hwnd] = title
            except Exception:
                pass  # Window vanished during enumeration.

        self.gui.EnumWindows(visit, None)
        return windows

    def is_own_app(self, hwnd):
        handle = window_process(hwnd)
        try:
            return process_exe(handle) in ("electron.exe", "odyssync.exe")
        finally:
            handle.Close()

    def launch_file(self, path):
        try:
            with browser_launch_environment():
                os.startfile(path)  # The file's default program.
        except OSError as error:
            # The original message contains the path; replies and logs must not.
            code = getattr(error, "winerror", None) or error.errno
            raise OSError(f"Could not open the file with its default program (error {code})") from None

    def launch_editor(self, app, path):
        executable = find_editor(app)
        if not executable:
            raise FileNotFoundError("editor not installed")
        try:
            with browser_launch_environment():
                environment = os.environ.copy()
                environment.pop("ELECTRON_RUN_AS_NODE", None)
                subprocess.Popen([executable, "--new-window", path], shell=False, env=environment)
        except OSError as error:
            code = getattr(error, "winerror", None) or error.errno
            raise OSError(f"Could not start the editor (error {code})") from None

    def launch_document(self, app, path):
        """Only fixed, supported programs; never execute a received file itself."""
        if app in EDITOR_APPS:
            return self.launch_editor(app, path)
        executable = registry_app_path(app)
        if not executable and app == "notepad.exe":
            executable = str(Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32" / "notepad.exe")
        if not executable:
            raise FileNotFoundError("The sender's document application is not installed here")
        # Separate instances make Office startup/window matching deterministic.
        switches = {"winword.exe": ["/n"], "excel.exe": ["/x"]}.get(app, [])
        with browser_launch_environment():
            subprocess.Popen([executable, *switches, path], shell=False)

    def document_windows(self, app):
        windows = self.titled_windows()
        if not app:
            return windows
        matched = {}
        for hwnd, title in windows.items():
            try:
                handle = window_process(hwnd)
                try:
                    if process_exe(handle) == app:
                        matched[hwnd] = title
                finally:
                    handle.Close()
            except Exception:
                continue
        return matched

    def open_file(self, message, stopped):
        """Serialized on the command worker, like open_url."""
        validate_open_file(message)
        path = message["path"]
        expires = message.get("expiresAt")
        remaining = min(20, (expires / 1000 - time.time())) if expires is not None else 20
        if remaining <= 0:
            raise TimeoutError("Document transfer expired before opening")
        # Hidden handles count as old: a restored hidden window is never "new".
        before = self.titled_windows(everything=True)
        if stopped.is_set():
            raise RuntimeError("Bridge disconnected before opening the file")
        if message.get("app") is None:
            self.launch_file(path)
        else:
            self.launch_document(message["app"], path)
        started = time.monotonic()
        deadline = started + remaining
        ambiguous = False
        while not stopped.is_set():
            now = time.monotonic()
            if now >= deadline:
                break
            status, hwnd = choose_opened_window(before, self.document_windows(message.get("app")), ntpath.basename(path),
                                                not message.get("app") and now - started >= OPEN_FILE_GRACE_SECONDS)
            ambiguous = status == "ambiguous"
            if status in ("new", "existing"):
                if status == "new":
                    self.place(hwnd, tuple(message[field] for field in ("x", "y", "width", "height")))
                # Match 0.1.4 browser arrivals, including a reused Notepad window.
                self.gui.ShowWindow(hwnd, 3)  # SW_SHOWMAXIMIZED
                return {"type": "WINDOW_PLACED", "transferId": message["transferId"], "hwnd": hwnd}
            stopped.wait(0.05)
        if ambiguous:
            raise RuntimeError("Several windows could show the opened file; refusing to guess")
        raise TimeoutError("No window showing the file appeared before the deadline, or bridge disconnected")
