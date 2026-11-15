"""A receiver's slow browser startup must not delay hiding a sender window."""
import asyncio
from concurrent.futures import ThreadPoolExecutor
import json
import threading
import unittest
from unittest.mock import Mock
from unittest.mock import patch

from sidecar.handoff import WindowController
from sidecar.win32_daemon import Outbox, receive_commands


class ImmediateHideTests(unittest.IsolatedAsyncioTestCase):
    async def test_hide_runs_while_an_incoming_browser_open_is_still_busy(self):
        await self.check_busy_open("OPEN_URL")

    async def test_hide_runs_while_an_incoming_document_open_is_still_busy(self):
        await self.check_busy_open("OPEN_FILE")

    async def check_busy_open(self, kind):
        started, release, finished = threading.Event(), threading.Event(), threading.Event()
        hidden_while_opening = []
        controller = Mock()

        def opening(message, stopped):
            started.set()
            release.wait(2)
            finished.set()
            return {"type": "WINDOW_PLACED", "transferId": "incoming", "hwnd": 20}

        controller.open_url.side_effect = opening
        controller.open_file.side_effect = opening
        controller.hide.side_effect = lambda hwnd: hidden_while_opening.append(not finished.is_set())

        class Socket:
            def __aiter__(self):
                return self.messages()

            async def messages(self):
                yield json.dumps({"type": kind, "transferId": "incoming"})
                await asyncio.to_thread(started.wait, 2)
                yield json.dumps({"type": "HIDE_WINDOW", "hwnd": 10})
                release.set()

        with ThreadPoolExecutor(max_workers=1) as commands:
            try:
                await receive_commands(Socket(), set(), controller, Outbox(), commands, threading.Event())
            finally:
                release.set()
        self.assertEqual(hidden_while_opening, [True])

    def test_expired_queued_open_does_not_create_a_late_duplicate(self):
        controller = WindowController()
        controller.window_handles = Mock(return_value=set())
        controller.launch = Mock()
        message = {"transferId": "expired", "url": "https://example.com", "browser": "chrome",
                   "x": 10, "y": 10, "width": 900, "height": 650, "expiresAt": 0}
        with patch("sidecar.handoff.find_browser", return_value="chrome.exe"), self.assertRaises(TimeoutError):
            controller.open_url(message, threading.Event())
        controller.launch.assert_not_called()
