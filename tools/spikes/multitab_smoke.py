"""Test selected-tab handoff with five disposable Chrome tabs on this laptop.

Uses an isolated source profile and distinct example.com URLs. It closes only its own
source and receiver windows; it does not certify a two-laptop network handoff.
"""
from pathlib import Path
import argparse
import json
import subprocess
import sys
import tempfile
import threading
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from sidecar.drag import DragTracker, Sample
from sidecar.handoff import WindowController, find_browser
from sidecar.windows import enable_dpi_awareness, read_browser_tab


def wait_for(check, timeout=8):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            result = check()
            if result:
                return result
        except (ValueError, OSError):
            pass  # Chromium's accessible tree may still be loading.
        time.sleep(.1)
    raise TimeoutError("Native multi-tab check did not reach the expected state")


def select_middle_tab(hwnd):
    import uiautomation as auto

    with auto.UIAutomationInitializerInThread():
        stack = [(auto.ControlFromHandle(hwnd), 0)]
        tabs = []
        while stack:
            control, depth = stack.pop()
            if control.ControlTypeName == "DocumentControl":
                continue
            if control.ControlTypeName == "TabItemControl":
                tabs.append(control)
                continue
            if depth < 14:
                stack.extend((child, depth + 1) for child in reversed(control.GetChildren()))
        if len(tabs) == 5:
            tabs[2].GetSelectionItemPattern().Select()
            return True
    return False


def main():
    import win32process

    enable_dpi_awareness()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--blank", action="store_true", help="Use a blank new tab as the selected middle tab")
    args = parser.parse_args()
    controller = WindowController()
    created = []
    stopped = threading.Event()
    with tempfile.TemporaryDirectory(prefix="odyssync-tabs-", ignore_cleanup_errors=True) as folder:
        root = Path(folder)
        urls = [f"https://example.com/?odyssync-test-tab={number}" for number in range(1, 6)]
        chrome = find_browser("chrome")
        if not chrome:
            raise RuntimeError("Chrome is required for this native smoke test")
        process = subprocess.Popen([chrome, "--user-data-dir=" + str(root / "profile"),
                                    "--no-first-run", "--no-default-browser-check", "--disable-background-mode",
                                    "--new-window", *urls])
        try:
            def source_window():
                return next((hwnd for hwnd in controller.browser_windows()
                             if win32process.GetWindowThreadProcessId(hwnd)[1] == process.pid), None)

            source = wait_for(source_window)
            created.append(source)
            wait_for(lambda: select_middle_tab(source))
            if args.blank:
                # Chrome drops chrome://newtab/ when it appears among command-
                # line URLs. Navigate only this disposable window after launch.
                import uiautomation as auto
                with auto.UIAutomationInitializerInThread():
                    auto.ControlFromHandle(source).SetFocus()
                    assert controller.gui.GetForegroundWindow() == source, "Test window is not focused"
                    auto.SendKeys("{Ctrl}l")
                    auto.SendKeys("chrome://newtab/{Enter}")
                urls[2] = "chrome://newtab/"

            def selected_source():
                info = read_browser_tab(source)
                return info if info["tabCount"] == 5 and info["url"] == urls[2] else None

            tab = wait_for(selected_source)
            tracker = DragTracker()
            tracker.update(Sample(source, True, (100, 100, 1000, 750), (200, 110), True, 1), (1920, 1200), {"RIGHT"})
            _, request = tracker.update(Sample(source, True, (110, 100, 1010, 750), (210, 110), True, 1.016),
                                        (1920, 1200), {"RIGHT"})
            assert tracker.qualify(request[0], tab)["url"] == urls[2]
            # A rejected/failed delivery must retain all five tabs.
            controller.hide(source)
            controller.show(source)
            wait_for(selected_source)
            controller.hide(source)
            reply = controller.open_url({"transferId": "selected-tab-smoke", "browser": "chrome",
                                         "url": tab["url"], "x": 100, "y": 100, "width": 900, "height": 650}, stopped)
            receiver = reply["hwnd"]
            created.append(receiver)

            def selected_receiver():
                info = read_browser_tab(receiver)
                return info if info["tabCount"] == 1 and info["url"] == urls[2] else None

            wait_for(selected_receiver)
            assert controller.gui.GetWindowPlacement(receiver)[1] == 3
            controller.close(source)
            assert not controller.gui.IsWindow(source), "Source window did not close"
            print(json.dumps({"sourceTabs": 5, "selectedTab": 3, "receiverTabs": 1,
                              "receiverMaximized": True, "sourceAndOtherTabsClosed": True,
                              "restorePreservedAllTabs": True}))
        finally:
            controller.restore_hidden()
            for hwnd in created:
                if controller.gui.IsWindow(hwnd):
                    controller.close(hwnd)
            # The isolated browser may still be exiting after its test window closes.
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.terminate()  # This test's dedicated profile/process only.
                process.wait(timeout=5)


if __name__ == "__main__":
    main()
