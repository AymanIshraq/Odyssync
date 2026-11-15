"""Safety regressions from the Tech 1 audit; all native window calls are mocked."""

import asyncio
from contextlib import nullcontext
import json
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from sidecar.drag import DragTracker, Sample
from sidecar.handoff import WindowController
from sidecar.win32_daemon import Outbox
from sidecar.windows import read_browser_tab


class WindowRecoveryTests(unittest.TestCase):
    def controller(self):
        controller = WindowController()
        controller.gui = Mock()
        controller.require_browser = Mock()
        controller.work_area = Mock(return_value=(0, 0, 1920, 1040))
        controller.gui.GetWindowRect.return_value = (-20, 100, 780, 700)
        return controller

    def test_baseline_includes_hidden_and_unidentified_chromium_handles(self):
        controller = self.controller()
        controller.gui.EnumWindows.side_effect = lambda visit, arg: [visit(hwnd, arg) for hwnd in (10, 20, 30)]
        controller.gui.GetClassName.side_effect = lambda hwnd: "Other" if hwnd == 30 else "Chrome_WidgetWin_1"
        controller.gui.IsWindowVisible.side_effect = lambda hwnd: hwnd == 10
        with patch("sidecar.handoff.browser_for_window", side_effect=OSError("Process unavailable")):
            self.assertEqual(controller.window_handles(), {10, 20})

    def test_preexisting_hidden_window_is_never_a_new_destination(self):
        for executable in ("chrome.exe", None):
            with self.subTest(executable=executable):
                controller = self.controller()
                visible = set()
                controller.gui.EnumWindows.side_effect = lambda visit, arg: visit(10, arg)
                controller.gui.GetClassName.return_value = "Chrome_WidgetWin_1"
                controller.gui.IsWindowVisible.side_effect = lambda hwnd: hwnd in visible
                controller.launch = Mock(side_effect=lambda *args: visible.add(10))
                message = {"transferId": "audit", "browser": "chrome", "url": "https://example.com",
                           "x": 0, "y": 0, "width": 800, "height": 600}
                with patch("sidecar.handoff.browser_for_window", return_value="chrome"), \
                        patch("sidecar.handoff.find_browser", return_value=executable), \
                        patch("sidecar.handoff.time.monotonic", side_effect=[0, 0, 5]), \
                        self.assertRaises(TimeoutError):
                    controller.open_url(message, threading.Event())
                controller.gui.SetWindowPos.assert_not_called()

    def test_new_destination_must_be_visible_before_placement(self):
        controller = self.controller()
        windows, visible = {10}, {10}
        controller.gui.EnumWindows.side_effect = lambda visit, arg: [visit(hwnd, arg) for hwnd in windows]
        controller.gui.GetClassName.return_value = "Chrome_WidgetWin_1"
        controller.gui.IsWindowVisible.side_effect = lambda hwnd: hwnd in visible
        controller.launch = Mock(side_effect=lambda *args: windows.add(20))
        stopped = Mock()
        stopped.is_set.return_value = False

        def reveal_window(_):
            controller.gui.SetWindowPos.assert_not_called()
            visible.add(20)

        stopped.wait.side_effect = reveal_window
        message = {"transferId": "audit", "browser": "chrome", "url": "https://example.com",
                   "x": 0, "y": 0, "width": 800, "height": 600}
        with patch("sidecar.handoff.browser_for_window", return_value="chrome"), \
                patch("sidecar.handoff.find_browser", return_value="chrome.exe"):
            result = controller.open_url(message, stopped)
        self.assertEqual(result["hwnd"], 20)
        stopped.wait.assert_called_once()

    def test_refused_close_restores_source_instead_of_abandoning_it(self):
        controller = self.controller()
        controller.hidden[10] = (-20, 100, 780, 700)
        controller.gui.IsWindow.return_value = True
        with patch("sidecar.handoff.time.monotonic", side_effect=[0, 3]):
            controller.close(10)
        controller.gui.PostMessage.assert_called_once_with(10, 0x10, 0, 0)
        controller.gui.ShowWindow.assert_called_once_with(10, 4)
        controller.gui.SetWindowPos.assert_called_once_with(10, 0, 0, 100, 800, 600, 0x14)
        self.assertNotIn(10, controller.hidden)

    def test_successful_close_waits_for_destruction_without_showing_window(self):
        controller = self.controller()
        controller.hidden[10] = (0, 0, 800, 600)
        controller.gui.IsWindow.side_effect = [True, False]

        def while_pending(_):
            self.assertIn(10, controller.hidden)

        with patch("sidecar.handoff.time.monotonic", side_effect=[0, 0.1]), \
                patch("sidecar.handoff.time.sleep", side_effect=while_pending) as sleep:
            controller.close(10)
        sleep.assert_called_once()
        self.assertNotIn(10, controller.hidden)
        controller.gui.ShowWindow.assert_not_called()

    def test_slow_successful_close_does_not_flash_sender_back_after_half_second(self):
        controller = self.controller()
        controller.hidden[10] = (0, 0, 800, 600)
        controller.gui.IsWindow.side_effect = [True, False]
        with patch("sidecar.handoff.time.monotonic", side_effect=[0, 0.75]), \
                patch("sidecar.handoff.time.sleep"):
            controller.close(10)
        controller.gui.ShowWindow.assert_not_called()
        self.assertNotIn(10, controller.hidden)

    def test_failed_restore_keeps_window_tracked_for_disconnect_retry(self):
        controller = self.controller()
        controller.hidden[10] = (0, 0, 800, 600)
        controller.gui.IsWindow.return_value = True
        controller.gui.ShowWindow.side_effect = OSError("Temporary restore failure")
        with patch("sidecar.handoff.time.monotonic", side_effect=[0, 3]), self.assertRaises(OSError):
            controller.close(10)
        self.assertIn(10, controller.hidden)
        controller.gui.ShowWindow.side_effect = None
        controller.restore_hidden()
        self.assertNotIn(10, controller.hidden)

    def test_disconnect_discards_destroyed_handles_without_restoring_them(self):
        controller = self.controller()
        controller.hidden[10] = (0, 0, 800, 600)
        controller.gui.IsWindow.return_value = False
        controller.restore_hidden()
        self.assertNotIn(10, controller.hidden)
        controller.gui.ShowWindow.assert_not_called()


