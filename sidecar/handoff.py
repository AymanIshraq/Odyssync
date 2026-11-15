"""Native handoff operations. Electron alone decides when a tab may close."""

from contextlib import contextmanager
import ctypes
import os
from pathlib import Path
import subprocess
import sys
import threading
import time
from urllib.parse import urlsplit

from sidecar.windows import browser_for_window
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
    for field in ("x", "y", "width", "height"):
        if type(message.get(field)) is not int:
            raise ValueError(f"{field} must be an integer physical-pixel coordinate")
    if message["width"] <= 0 or message["height"] <= 0:
        raise ValueError("Window dimensions must be positive")


def find_browser(browser):
    import winreg
    executable = {"chrome": "chrome.exe", "msedge": "msedge.exe", "brave": "brave.exe"}[browser]
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


class WindowController:
    def __init__(self):
        import win32api
        import win32gui
        self.gui = win32gui
        self.api = win32api
        self.hidden = {}
        self.lock = threading.RLock()

    def work_area(self):
        monitor = self.api.MonitorFromPoint((0, 0), 1)
        return self.api.GetMonitorInfo(monitor)["Work"]

    def require_browser(self, hwnd):
        if type(hwnd) is not int or not self.gui.IsWindow(hwnd) or not browser_for_window(hwnd):
            raise ValueError("Window handle is not a live supported browser")

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
            except OSError:
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
                return {"type": "WINDOW_PLACED", "transferId": message["transferId"], "hwnd": hwnd}
            stopped.wait(0.05)
        raise TimeoutError("No new browser window appeared within 4 seconds, or bridge disconnected")
