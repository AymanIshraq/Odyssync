import asyncio
from io import BytesIO
import json
import struct
import threading
import unittest
from unittest.mock import Mock, patch

from PIL import Image

from sidecar.handoff import WindowController, clamp_rect, validate_open
from sidecar.preview import capture_preview, encode_preview, mostly_black
from sidecar.win32_daemon import Outbox, poll_desktop, receive_commands, run_session


def open_message(**changes):
    return {"type": "OPEN_URL", "transferId": "test-transfer", "url": "https://example.com",
            "browser": "chrome", "x": -200, "y": 9999, "width": 3000, "height": 2000, **changes}


class PreviewTests(unittest.TestCase):
    def test_binary_header_and_jpeg(self):
        frame = encode_preview(123, Image.new("RGB", (1600, 900), "blue"))
        length, = struct.unpack("<I", frame[:4])
        header = json.loads(frame[4:4 + length])
        self.assertEqual(header, {"type": "LOCAL_WINDOW_PREVIEW", "hwnd": 123,
                                  "mime": "image/jpeg", "width": 800, "height": 450})
        image = Image.open(BytesIO(frame[4 + length:]))
        self.assertEqual(image.format, "JPEG")
        self.assertEqual(image.size, (800, 450))

    def test_small_images_are_not_enlarged(self):
        frame = encode_preview(1, Image.new("RGB", (200, 100), "white"))
        length, = struct.unpack("<I", frame[:4])
        self.assertEqual(json.loads(frame[4:4 + length])["width"], 200)

    def test_black_capture_falls_back(self):
        self.assertTrue(mostly_black(Image.new("RGB", (100, 100))))
        self.assertFalse(mostly_black(Image.new("RGB", (100, 100), "white")))
        with patch("win32gui.GetWindowRect", return_value=(0, 0, 200, 100)), \
                patch("sidecar.preview.print_window", return_value=Image.new("RGB", (200, 100))), \
                patch("sidecar.preview.screen_fallback", return_value=Image.new("RGB", (200, 100), "white")) as fallback:
            self.assertIsInstance(capture_preview(1), bytes)
            fallback.assert_called_once_with((0, 0, 200, 100))

    def test_failed_printwindow_falls_back(self):
        with patch("win32gui.GetWindowRect", return_value=(0, 0, 200, 100)), \
                patch("sidecar.preview.print_window", side_effect=OSError("GPU capture failed")), \
                patch("sidecar.preview.screen_fallback", return_value=Image.new("RGB", (200, 100), "white")):
            self.assertIsInstance(capture_preview(1), bytes)


