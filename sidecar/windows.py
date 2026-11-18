"""Read-only Windows access. UI Automation controls never cross threads."""

import ctypes
from ctypes import wintypes
import logging
from pathlib import PureWindowsPath
import re
import time

from sidecar.drag import Sample, is_new_tab_url, new_tab_url, normalize_url

log = logging.getLogger(__name__)


def enable_dpi_awareness():
    result = ctypes.windll.shcore.SetProcessDpiAwareness(2)
    if result not in (0, -2147024891):  # E_ACCESSDENIED means already configured.
        raise OSError(f"SetProcessDpiAwareness failed: {result}")


class WindowsDesktop:
    def __init__(self):
        import win32api
        import win32gui
        self.api = win32api
        self.gui = win32gui
        self.last_browser = None
        self.last_explorer = None
        self.previous_foreground = None
        self.listed = {}  # {hwnd: pid} from the last LIST_OPEN_WINDOWS reply.

    def screen_info(self):
        monitor = self.api.MonitorFromPoint((0, 0), 1)
        dpi_x, dpi_y = wintypes.UINT(), wintypes.UINT()
        get_dpi = ctypes.windll.shcore.GetDpiForMonitor
        get_dpi.argtypes = [wintypes.HANDLE, ctypes.c_int,
                            ctypes.POINTER(wintypes.UINT), ctypes.POINTER(wintypes.UINT)]
        get_dpi.restype = ctypes.c_long
        result = get_dpi(
            int(monitor), 0, ctypes.byref(dpi_x), ctypes.byref(dpi_y))
        if result != 0:
            raise OSError(f"GetDpiForMonitor failed: {result}")
        return {"screenWidth": self.api.GetSystemMetrics(0),
                "screenHeight": self.api.GetSystemMetrics(1), "dpiScale": dpi_x.value / 96}

    def sample(self):
        hwnd = self.gui.GetForegroundWindow()
        class_name = self.gui.GetClassName(hwnd) if hwnd else ""
        if hwnd != self.previous_foreground:
            self.previous_foreground = hwnd
            if class_name in ("Chrome_WidgetWin_1", "CabinetWClass"):
                import win32process
                try:
                    _, pid = win32process.GetWindowThreadProcessId(hwnd)
                    if class_name == "CabinetWClass":
                        self.last_explorer = (hwnd, pid)
                    elif browser_for_window(hwnd):
                        self.last_browser = (hwnd, pid)
                except Exception:
                    log.debug("Foreground window vanished during lookup", exc_info=True)
        return Sample(hwnd, class_name == "Chrome_WidgetWin_1",
                      self.gui.GetWindowRect(hwnd) if hwnd else (0, 0, 0, 0),
                      self.gui.GetCursorPos(), bool(self.api.GetAsyncKeyState(1) & 0x8000),
                      time.monotonic(), class_name)

    def remembered_window(self, browser):
        import win32process
        remembered = self.last_browser if browser else self.last_explorer
        error = "No browser tab is open" if browser else "No file is selected in File Explorer"
        if remembered is None:
            raise ValueError(error)
        hwnd, pid = remembered
        expected_class = "Chrome_WidgetWin_1" if browser else "CabinetWClass"
        if (not self.gui.IsWindow(hwnd) or self.gui.GetClassName(hwnd) != expected_class
                or win32process.GetWindowThreadProcessId(hwnd)[1] != pid):
            raise ValueError(error)
        return hwnd

    def open_windows(self):
        """Every sendable top-level window, topmost first. Titles and exe names only."""
        from sidecar.documents import NOT_DOCUMENT_APPS
        gui = self.gui
        hwnds = []
        gui.EnumWindows(lambda hwnd, _: hwnds.append(hwnd), None)

        def infos():
            for hwnd in hwnds:
                try:
                    yield {"hwnd": hwnd, "visible": gui.IsWindowVisible(hwnd), "cloaked": is_cloaked(hwnd),
                           "exStyle": gui.GetWindowLong(hwnd, GWL_EXSTYLE), "owner": gui.GetWindow(hwnd, GW_OWNER),
                           "title": gui.GetWindowText(hwnd), "className": gui.GetClassName(hwnd)}
                except Exception:
                    continue  # The window closed while we looked at it.

        from sidecar.documents import EDITOR_APPS, OFFICE_APPS
        windows = sendable_windows(infos(), process_info, NOT_DOCUMENT_APPS,
                                   document_apps=set(OFFICE_APPS) | set(EDITOR_APPS))
        self.listed = {window["hwnd"]: window["pid"] for window in windows}
        return windows

    def listed_window(self, hwnd):
        """Class name of the picked window, only if it was offered and is still the same program."""
        if type(hwnd) is not int or hwnd not in self.listed:
            raise ValueError("That window is not in the open windows list")
        try:
            if self.gui.IsWindow(hwnd) and window_pid(hwnd) == self.listed[hwnd]:
                return self.gui.GetClassName(hwnd)
        except Exception:
            pass
        raise ValueError("That window was closed")


