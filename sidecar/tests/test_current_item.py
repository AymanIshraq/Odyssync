"""GET_CURRENT_ITEM: the window the user is looking at. Runs on any OS with fakes."""

import asyncio
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

from sidecar.documents import NOT_DOCUMENT_APPS
from sidecar.lookups import current_item_reply
from sidecar.win32_daemon import Outbox, receive_commands
from sidecar.windows import ODYSSYNC_EXES, WindowsDesktop, is_user_window


def socket_of(*messages):
    class Socket:
        def __aiter__(self):
            return self.messages()

        async def messages(self):
            for message in messages:
                yield json.dumps(message)
    return Socket()


def shell_window(hwnd, paths):
    window = Mock()
    window.HWND = hwnd
    items = Mock()
    items.Count = len(paths)
    items.Item.side_effect = lambda index: Mock(Path=paths[index])
    window.Document.SelectedItems.return_value = items
    return window


def bare_desktop():
    desktop = WindowsDesktop.__new__(WindowsDesktop)  # No win32 imports needed.
    desktop.gui = Mock()
    desktop.api = Mock()
    desktop.last_browser = desktop.last_explorer = desktop.previous_foreground = None
    desktop.last_user_window = None
    desktop.listed = {}
    return desktop


class RememberRuleTests(unittest.TestCase):
    def test_odyssync_set_matches_not_document_apps_minus_explorer(self):
        self.assertEqual(ODYSSYNC_EXES, NOT_DOCUMENT_APPS - {"explorer.exe"})

    def test_remembered(self):
        for class_name, exe, title in (("Chrome_WidgetWin_1", "chrome.exe", "Docs"),
                                       ("Notepad", "notepad.exe", "a.txt"),
                                       ("CabinetWClass", "explorer.exe", "Downloads"),
                                       ("Progman", "explorer.exe", "Program Manager"),
                                       ("WorkerW", "explorer.exe", ""),
                                       ("ApplicationFrameWindow", "applicationframehost.exe", "Photos")):
            self.assertTrue(is_user_window(class_name, exe, True, title), class_name)

    def test_skipped(self):
        for class_name, exe, visible, title in (
                ("Chrome_WidgetWin_1", "odyssync.exe", True, "Odyssync"),
                ("Chrome_WidgetWin_1", "electron.exe", True, "Odyssync"),
                ("Shell_TrayWnd", "explorer.exe", True, ""),
                ("Shell_SecondaryTrayWnd", "explorer.exe", True, ""),
                ("Windows.UI.Core.CoreWindow", "startmenuexperiencehost.exe", True, "Start"),
                ("ApplicationFrameWindow", "applicationframehost.exe", True, ""),
                ("XamlExplorerHostIslandWindow", "explorer.exe", True, "Task Switching"),
                ("Notepad", "notepad.exe", False, "a.txt"),
                ("Notepad", "", True, "a.txt")):
            self.assertFalse(is_user_window(class_name, exe, visible, title), class_name)

    def test_sample_remembers_only_on_change_and_skips_odyssync(self):
        desktop = bare_desktop()
        exes = {1: "notepad.exe", 2: "odyssync.exe"}
        classes = {1: "Notepad", 2: "Chrome_WidgetWin_1"}
        desktop.gui.GetClassName.side_effect = classes.get
        desktop.gui.IsWindowVisible.return_value = True
        desktop.gui.GetWindowText.return_value = "a.txt"
        desktop.gui.GetWindowRect.return_value = (0, 0, 1, 1)
        desktop.gui.GetCursorPos.return_value = (0, 0)
        desktop.api.GetAsyncKeyState.return_value = 0
        with patch("sidecar.windows.process_info", side_effect=lambda hwnd: (100 + hwnd, exes[hwnd])) as info:
            for hwnd in (1, 1, 2, 2):
                desktop.gui.GetForegroundWindow.return_value = hwnd
                desktop.sample()
        self.assertEqual(desktop.last_user_window, (1, 101, "Notepad"))
        self.assertEqual(info.call_count, 2)  # Once per foreground change.


class CurrentWindowTests(unittest.TestCase):
    def test_no_window(self):
        with self.assertRaisesRegex(ValueError, "Open the tab or file you want to send first"):
            bare_desktop().current_window()

    def test_closed_or_reused_window(self):
        desktop = bare_desktop()
        desktop.last_user_window = (5, 100, "Notepad")
        desktop.gui.IsWindow.return_value = False
        with self.assertRaisesRegex(ValueError, "Open the tab"):
            desktop.current_window()
        desktop.gui.IsWindow.return_value = True
        with patch("sidecar.windows.window_pid", return_value=999):
            with self.assertRaisesRegex(ValueError, "Open the tab"):
                desktop.current_window()
        with patch("sidecar.windows.window_pid", return_value=100):
            self.assertEqual(desktop.current_window(), (5, "Notepad"))


class ReplyTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.root = Path(folder.name)
        self.a = self.root / "a.txt"
        self.a.write_text("hello")
        self.b = self.root / "b.pdf"
        self.b.write_text("pdf")
        (self.root / "folder").mkdir()

    def test_tab(self):
        tab = {"hwnd": 7, "url": "https://x.test/", "title": "X", "browser": "chrome", "tabCount": 3}
        with patch("sidecar.lookups.browser_for_window", return_value="chrome"), \
                patch("sidecar.lookups.read_browser_tab", return_value=tab):
            self.assertEqual(current_item_reply(7, "Chrome_WidgetWin_1"),
                             {"type": "CURRENT_ITEM", "kind": "tab", "url": "https://x.test/", "title": "X",
                              "browser": "chrome", "tabCount": 3})

    def test_explorer_all_selected_files_across_tabs(self):
        shell = Mock()
        shell.Windows.return_value = [shell_window(9, [str(self.a), str(self.root / "folder")]),
                                      shell_window(8, [str(self.b)]), shell_window(9, [str(self.b)])]
        with patch("sidecar.lookups.with_shell", side_effect=lambda function, *args: function(shell, *args)):
            reply = current_item_reply(9, "CabinetWClass")
        self.assertEqual(reply, {"type": "CURRENT_ITEM", "kind": "files", "where": "explorer", "files": [
            {"path": str(self.a), "name": "a.txt", "size": 5}, {"path": str(self.b), "name": "b.pdf", "size": 3}]})

    def test_explorer_nothing_selected(self):
        shell = Mock()
        shell.Windows.return_value = [shell_window(9, [str(self.root / "folder")])]
        with patch("sidecar.lookups.with_shell", side_effect=lambda function, *args: function(shell, *args)):
            self.assertEqual(current_item_reply(9, "CabinetWClass"),
                             {"type": "CURRENT_ITEM", "error": "No file is selected in File Explorer"})

    def test_desktop(self):
        view = shell_window(0, [str(self.a)])
        with patch("sidecar.lookups.desktop_view", return_value=view), \
                patch("sidecar.lookups.with_shell", side_effect=lambda function, *args: function(Mock(), *args)):
            self.assertEqual(current_item_reply(3, "WorkerW"),
                             {"type": "CURRENT_ITEM", "kind": "files", "where": "desktop",
                              "files": [{"path": str(self.a), "name": "a.txt", "size": 5}]})
            view.Document.SelectedItems.return_value.Count = 0
            self.assertEqual(current_item_reply(3, "Progman"),
                             {"type": "CURRENT_ITEM", "error": "No file is selected on the Desktop"})

    def test_document_and_errors(self):
        document = {"hwnd": 4, "kind": "document", "path": str(self.a), "title": "a.txt - Notepad",
                    "app": "notepad.exe", "keepSource": True}
        with patch("sidecar.lookups.browser_for_window", return_value=""), \
                patch("sidecar.documents.read_window_document", return_value=document):
            self.assertEqual(current_item_reply(4, "Notepad"),
                             {"type": "CURRENT_ITEM", "kind": "document", "path": str(self.a),
                              "title": "a.txt - Notepad", "app": "notepad.exe", "keepSource": True})
        with patch("sidecar.lookups.browser_for_window", return_value=""), \
                patch("sidecar.documents.read_window_document", side_effect=ValueError("Save the file first")):
            self.assertEqual(current_item_reply(4, "Notepad"), {"type": "CURRENT_ITEM", "error": "Save the file first"})
        with patch("sidecar.lookups.browser_for_window", side_effect=OSError((5, "OpenProcess", "Denied"))):
            self.assertEqual(current_item_reply(4, "Notepad"),
                             {"type": "CURRENT_ITEM", "error": "Could not read that window"})


class CommandTests(unittest.IsolatedAsyncioTestCase):
    async def test_reaches_lookup_worker(self):
        desktop = Mock()
        desktop.current_window.return_value = (5, "Notepad")
        lookups = Mock()

        def call(function, *args):
            future = asyncio.get_running_loop().create_future()
            future.set_result({"type": "X", "called": function.__name__, "args": list(args)})
            return future
        lookups.call.side_effect = call
        box = Outbox()
        await receive_commands(socket_of({"type": "GET_CURRENT_ITEM"}), set(), outbox=box,
                               desktop=desktop, lookups=lookups)
        self.assertEqual(box.lifecycle.get_nowait(), {"type": "X", "called": "current_item_reply", "args": [5, "Notepad"]})

    async def test_no_window_and_unexpected_errors(self):
        lookups = Mock()
        box = Outbox()
        await receive_commands(socket_of({"type": "GET_CURRENT_ITEM"}), set(), outbox=box,
                               desktop=bare_desktop(), lookups=lookups)
        self.assertEqual(box.lifecycle.get_nowait(),
                         {"type": "CURRENT_ITEM", "error": "Open the tab or file you want to send first"})
        desktop = Mock()
        desktop.current_window.side_effect = OSError((1400, "IsWindow", "Invalid window handle."))
        await receive_commands(socket_of({"type": "GET_CURRENT_ITEM"}), set(), outbox=box,
                               desktop=desktop, lookups=lookups)
        self.assertEqual(box.lifecycle.get_nowait(), {"type": "CURRENT_ITEM", "error": "Could not read that window"})
        lookups.call.assert_not_called()

    async def test_timeout_abandons(self):
        desktop = Mock()
        desktop.current_window.return_value = (5, "Notepad")
        lookups = Mock()
        lookups.call.return_value = asyncio.get_running_loop().create_future()
        box = Outbox()
        with patch("sidecar.win32_daemon.asyncio.wait_for", side_effect=TimeoutError):
            await receive_commands(socket_of({"type": "GET_CURRENT_ITEM"}), set(), outbox=box,
                                   desktop=desktop, lookups=lookups)
        self.assertEqual(box.lifecycle.get_nowait(),
                         {"type": "CURRENT_ITEM", "error": "Reading that window timed out; try again"})
        lookups.abandon.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
