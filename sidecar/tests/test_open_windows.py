"""Control Center window picker, plus audited lookup fixes. Runs on any OS with fakes."""

import asyncio
import json
from pathlib import Path
import sys
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from sidecar.documents import NOT_DOCUMENT_APPS
from sidecar.lookups import open_windows_reply, selection_from_shell, window_item_reply
from sidecar.notepad import read_notepad_controls
from sidecar.win32_daemon import LookupReader, Outbox, receive_commands
from sidecar.windows import WindowsDesktop, sendable_windows, window_process


def info(hwnd, title="Title", class_name="Generic", visible=True, cloaked=False, ex_style=0, owner=0):
    return {"hwnd": hwnd, "visible": visible, "cloaked": cloaked, "exStyle": ex_style,
            "owner": owner, "title": title, "className": class_name}


def shell_window(hwnd, paths):
    window = Mock()
    window.HWND = hwnd
    items = Mock()
    items.Count = len(paths)
    items.Item.side_effect = lambda index: Mock(Path=paths[index])
    window.Document.SelectedItems.return_value = items
    return window


def socket_of(*messages):
    class Socket:
        def __aiter__(self):
            return self.messages()

        async def messages(self):
            for message in messages:
                yield json.dumps(message)
    return Socket()


def bare_desktop(listed=None):
    desktop = WindowsDesktop.__new__(WindowsDesktop)  # No win32 imports needed.
    desktop.gui = Mock()
    desktop.listed = listed or {}
    return desktop


class FilterTests(unittest.TestCase):
    EXES = {1: "notepad.exe", 2: "odyssync.exe", 3: "explorer.exe", 4: "explorer.exe", 5: "chrome.exe",
            6: "winword.exe", 7: "notepad.exe", 8: "notepad.exe", 9: "notepad.exe", 10: "notepad.exe",
            11: "notepad.exe", 12: "electron.exe", 13: "explorer.exe"}

    def process_info(self, hwnd):
        return 100 + hwnd, self.EXES[hwnd]

    def test_order_skips_and_kinds(self):
        infos = [info(5, "Docs - Chrome", "Chrome_WidgetWin_1"),
                 info(2, "Odyssync"), info(12, "Dev Electron"),
                 info(3, "Taskbar", "Shell_TrayWnd"), info(13, "Program Manager", "Progman"),
                 info(7, visible=False), info(8, cloaked=True), info(9, ex_style=0x80),
                 info(10, owner=55), info(11, title="  "),
                 info(4, "Downloads", "CabinetWClass"),
                 info(1, "notes.txt - Notepad"),
                 info(6, "Report.docx - Word")]
        windows = sendable_windows(infos, self.process_info, NOT_DOCUMENT_APPS)
        self.assertEqual([(w["hwnd"], w["kind"]) for w in windows],
                         [(5, "browser"), (4, "explorer"), (1, "app"), (6, "app")])
        self.assertEqual(windows[0], {"hwnd": 5, "pid": 105, "kind": "browser", "app": "chrome.exe",
                                      "title": "Docs - Chrome"})

    def test_app_needs_document_exe_or_file_name(self):
        exes = {1: "spotify.exe", 2: "acrord32.exe", 3: "winword.exe", 4: "notepad.exe"}
        titles = {1: "Spotify Premium", 2: "report.pdf - Adobe Acrobat Reader",
                  3: "Document1 - Word", 4: "Untitled - Notepad"}
        windows = sendable_windows([info(h, titles[h]) for h in exes], lambda h: (h, exes[h]),
                                   NOT_DOCUMENT_APPS, document_apps={"winword.exe"})
        self.assertEqual([w["hwnd"] for w in windows], [2, 3, 4])

    def test_cap_and_vanished_process(self):
        def process_info(hwnd):
            if hwnd == 0:
                raise ValueError("That window was closed")
            return hwnd, "notepad.exe"
        windows = sendable_windows([info(hwnd) for hwnd in range(40)], process_info, NOT_DOCUMENT_APPS)
        self.assertEqual([w["hwnd"] for w in windows], list(range(1, 31)))

    def test_open_windows_keeps_minimised_and_remembers_list(self):
        desktop = bare_desktop()
        gui = desktop.gui
        gui.EnumWindows.side_effect = lambda visit, _: [visit(hwnd, None) for hwnd in (1, 2)]
        gui.IsWindowVisible.return_value = True  # True for minimised (iconic) windows too.
        gui.IsIconic.return_value = True
        gui.GetWindowLong.return_value = 0
        gui.GetWindow.return_value = 0
        gui.GetWindowText.side_effect = lambda hwnd: {1: "a.txt - Notepad", 2: "Odyssync"}[hwnd]
        gui.GetClassName.return_value = "Notepad"
        with patch("sidecar.windows.is_cloaked", return_value=False), \
                patch("sidecar.windows.process_info", side_effect=lambda h: (h + 10, {1: "notepad.exe", 2: "odyssync.exe"}[h])):
            windows = desktop.open_windows()
        self.assertEqual([w["hwnd"] for w in windows], [1])
        self.assertEqual(desktop.listed, {1: 11})