GWL_EXSTYLE = -20
GW_OWNER = 4
WS_EX_TOOLWINDOW = 0x80
SHELL_CLASSES = frozenset({"Shell_TrayWnd", "Progman", "WorkerW", "Windows.UI.Core.CoreWindow",
                           "ApplicationFrameWindow"})
BROWSER_EXES = {"chrome.exe": "chrome", "msedge.exe": "msedge", "brave.exe": "brave"}
OPEN_WINDOWS_LIMIT = 30
FILE_NAME_IN_TITLE = re.compile(r"[^\\/:*?\"<>|\s][^\\/:*?\"<>|]*\.[A-Za-z0-9]{1,5}\b")


def sendable_windows(infos, process_info, not_apps, limit=OPEN_WINDOWS_LIMIT, document_apps=frozenset()):
    """Pure filter. infos: dicts in EnumWindows order; process_info(hwnd) -> (pid, exe)."""
    windows = []
    for info in infos:
        if (not info["visible"] or info["cloaked"] or info["exStyle"] & WS_EX_TOOLWINDOW
                or info["owner"] or not info["title"].strip() or info["className"] in SHELL_CLASSES):
            continue
        try:
            pid, exe = process_info(info["hwnd"])
        except Exception:
            continue  # Closed, or a protected process we may not inspect.
        if exe in BROWSER_EXES:
            kind = "browser"
        elif info["className"] == "CabinetWClass":
            kind = "explorer"
        elif exe and exe not in not_apps and (
                exe in document_apps or exe == "notepad.exe" or FILE_NAME_IN_TITLE.search(info["title"])):
            kind = "app"
        else:
            continue
        windows.append({"hwnd": info["hwnd"], "pid": pid, "kind": kind, "app": exe, "title": info["title"]})
        if len(windows) >= limit:
            break
    return windows


def is_cloaked(hwnd: int) -> bool:
    """Hidden by DWM (other virtual desktop, suspended Store app). Failure means not cloaked."""
    try:
        value = ctypes.c_int(0)
        result = ctypes.windll.dwmapi.DwmGetWindowAttribute(
            wintypes.HWND(hwnd), 14, ctypes.byref(value), ctypes.sizeof(value))  # DWMWA_CLOAKED
        return result == 0 and value.value != 0
    except Exception:
        return False


def window_pid(hwnd: int) -> int:
    import win32process
    return win32process.GetWindowThreadProcessId(hwnd)[1]


def process_info(hwnd: int):
    handle = window_process(hwnd)
    try:
        return window_pid(hwnd), process_exe(handle)
    finally:
        handle.Close()


def window_process(hwnd: int):
    """Handle to the window's process; the caller must Close() it."""
    import win32api
    try:
        pid = window_pid(hwnd)
        if pid:
            return win32api.OpenProcess(0x1000, False, pid)  # QUERY_LIMITED_INFORMATION
    except Exception:
        pass
    raise ValueError("That window was closed")


