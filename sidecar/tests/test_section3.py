import asyncio
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import Mock, patch

from sidecar.drag import FileDragTracker, Sample
from sidecar.handoff import WindowController, bounce_target
from sidecar.lookups import lookup_reply, selection_from_shell
from sidecar.win32_daemon import Outbox, receive_commands
from sidecar.windows import WindowsDesktop


class FileDragTests(unittest.TestCase):
    def sample(self, cursor=(0, 100), pressed=True, kind="CabinetWClass"):
        return Sample(10, False, (0, 0, 500, 500), cursor, pressed, 1, kind)

    def test_all_four_edges(self):
        for edge, cursor in [("LEFT", (0, 300)), ("RIGHT", (1919, 300)),
                             ("TOP", (300, 0)), ("BOTTOM", (300, 1079))]:
            with self.subTest(edge=edge):
                events = FileDragTracker().update(self.sample(cursor), (1920, 1080), {edge})
                self.assertEqual(events, [{"type": "LOCAL_FILE_DRAG", "active": True, "edge": edge}])

    def test_transitions_release_leave_and_switch(self):
        tracker = FileDragTracker()
        tracker.update(self.sample(), (1920, 1080), {"LEFT", "RIGHT"})
        self.assertEqual(tracker.update(self.sample(), (1920, 1080), {"LEFT", "RIGHT"}), [])
        switched = tracker.update(self.sample((1919, 300)), (1920, 1080), {"LEFT", "RIGHT"})
        self.assertEqual([(e["active"], e["edge"]) for e in switched], [(False, "LEFT"), (True, "RIGHT")])
        released = tracker.update(self.sample((1919, 300), False), (1920, 1080), {"RIGHT"})
        self.assertFalse(released[0]["active"])
        tracker.update(self.sample(), (1920, 1080), {"LEFT"})
        self.assertFalse(tracker.update(self.sample((101, 300)), (1920, 1080), {"LEFT"})[0]["active"])

    def test_disabled_nonexplorer_and_desktop_classes(self):
        self.assertEqual(FileDragTracker().update(self.sample(), (1920, 1080), set()), [])
        self.assertEqual(FileDragTracker().update(self.sample(kind="Notepad"), (1920, 1080), {"LEFT"}), [])
        for kind in ("Progman", "WorkerW"):
            self.assertTrue(FileDragTracker().update(self.sample(kind=kind), (1920, 1080), {"LEFT"}))


class BounceTests(unittest.TestCase):
    def test_four_targets_fully_on_screen(self):
        cases = [("LEFT", (-40, 200, 560, 600), (180, 200)),
                 ("RIGHT", (1400, 200, 2000, 600), (1140, 200)),
                 ("TOP", (300, -40, 900, 360), (300, 180)),
                 ("BOTTOM", (300, 700, 900, 1100), (300, 460))]
        for edge, rect, position in cases:
            with self.subTest(edge=edge):
                target = bounce_target(rect, edge, (0, 0, 1920, 1040))
                self.assertEqual(target[:2], position)
                self.assertGreaterEqual(target[0], 0)
                self.assertGreaterEqual(target[1], 0)

    def test_oversized_window_and_invalid_edge(self):
        self.assertEqual(bounce_target((-500, 0, 2500, 2000), "LEFT", (0, 0, 1920, 1040)),
                         (0, 0, 1920, 1040))
        with self.assertRaises(ValueError):
            bounce_target((0, 0, 500, 500), "invalid", (0, 0, 1920, 1040))

    def test_animation_and_disconnect_finish_inside_screen(self):
        controller = WindowController()
        controller.gui = Mock()
        controller.require_browser = Mock()
        controller.gui.GetWindowRect.return_value = (-40, 100, 560, 500)
        controller.work_area = Mock(return_value=(0, 0, 1920, 1040))
        with patch("sidecar.handoff.time.monotonic", side_effect=[0, 0, 0.15, 0.3]):
            controller.bounce(10, "LEFT", threading.Event())
        self.assertEqual(controller.gui.SetWindowPos.call_count, 3)
        controller.gui.SetWindowPos.assert_called_with(10, 0, 180, 100, 600, 400, 0x14)
        stopped = threading.Event()
        stopped.set()
        controller.bounce(10, "LEFT", stopped)
        controller.gui.SetWindowPos.assert_called_with(10, 0, 180, 100, 600, 400, 0x14)


def shell_window(hwnd, paths):
    window = Mock()
    window.HWND = hwnd
    items = Mock()
    items.Count = len(paths)
    items.Item.side_effect = lambda index: Mock(Path=paths[index])
    window.Document.SelectedItems.return_value = items
    return window


