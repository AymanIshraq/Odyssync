import asyncio
import json
import unittest

from sidecar.drag import DragTracker, Sample, geometry, normalize_url
from sidecar.win32_daemon import Outbox, receive_commands


def sample(rect=(100, 100, 500, 500), cursor=(200, 110), pressed=True, hwnd=10, time=1):
    return Sample(hwnd, True, rect, cursor, pressed, time)


class DragTests(unittest.TestCase):
    def begin(self):
        tracker = DragTracker()
        tracker.update(sample(), (1000, 800), {"LEFT"})
        _, request = tracker.update(sample(rect=(90, 100, 490, 500), time=1.016),
                                    (1000, 800), {"LEFT"})
        return tracker, request[0]

    def test_four_edges(self):
        cases = [("LEFT", (-30, 100, 370, 500), (0, 150)),
                 ("RIGHT", (630, 100, 1030, 500), (999, 150)),
                 ("TOP", (100, -30, 500, 370), (150, 0)),
                 ("BOTTOM", (100, 430, 500, 830), (150, 799))]
        for edge, rect, cursor in cases:
            with self.subTest(edge=edge):
                fields = geometry(sample(rect, cursor), (1000, 800), {edge})
                self.assertEqual(fields["edge"], edge)
                self.assertEqual(fields["protrusionPx"], 30)
                self.assertTrue(fields["cursorAtEdge"])
                self.assertLessEqual(fields["centerRatio"], 1)

    def test_touch_release_threshold_on_all_edges(self):
        for edge in ("LEFT", "RIGHT", "TOP", "BOTTOM"):
            for distance in (19, 20, 21):
                cursor = {"LEFT": (distance, 400), "RIGHT": (999 - distance, 400),
                          "TOP": (500, distance), "BOTTOM": (500, 799 - distance)}[edge]
                with self.subTest(edge=edge, distance=distance):
                    fields = geometry(sample(cursor=cursor), (1000, 800), {edge})
                    self.assertEqual(fields["cursorAtEdge"], distance <= 20)
                    disabled = geometry(sample(cursor=cursor), (1000, 800), set())
                    self.assertFalse(disabled["cursorAtEdge"])

    def test_disabled_and_outside_edges(self):
        self.assertIsNone(geometry(sample(), (1000, 800), set())["edge"])
        self.assertIsNone(geometry(sample(rect=(200, 200, 600, 600)),
                                   (1000, 800), {"LEFT"})["edge"])

    def test_qualification_and_release(self):
        tracker, generation = self.begin()
        info = {"hwnd": 10, "url": "https://example.com", "tabCount": 1,
                "browser": "chrome", "title": "Example"}
        self.assertEqual(tracker.qualify(generation, info)["type"], "LOCAL_DRAG_START")
        events, _ = tracker.update(sample(cursor=(0, 150), pressed=False, time=1.032),
                                   (1000, 800), {"LEFT"})
        self.assertEqual([e["type"] for e in events], ["LOCAL_DRAG_MOVE", "LOCAL_DRAG_END"])
        self.assertTrue(events[-1]["cursorAtEdge"])
        self.assertIsNone(tracker.qualify(generation, info))

    def test_multitab_qualifies_selected_url_and_keeps_real_count(self):
        tracker, generation = self.begin()
        result = tracker.qualify(generation, {"hwnd": 10, "url": "https://selected.example", "tabCount": 5})
        self.assertEqual(result["url"], "https://selected.example")
        self.assertEqual(result["tabCount"], 5)

    def test_invalid_count_or_missing_url_never_starts(self):
        for count, url in [(0, "https://example.com"), (-1, "https://example.com"),
                           (True, "https://example.com"), (None, "https://example.com"), (1, ""), (5, "")]:
            tracker, generation = self.begin()
            self.assertIsNone(tracker.qualify(generation, {"hwnd": 10, "url": url, "tabCount": count}))

    def test_focus_switch_cancels(self):
        tracker, generation = self.begin()
        tracker.qualify(generation, {"hwnd": 10, "url": "https://example.com", "tabCount": 1})
        events, _ = tracker.update(sample(hwnd=11, cursor=(0, 0)), (1000, 800), {"LEFT"})
        self.assertFalse(events[0]["cursorAtEdge"])

    def test_url_normalization(self):
        for value, expected in [("example.com/a", "https://example.com/a"),
                                ("chrome://newtab/", "chrome://newtab/"),
                                ("", ""), ("search words", ""),
                                ("http://localhost:8080", "http://localhost:8080")]:
            self.assertEqual(normalize_url(value, "chrome"), expected)


class BridgeTests(unittest.IsolatedAsyncioTestCase):
    async def test_backpressure_coalesces_moves_and_preserves_last_move_before_end(self):
        box = Outbox()
        box.put({"type": "LOCAL_DRAG_START"})
        for x in range(1000):
            box.put({"type": "LOCAL_DRAG_MOVE", "cursorX": x})
        self.assertEqual(box.move["cursorX"], 999)
        box.put({"type": "LOCAL_DRAG_END"})
        sent = []

        class Socket:
            async def send(self, message):
                sent.append(json.loads(message))

        task = asyncio.create_task(box.send(Socket()))
        await asyncio.sleep(0)
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        self.assertEqual([item["type"] for item in sent],
                         ["LOCAL_DRAG_START", "LOCAL_DRAG_MOVE", "LOCAL_DRAG_END"])
        self.assertEqual(sent[1]["cursorX"], 999)

    async def test_real_loopback_ready_layout_and_reconnect(self):
        from websockets.asyncio.client import connect
        from websockets.asyncio.server import serve
        from sidecar.win32_daemon import run_session

        class Desktop:
            def screen_info(self):
                return {"screenWidth": 1920, "screenHeight": 1080, "dpiScale": 1.25}

            def sample(self):
                return sample(pressed=False)

        received = []

        async def server(socket):
            received.append(json.loads(await socket.recv()))
            await socket.send(json.dumps({"type": "SET_ACTIVE_EDGES", "left": True,
                                          "right": False, "top": False, "bottom": False}))
            await socket.close()

        async with serve(server, "127.0.0.1", 0) as listener:
            port = listener.sockets[0].getsockname()[1]
            for _ in range(2):
                async with connect(f"ws://127.0.0.1:{port}", proxy=None) as socket:
                    await asyncio.wait_for(run_session(socket, Desktop(), None), 2)
        self.assertEqual(len(received), 2)
        self.assertEqual(received[0], {"type": "SIDECAR_READY", **Desktop().screen_info()})

    async def test_layout_validation_and_replacement(self):
        class Socket:
            def __aiter__(self):
                return self.messages()

            async def messages(self):
                yield json.dumps({"type": "SET_ACTIVE_EDGES", "left": "false"})
                yield json.dumps({"type": "SET_ACTIVE_EDGES", "left": False,
                                  "right": True, "top": False, "bottom": False})

        active = {"LEFT"}
        with self.assertLogs("sidecar.win32_daemon", level="WARNING"):
            await receive_commands(Socket(), active)
        self.assertEqual(active, {"RIGHT"})


if __name__ == "__main__":
    unittest.main()