def process_exe(handle) -> str:
    """Lower-case exe file name of an open process handle, e.g. "chrome.exe"."""
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    query = kernel.QueryFullProcessImageNameW
    query.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR,
                      ctypes.POINTER(wintypes.DWORD)]
    query.restype = wintypes.BOOL
    size = wintypes.DWORD(32768)
    path = ctypes.create_unicode_buffer(size.value)
    if not query(int(handle), 0, path, ctypes.byref(size)):
        raise ctypes.WinError(ctypes.get_last_error())
    return PureWindowsPath(path.value).name.lower()


def browser_for_window(hwnd: int) -> str:
    handle = window_process(hwnd)
    try:
        return BROWSER_EXES.get(process_exe(handle), "")
    finally:
        handle.Close()


def warm_browser_worker():
    """Load UIA/COM before a user starts a timed drag, on the UIA worker."""
    import uiautomation as auto
    with auto.UIAutomationInitializerInThread():
        auto.GetRootControl().GetChildren()


def read_browser_tab(hwnd: int) -> dict:
    """Run on the dedicated worker. Never focus controls or send keystrokes.

    Search browser chrome only: descending into web content could count page
    tab widgets as browser tabs or mistake a form field for the address bar.
    A missing/ambiguous tab count or URL fails closed.
    """
    import uiautomation as auto
    import win32gui
    started = time.monotonic()
    browser = browser_for_window(hwnd)
    if not browser:
        raise ValueError("That window is not Chrome, Edge, or Brave")
    with auto.UIAutomationInitializerInThread():
        root = auto.ControlFromHandle(hwnd)
        tabs, edits, document_urls = [], [], []
        stack = [(root, 0)]
        visited = 0
        while stack:
            control, depth = stack.pop()
            visited += 1
            if visited > 1500 or time.monotonic() - started > 1.0:
                raise TimeoutError("Browser UI Automation traversal exceeded its budget")
            kind = control.ControlTypeName
            if kind == "DocumentControl":
                # Read only the document's own URI. Never traverse page content:
                # a website can contain its own tab widgets and input fields.
                try:
                    document_url = control.GetValuePattern().Value.strip()
                    if document_url:
                        document_urls.append(document_url)
                except Exception:
                    pass
                continue
            if kind == "TabItemControl":
                tabs.append(control)
                continue
            if kind == "EditControl":
                edits.append(control)
            children = control.GetChildren()
            if depth >= 14 and children:
                # Reject incomplete inspection rather than guessing browser state.
                raise ValueError("Browser tab count is incomplete: UI Automation depth limit reached")
            stack.extend((child, depth + 1) for child in reversed(children))
        named = [edit for edit in edits if any(word in edit.Name.lower()
                 for word in ("address", "search bar", "omnibox"))]
        candidates = named or edits
        url = ""
        address_values = []
        for edit in candidates:
            try:
                value = edit.GetValuePattern().Value.strip()
                address_values.append(value)
                url = normalize_url(value, browser)
            except Exception:
                continue
            if url:
                break
        # A readable, genuinely empty omnibox plus a native new-tab document
        # works across languages and decorated tab labels. A failed URL read
        # or unfinished search must not turn an ordinary page into a blank tab.
        if not url and tabs and address_values and not any(address_values):
            native_new_tab = len(document_urls) == 1 and is_new_tab_url(document_urls[0])
            legacy_new_tab = (len(tabs) == 1 and not document_urls and
                              tabs[0].Name.strip().lower() in ("new tab", "new tab page"))
            if native_new_tab or legacy_new_tab:
                url = new_tab_url(browser)
        if not tabs or not url:
            raise ValueError("Could not establish browser tab count and URL")
        result = {"hwnd": hwnd, "browser": browser, "url": url,
                  "title": win32gui.GetWindowText(hwnd), "tabCount": len(tabs)}
    elapsed = (time.monotonic() - started) * 1000
    log.info("Browser qualification: %.1f ms, tabs=%d", elapsed, len(tabs))
    if elapsed > 300:
        log.warning("URL-read spike target missed (%.1f ms > 300 ms)", elapsed)
    return result