class WindowTests(unittest.TestCase):
    def controller(self):
        controller = WindowController()
        controller.gui = Mock()
        controller.require_browser = Mock()
        controller.work_area = Mock(return_value=(0, 0, 1920, 1040))
        return controller

    def test_clamp_to_work_area(self):
        self.assertEqual(clamp_rect(-200, 9999, 3000, 2000, (0, 0, 1920, 1040)), (0, 0, 1920, 1040))

    def test_invalid_open_is_rejected_before_launch(self):
        for changes in ({"url": "--some-flag"}, {"width": -1}, {"x": True}, {"browser": "other"}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                validate_open(open_message(**changes))

    def test_hide_and_disconnect_restore_never_closes(self):
        controller = self.controller()
        controller.gui.GetWindowRect.return_value = (-100, 0, 500, 500)
        controller.hide(10)
        self.assertIn(10, controller.hidden)
        controller.restore_hidden()
        self.assertEqual(controller.hidden, {})
        controller.gui.SetWindowPos.assert_called_once_with(10, 0, 0, 0, 600, 500, 0x14)
        controller.gui.PostMessage.assert_not_called()

    def test_close_only_on_explicit_command(self):
        controller = self.controller()
        controller.hidden[10] = (0, 0, 500, 500)
        controller.gui.IsWindow.return_value = False  # Destruction after WM_CLOSE.
        controller.close(10)
        controller.gui.PostMessage.assert_called_once_with(10, 0x10, 0, 0)

    def test_open_places_only_new_handle(self):
        controller = self.controller()
        controller.window_handles = Mock(return_value={1})
        controller.browser_windows = Mock(return_value={1: "chrome", 2: "chrome"})
        controller.launch = Mock()
        with patch("sidecar.handoff.find_browser", return_value="chrome.exe"):
            result = controller.open_url(open_message(), threading.Event())
        self.assertEqual(result, {"type": "WINDOW_PLACED", "transferId": "test-transfer", "hwnd": 2})
        controller.gui.SetWindowPos.assert_called_once_with(2, 0, 0, 0, 1920, 1040, 0x14)

    def test_default_browser_fallback(self):
        controller = self.controller()
        controller.window_handles = Mock(return_value=set())
        controller.browser_windows = Mock(return_value={2: "msedge"})
        controller.launch = Mock()
        with patch("sidecar.handoff.find_browser", return_value=None):
            self.assertEqual(controller.open_url(open_message(), threading.Event())["hwnd"], 2)
        controller.launch.assert_called_once_with("https://example.com", None)

    def test_timeout_does_not_place_old_window_or_close_any_window(self):
        controller = self.controller()
        controller.window_handles = Mock(return_value={1})
        controller.browser_windows = Mock(return_value={1: "chrome"})
        controller.launch = Mock()
        with patch("sidecar.handoff.find_browser", return_value="chrome.exe"), \
                patch("sidecar.handoff.time.monotonic", side_effect=[0, 5]), \
                self.assertRaises(TimeoutError):
            controller.open_url(open_message(), threading.Event())
        controller.gui.SetWindowPos.assert_not_called()
        controller.gui.PostMessage.assert_not_called()

    def test_ambiguous_windows_fail_without_placement(self):
        controller = self.controller()
        controller.window_handles = Mock(return_value=set())
        controller.browser_windows = Mock(return_value={2: "chrome", 3: "chrome"})
        controller.launch = Mock()
        with patch("sidecar.handoff.find_browser", return_value="chrome.exe"), self.assertRaises(RuntimeError):
            controller.open_url(open_message(), threading.Event())
        controller.gui.SetWindowPos.assert_not_called()


class CommandTests(unittest.IsolatedAsyncioTestCase):
    async def test_preview_emitted_during_drag_and_stale_capture_dropped(self):
        from sidecar.drag import Sample

        for stale in (False, True):
            with self.subTest(stale=stale):
                loop = asyncio.get_running_loop()
                qualification = loop.create_future()
                qualification.set_result({"hwnd": 10, "browser": "chrome", "url": "https://example.com",
                                          "title": "Example", "tabCount": 1})
                capture = loop.create_future()
                if not stale:
                    capture.set_result(b"preview-frame")
                reader = Mock()
                reader.submit.return_value = qualification
                previews = Mock()
                previews.submit.return_value = capture

                class Desktop:
                    tick = 0

                    def screen_info(self):
                        return {"screenWidth": 1920, "screenHeight": 1080, "dpiScale": 1}

                    def sample(self):
                        self.tick += 1
                        if self.tick == 7 and stale:
                            capture.set_result(b"stale-frame")
                        return Sample(10, True, (100 - min(self.tick, 5), 100, 500, 500),
                                      (0, 120), self.tick < 6, self.tick * 0.016)

                box = Outbox()
                task = asyncio.create_task(poll_desktop(Desktop(), {"LEFT"}, box, reader, previews))
                await asyncio.sleep(0.16)
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
                events = []
                while not box.lifecycle.empty():
                    events.append(box.lifecycle.get_nowait())
                self.assertEqual([event["type"] for event in events if isinstance(event, dict)],
                                 ["LOCAL_DRAG_START", "LOCAL_DRAG_MOVE", "LOCAL_DRAG_END"])
                previews.submit.assert_called_once_with(10)
                self.assertEqual([event for event in events if isinstance(event, bytes)],
                                 [] if stale else [b"preview-frame"])

    async def test_open_failure_is_reported_and_next_command_runs(self):
        class Socket:
            def __aiter__(self):
                return self.messages()

            async def messages(self):
                yield json.dumps(open_message())
                yield json.dumps({"type": "SHOW_WINDOW", "hwnd": 10})

        controller = Mock()
        controller.open_url.side_effect = OSError("Launch failed")
        box = Outbox()
        with self.assertLogs("sidecar.win32_daemon", level="WARNING"):
            await receive_commands(Socket(), set(), controller, box, None, threading.Event())
        self.assertEqual(box.lifecycle.get_nowait(), {"type": "OPEN_FAILED", "transferId": "test-transfer",
                                                     "error": "Launch failed"})
        controller.show.assert_called_once_with(10)

    async def test_binary_preview_sent_without_json_encoding(self):
        box = Outbox()
        frame = encode_preview(10, Image.new("RGB", (10, 10), "white"))
        box.put(frame)
        sent = []

        class Socket:
            async def send(self, data):
                sent.append(data)

        task = asyncio.create_task(box.send(Socket()))
        await asyncio.sleep(0)
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        self.assertEqual(sent, [frame])

    async def test_disconnect_restores_hidden_sender(self):
        from websockets.asyncio.client import connect
        from websockets.asyncio.server import serve
        from sidecar.drag import Sample

        class Desktop:
            def screen_info(self):
                return {"screenWidth": 1920, "screenHeight": 1080, "dpiScale": 1}

            def sample(self):
                return Sample(0, False, (0, 0, 0, 0), (0, 0), False, 1)

        controller = Mock()

        async def server(socket):
            await socket.recv()
            await socket.send(json.dumps({"type": "HIDE_WINDOW", "hwnd": 10}))
            for _ in range(50):
                if controller.hide.called:
                    break
                await asyncio.sleep(0.01)
            await socket.close()

        async with serve(server, "127.0.0.1", 0) as listener:
            port = listener.sockets[0].getsockname()[1]
            async with connect(f"ws://127.0.0.1:{port}", proxy=None) as socket:
                await asyncio.wait_for(run_session(socket, Desktop(), None, controller), 2)
        controller.hide.assert_called_once_with(10)
        controller.restore_hidden.assert_called_once()
        controller.close.assert_not_called()


if __name__ == "__main__":
    unittest.main()
