"""Read-only Windows access. UI Automation controls never cross threads."""

import ctypes
from ctypes import wintypes
import logging
from pathlib import PureWindowsPath
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


def browser_for_window(hwnd: int) -> str:
    import win32api
    import win32process
    _, pid = win32process.GetWindowThreadProcessId(hwnd)
    handle = win32api.OpenProcess(0x1000, False, pid)  # QUERY_LIMITED_INFORMATION
    try:
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        query = kernel.QueryFullProcessImageNameW
        query.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR,
                          ctypes.POINTER(wintypes.DWORD)]
        query.restype = wintypes.BOOL
        size = wintypes.DWORD(32768)
        path = ctypes.create_unicode_buffer(size.value)
        if not query(int(handle), 0, path, ctypes.byref(size)):
            raise ctypes.WinError(ctypes.get_last_error())
        return {"chrome.exe": "chrome", "msedge.exe": "msedge",
                "brave.exe": "brave"}.get(PureWindowsPath(path.value).name.lower(), "")
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
        raise ValueError("Foreground window is not Chrome, Edge, or Brave")
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