class ExplorerListTests(unittest.TestCase):
    def test_only_explorers_with_one_selected_file_are_offered(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "photo.jpg"
            path.write_bytes(b"x")
            shell = Mock()
            shell.Windows.return_value = [shell_window(20, []), shell_window(21, [str(path), str(path)]),
                                          shell_window(22, [str(path)])]
            desktop = Mock()
            desktop.open_windows.return_value = [
                {"hwnd": hwnd, "pid": 1, "kind": "explorer", "app": "explorer.exe", "title": "Folder"}
                for hwnd in (20, 21, 22)] + [{"hwnd": 5, "pid": 2, "kind": "app", "app": "notepad.exe", "title": "N"}]
            from sidecar.lookups import names_from_shell
            with patch("sidecar.lookups.explorer_names", side_effect=lambda hwnds: names_from_shell(shell, hwnds)):
                reply = open_windows_reply(desktop)
        self.assertEqual(reply, {"type": "OPEN_WINDOWS", "windows": [
            {"hwnd": 22, "kind": "explorer", "app": "explorer.exe", "title": "Folder", "name": "photo.jpg"},
            {"hwnd": 5, "kind": "app", "app": "notepad.exe", "title": "N"}]})
        self.assertEqual(desktop.listed, {22: 1, 5: 2})

    def test_listing_failure_is_a_clear_error(self):
        desktop = Mock()
        desktop.open_windows.side_effect = OSError((5, "EnumWindows", "Access is denied."))
        self.assertEqual(open_windows_reply(desktop), {"type": "OPEN_WINDOWS", "error": "Could not list open windows"})


class WindowItemTests(unittest.TestCase):
    def test_routes_each_kind_to_its_reader(self):
        tab = {"hwnd": 5, "browser": "chrome", "url": "https://a.test", "title": "A", "tabCount": 2}
        with patch("sidecar.lookups.browser_for_window", return_value="chrome"), \
                patch("sidecar.lookups.read_browser_tab", return_value=tab):
            self.assertEqual(window_item_reply(5, "Chrome_WidgetWin_1"),
                             {"type": "WINDOW_ITEM", "hwnd": 5, "kind": "tab", "url": "https://a.test",
                              "title": "A", "browser": "chrome", "tabCount": 2})
        selected = {"path": "C:\\x\\a.txt", "name": "a.txt", "size": 3}
        with patch("sidecar.lookups.browser_for_window", return_value=""), \
                patch("sidecar.lookups.read_selected_file", return_value=selected):
            self.assertEqual(window_item_reply(6, "CabinetWClass"),
                             {"type": "WINDOW_ITEM", "hwnd": 6, "kind": "file", **selected})
        document = {"hwnd": 7, "kind": "document", "path": "C:\\d.txt", "title": "d", "app": "notepad.exe",
                    "keepSource": True}
        with patch("sidecar.lookups.browser_for_window", return_value=""), \
                patch("sidecar.documents.read_window_document", return_value=document):
            self.assertEqual(window_item_reply(7, "Notepad"),
                             {"type": "WINDOW_ITEM", "hwnd": 7, "kind": "document", "path": "C:\\d.txt",
                              "title": "d", "app": "notepad.exe", "keepSource": True})

    def test_errors_are_clear_sentences(self):
        with patch("sidecar.lookups.browser_for_window", side_effect=ValueError("That window was closed")):
            self.assertEqual(window_item_reply(5, "X")["error"], "That window was closed")
        with patch("sidecar.lookups.browser_for_window", side_effect=RuntimeError((-2147, "COM", None))):
            self.assertEqual(window_item_reply(5, "X"),
                             {"type": "WINDOW_ITEM", "hwnd": 5, "error": "Could not read that window"})

    def test_listed_window_refuses_unlisted_and_reused_handles(self):
        desktop = bare_desktop({5: 100})
        desktop.gui.IsWindow.return_value = True
        desktop.gui.GetClassName.return_value = "Notepad"
        with patch("sidecar.windows.window_pid", return_value=100):
            self.assertEqual(desktop.listed_window(5), "Notepad")
            with self.assertRaisesRegex(ValueError, "not in the open windows list"):
                desktop.listed_window(6)
        with patch("sidecar.windows.window_pid", return_value=200), \
                self.assertRaisesRegex(ValueError, "That window was closed"):
            desktop.listed_window(5)
        desktop.gui.IsWindow.return_value = False
        with patch("sidecar.windows.window_pid", return_value=100), \
                self.assertRaisesRegex(ValueError, "That window was closed"):
            desktop.listed_window(5)


class CommandTests(unittest.IsolatedAsyncioTestCase):
    async def test_get_window_item_refuses_pid_change_without_reading(self):
        desktop = bare_desktop({5: 100})
        desktop.gui.IsWindow.return_value = True
        lookups = Mock()
        box = Outbox()
        with patch("sidecar.windows.window_pid", return_value=999):
            await receive_commands(socket_of({"type": "GET_WINDOW_ITEM", "hwnd": 5}, {"type": "GET_WINDOW_ITEM", "hwnd": 6}),
                                   set(), outbox=box, desktop=desktop, lookups=lookups)
        self.assertEqual(box.lifecycle.get_nowait(), {"type": "WINDOW_ITEM", "hwnd": 5, "error": "That window was closed"})
        self.assertEqual(box.lifecycle.get_nowait()["error"], "That window is not in the open windows list")
        lookups.call.assert_not_called()

    async def test_list_and_item_reach_the_lookup_worker(self):
        desktop = Mock()
        desktop.listed_window.return_value = "Notepad"
        lookups = Mock()

        def call(function, *args):
            future = asyncio.get_running_loop().create_future()
            future.set_result({"type": "X", "called": function.__name__, "args": list(args[1:]) if args[0] is desktop else list(args)})
            return future
        lookups.call.side_effect = call
        box = Outbox()
        await receive_commands(socket_of({"type": "LIST_OPEN_WINDOWS"}, {"type": "GET_WINDOW_ITEM", "hwnd": 5}),
                               set(), outbox=box, desktop=desktop, lookups=lookups)
        self.assertEqual(box.lifecycle.get_nowait(), {"type": "X", "called": "open_windows_reply", "args": []})
        self.assertEqual(box.lifecycle.get_nowait(), {"type": "X", "called": "window_item_reply", "args": [5, "Notepad"]})

    async def test_open_windows_error_and_non_value_error_replies(self):
        desktop = Mock()
        desktop.listed_window.side_effect = OSError((1400, "IsWindow", "Invalid window handle."))
        lookups = Mock()
        lookups.call.return_value = None  # Busy worker.
        box = Outbox()
        await receive_commands(socket_of({"type": "LIST_OPEN_WINDOWS"}, {"type": "GET_WINDOW_ITEM", "hwnd": 5}),
                               set(), outbox=box, desktop=desktop, lookups=lookups)
        listed = box.lifecycle.get_nowait()
        self.assertEqual(listed["type"], "OPEN_WINDOWS")
        self.assertIn("busy", listed["error"])
        self.assertEqual(box.lifecycle.get_nowait(), {"type": "WINDOW_ITEM", "hwnd": 5, "error": "Could not read that window"})

    async def test_timeout_abandons_hung_worker_and_next_lookup_runs(self):
        release = threading.Event()
        lookups = LookupReader()
        self.addCleanup(release.set)
        self.addCleanup(lookups.close)
        first_executor = lookups.executor
        lookups.call(release.wait, 5)  # A native call that never returns in time.
        with patch("sidecar.win32_daemon.warm_browser_worker") as warm:
            self.assertIsNone(lookups.call(lambda: "blocked"))  # Hung worker blocks new lookups...
            lookups.abandon()
            self.assertIsNot(lookups.executor, first_executor)
            result = await asyncio.wait_for(lookups.call(lambda: "fresh"), 2)
            self.assertEqual(result, "fresh")
            warm.assert_called_once_with()

    async def test_timeout_path_calls_abandon(self):
        lookups = Mock()
        lookups.call.return_value = asyncio.get_running_loop().create_future()
        box = Outbox()
        with patch("sidecar.win32_daemon.asyncio.wait_for", side_effect=TimeoutError):
            await receive_commands(socket_of({"type": "LIST_OPEN_WINDOWS"}), set(), outbox=box,
                                   desktop=Mock(), lookups=lookups)
        self.assertIn("timed out", box.lifecycle.get_nowait()["error"])
        lookups.abandon.assert_called_once_with()


class AuditFixTests(unittest.TestCase):
    def test_explorer_tabs_sharing_one_hwnd(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "a.txt"
            path.write_bytes(b"abc")
            shell = Mock()
            shell.Windows.return_value = [shell_window(10, []), shell_window(10, [str(path)]),
                                          shell_window(10, ["x", "y"])]
            self.assertEqual(selection_from_shell(shell, 10)["name"], "a.txt")
            shell.Windows.return_value = [shell_window(10, []), shell_window(10, [])]
            with self.assertRaisesRegex(ValueError, "No file is selected"):
                selection_from_shell(shell, 10)
            shell.Windows.return_value = [shell_window(10, [str(path)]), shell_window(10, [str(path)])]
            with self.assertRaisesRegex(ValueError, "ambiguous"):
                selection_from_shell(shell, 10)

    def test_unreadable_selected_item(self):
        shell = Mock()
        shell.Windows.return_value = [shell_window(10, [str(Path(tempfile.gettempdir()) / "missing-odyssync-x.zip")])]
        with self.assertRaisesRegex(ValueError, "^Could not read the selected file$"):
            selection_from_shell(shell, 10)

    def test_closed_window_process(self):
        api = SimpleNamespace(OpenProcess=Mock(side_effect=Exception(87, "OpenProcess", "The parameter is incorrect.")))
        with patch.dict(sys.modules, {"win32api": api}):
            with patch("sidecar.windows.window_pid", return_value=0), \
                    self.assertRaisesRegex(ValueError, "^That window was closed$"):
                window_process(5)
            with patch("sidecar.windows.window_pid", return_value=44), \
                    self.assertRaisesRegex(ValueError, "^That window was closed$"):
                window_process(5)
            api.OpenProcess = Mock(return_value="handle")
            with patch("sidecar.windows.window_pid", return_value=44):
                self.assertEqual(window_process(5), "handle")

    def test_minimised_notepad_editor_is_offscreen_but_readable(self):
        editor = SimpleNamespace(ControlTypeName="DocumentControl", ClassName="RichEditD2DPT", IsOffscreen=True,
                                 GetChildren=lambda: (),
                                 GetTextPattern=lambda: SimpleNamespace(DocumentRange=SimpleNamespace(GetText=lambda n: "hi")))
        root = SimpleNamespace(ControlTypeName="WindowControl", GetChildren=lambda: (editor,))
        self.assertEqual(read_notepad_controls(root, minimised=True), ("hi", 1))
        with self.assertRaises(ValueError):
            read_notepad_controls(root)


if __name__ == "__main__":
    unittest.main()