class ReleaseTests(unittest.TestCase):
    def begin(self):
        tracker = DragTracker()
        tracker.update(Sample(10, True, (20, 100, 820, 700), (30, 120), True, 1),
                       (1920, 1080), {"LEFT"})
        _, request = tracker.update(Sample(10, True, (-10, 100, 790, 700), (0, 120), True, 1.016),
                                    (1920, 1080), {"LEFT"})
        tracker.qualify(request[0], {"hwnd": 10, "tabCount": 1, "url": "https://example.com"})
        return tracker

    def test_focus_change_cancels_even_if_release_happens_between_polls(self):
        for pressed in (False, True):
            for cursor in ((0, 120), (500, 500)):
                with self.subTest(pressed=pressed, cursor=cursor):
                    tracker = self.begin()
                    events, _ = tracker.update(Sample(20, False, (0, 0, 500, 500), cursor, pressed, 1.032),
                                               (1920, 1080), {"LEFT"})
                    self.assertEqual([event["type"] for event in events], ["LOCAL_DRAG_END"])
                    self.assertFalse(events[-1]["cursorAtEdge"])
                    self.assertEqual(events[-1]["hwnd"], 10)

    def test_release_delivers_current_geometry_before_end(self):
        tracker = self.begin()
        released = Sample(10, True, (-20, 300, 880, 1000), (0, 320), False, 1.032)
        events, _ = tracker.update(released, (1920, 1080), {"LEFT"})
        self.assertEqual([event["type"] for event in events], ["LOCAL_DRAG_MOVE", "LOCAL_DRAG_END"])
        self.assertEqual((events[0]["width"], events[0]["height"]), (900, 700))
        self.assertAlmostEqual(events[0]["centerRatio"], 650 / 1080)
        self.assertTrue(events[-1]["cursorAtEdge"])
        self.assertEqual(set(events[-1]), {"type", "hwnd", "edge", "cursorAtEdge", "velocity"})


class ReleaseOrderingTests(unittest.IsolatedAsyncioTestCase):
    async def test_slow_sender_preserves_final_moves_across_consecutive_drags(self):
        box, sent = Outbox(), []
        sending, resume = asyncio.Event(), asyncio.Event()

        class Socket:
            async def send(self, raw):
                if not sent:
                    sending.set()
                    await resume.wait()
                sent.append(json.loads(raw))

        box.put({"type": "LOCAL_DRAG_START", "hwnd": 10})
        task = asyncio.create_task(box.send(Socket()))
        try:
            await asyncio.wait_for(sending.wait(), 1)
            for hwnd in (10, 20):
                if hwnd == 20:
                    box.put({"type": "LOCAL_DRAG_START", "hwnd": hwnd})
                for ratio in (.1, .5, .9):
                    box.put({"type": "LOCAL_DRAG_MOVE", "hwnd": hwnd, "centerRatio": ratio})
                box.put({"type": "LOCAL_DRAG_END", "hwnd": hwnd})
            resume.set()
            await asyncio.sleep(0)
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        self.assertEqual([(event["type"], event["hwnd"]) for event in sent],
                         [(kind, hwnd) for hwnd in (10, 20)
                          for kind in ("LOCAL_DRAG_START", "LOCAL_DRAG_MOVE", "LOCAL_DRAG_END")])
        self.assertEqual([event["centerRatio"] for event in sent if event["type"] == "LOCAL_DRAG_MOVE"],
                         [.9, .9])


class Control:
    def __init__(self, kind, name="", children=()):
        self.ControlTypeName, self.Name, self.children = kind, name, children

    def GetChildren(self):
        return self.children

    def GetValuePattern(self):
        return SimpleNamespace(Value="https://example.com")


class BrowserInspectionTests(unittest.TestCase):
    def read_tree(self, deep_node):
        root = Control("WindowControl", children=[Control("TabItemControl", "First tab"),
                       Control("EditControl", "Address and search bar"), deep_node])
        fake_auto = SimpleNamespace(UIAutomationInitializerInThread=nullcontext, ControlFromHandle=lambda _: root)
        with patch.dict("sys.modules", {"uiautomation": fake_auto}), \
                patch("sidecar.windows.browser_for_window", return_value="chrome"), \
                patch("win32gui.GetWindowText", return_value="Example"):
            return read_browser_tab(10)

    def test_depth_truncation_rejects_partial_tab_count(self):
        node = Control("TabItemControl", "Second tab")
        for _ in range(14):
            node = Control("PaneControl", children=[node])
        with self.assertRaisesRegex(ValueError, "incomplete"):
            self.read_tree(node)

    def test_leaf_at_depth_limit_is_a_complete_tree(self):
        node = Control("PaneControl")
        for _ in range(13):
            node = Control("PaneControl", children=[node])
        self.assertEqual(self.read_tree(node)["tabCount"], 1)

    def test_web_content_tabs_are_excluded_from_browser_count(self):
        node = Control("DocumentControl", children=[Control("TabItemControl", "Website tab")])
        self.assertEqual(self.read_tree(node)["tabCount"], 1)


if __name__ == "__main__":
    unittest.main()