class LookupTests(unittest.TestCase):
    def test_selected_file_from_correct_explorer(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "example.txt"
            path.write_bytes(b"hello")
            shell = Mock()
            shell.Windows.return_value = [shell_window(11, ["not-the-target"]), shell_window(10, [str(path)])]
            self.assertEqual(selection_from_shell(shell, 10), {"path": str(path), "name": "example.txt", "size": 5})

    def test_no_selection_multiselection_directory_and_ambiguous_tabs(self):
        for windows in ([shell_window(10, [])], [shell_window(10, ["a", "b"])],
                        [shell_window(11, ["a"])], [shell_window(10, ["a"]), shell_window(10, ["b"])],
                        [shell_window(10, [str(Path.cwd())])]):
            with self.subTest(windows=len(windows)):
                shell = Mock()
                shell.Windows.return_value = windows
                with self.assertRaises(ValueError):
                    selection_from_shell(shell, 10)

    def test_voice_multitab_is_returned_for_electron_to_copy(self):
        info = {"hwnd": 10, "browser": "chrome", "url": "https://example.com", "title": "Example", "tabCount": 3}
        with patch("sidecar.lookups.read_browser_tab", return_value=info):
            self.assertEqual(lookup_reply("GET_ACTIVE_TAB", 10), {"type": "ACTIVE_TAB", **info})
        with patch("sidecar.lookups.read_selected_file", side_effect=ValueError("No file selected")):
            self.assertEqual(lookup_reply("GET_SELECTED_FILE", 10), {"type": "SELECTED_FILE", "error": "No file selected"})

    def test_remembered_window_survives_focus_change_and_rejects_reuse(self):
        desktop = WindowsDesktop()
        desktop.gui = Mock()
        desktop.api = Mock()
        desktop.gui.GetForegroundWindow.side_effect = [10, 11, 12]
        desktop.gui.GetClassName.side_effect = lambda hwnd: {10: "Chrome_WidgetWin_1", 11: "CabinetWClass", 12: "Other"}[hwnd]
        desktop.gui.GetWindowRect.return_value = (0, 0, 500, 500)
        desktop.gui.GetCursorPos.return_value = (100, 100)
        desktop.api.GetAsyncKeyState.return_value = 0
        with patch("sidecar.windows.browser_for_window", return_value="chrome"), \
                patch("win32process.GetWindowThreadProcessId", return_value=(1, 99)) as pid:
            for _ in range(3):
                desktop.sample()
            self.assertEqual(desktop.remembered_window(True), 10)
            self.assertEqual(desktop.remembered_window(False), 11)
            pid.return_value = (1, 100)
            with self.assertRaises(ValueError):
                desktop.remembered_window(True)


class CommandTests(unittest.IsolatedAsyncioTestCase):
    async def test_lookup_replies_and_bounce_dispatch(self):
        class Socket:
            def __aiter__(self):
                return self.messages()

            async def messages(self):
                for kind in ("GET_ACTIVE_TAB", "GET_SELECTED_FILE", "BOUNCE_WINDOW"):
                    yield json.dumps({"type": kind, "hwnd": 10, "edge": "LEFT"})

        desktop, lookups, controller = Mock(), Mock(), Mock()
        desktop.remembered_window.side_effect = [10, ValueError("No file is selected in File Explorer")]
        future = asyncio.get_running_loop().create_future()
        future.set_result({"type": "ACTIVE_TAB", "tabCount": 2})
        lookups.submit.return_value = future
        box = Outbox()
        stopped = threading.Event()
        await receive_commands(Socket(), set(), controller, box, None, stopped, desktop, lookups)
        self.assertEqual(box.lifecycle.get_nowait(), {"type": "ACTIVE_TAB", "tabCount": 2})
        self.assertEqual(box.lifecycle.get_nowait(), {"type": "SELECTED_FILE", "error": "No file is selected in File Explorer"})
        controller.bounce.assert_called_once_with(10, "LEFT", stopped)

    async def test_busy_lookup_returns_error_without_queuing(self):
        class Socket:
            def __aiter__(self):
                return self.messages()

            async def messages(self):
                yield json.dumps({"type": "GET_ACTIVE_TAB"})

        lookups = Mock()
        lookups.submit.return_value = None
        box = Outbox()
        await receive_commands(Socket(), set(), outbox=box, desktop=Mock(), lookups=lookups)
        reply = box.lifecycle.get_nowait()
        self.assertEqual(reply["type"], "ACTIVE_TAB")
        self.assertIn("busy", reply["error"])

    async def test_lookup_timeout_keeps_native_future_alive(self):
        class Socket:
            def __aiter__(self):
                return self.messages()

            async def messages(self):
                yield json.dumps({"type": "GET_SELECTED_FILE"})

        pending = asyncio.get_running_loop().create_future()
        lookups = Mock()
        lookups.submit.return_value = pending
        box = Outbox()
        with patch("sidecar.win32_daemon.asyncio.wait_for", side_effect=TimeoutError):
            await receive_commands(Socket(), set(), outbox=box, desktop=Mock(), lookups=lookups)
        self.assertFalse(pending.cancelled())
        self.assertIn("timed out", box.lifecycle.get_nowait()["error"])
        pending.set_result({"type": "SELECTED_FILE", "error": "finished late"})


if __name__ == "__main__":
    unittest.main()
