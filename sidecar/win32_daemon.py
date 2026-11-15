"""Windows sidecar: browser drags, previews, and native handoff commands."""

import asyncio
from concurrent.futures import ThreadPoolExecutor
from contextlib import suppress
import json
import logging
from pathlib import Path
import sys
import threading

# Support both `python sidecar/win32_daemon.py` and `python -m sidecar.win32_daemon`.
if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sidecar.drag import DragTracker, FileDragTracker
from sidecar.handoff import WindowController
from sidecar.lookups import lookup_reply
from sidecar.preview import capture_preview
from sidecar.windows import WindowsDesktop, enable_dpi_awareness, read_browser_tab, warm_browser_worker

log = logging.getLogger(__name__)
BRIDGE_URL = "ws://127.0.0.1:8089"
POLL_SECONDS = 0.016


class BrowserReader:
    """Keep the single outstanding UIA job bounded across socket reconnects."""

    def __init__(self):
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="browser-uia")
        self.pending = None

    async def warm(self):
        await asyncio.get_running_loop().run_in_executor(self.executor, warm_browser_worker)

    def submit(self, hwnd):
        if self.pending is not None and not self.pending.done():
            return None
        self.pending = self.executor.submit(read_browser_tab, hwnd)
        return asyncio.wrap_future(self.pending)

    def close(self):
        self.executor.shutdown(wait=False, cancel_futures=True)


class PreviewReader(BrowserReader):
    """Independent bounded worker so a GPU capture cannot stall UIA or polling."""

    def submit(self, hwnd):
        if self.pending is not None and not self.pending.done():
            return None
        self.pending = self.executor.submit(capture_preview, hwnd)
        return asyncio.wrap_future(self.pending)


class LookupReader(BrowserReader):
    """Separate bounded voice worker; a blocked lookup cannot delay restoration."""

    def submit(self, kind, hwnd):
        if self.pending is not None and not self.pending.done():
            return None
        self.pending = self.executor.submit(lookup_reply, kind, hwnd)
        return asyncio.wrap_future(self.pending)


class Outbox:
    """Bounded lifecycle queue; movement occupies only one replaceable slot."""

    def __init__(self):
        self.lifecycle = asyncio.Queue(maxsize=64)
        self.move = None
        self.wake = asyncio.Event()

    def put(self, event):
        if isinstance(event, bytes):
            self.lifecycle.put_nowait(event)
        elif event["type"] == "LOCAL_DRAG_MOVE":
            self.move = event
        else:
            if event["type"] == "LOCAL_DRAG_END" and self.move is not None:
                # Freeze the last geometry ahead of END, so backpressure or a
                # following drag cannot discard the placement used by Electron.
                self.lifecycle.put_nowait(self.move)
                self.move = None
            # A stalled consumer must reconnect rather than accumulate old drags.
            self.lifecycle.put_nowait(event)
        self.wake.set()

    async def send(self, socket):
        while True:
            await self.wake.wait()
            self.wake.clear()
            while not self.lifecycle.empty():
                event = self.lifecycle.get_nowait()
                await socket.send(event if isinstance(event, bytes) else json.dumps(event))
            if self.move is not None:
                move, self.move = self.move, None
                await socket.send(json.dumps(move))


async def receive_commands(socket, active, controller=None, outbox=None, executor=None, stopped=None,
                           desktop=None, lookups=None):
    async for raw in socket:
        try:
            message = json.loads(raw)
            if not isinstance(message, dict):
                raise ValueError("Expected a JSON object")
            if message.get("type") == "SET_ACTIVE_EDGES":
                edges = ("left", "right", "top", "bottom")
                if not all(type(message.get(edge)) is bool for edge in edges):
                    raise ValueError("SET_ACTIVE_EDGES requires four booleans")
                active.clear()
                active.update(edge.upper() for edge in edges if message[edge])
            elif message.get("type") in ("GET_ACTIVE_TAB", "GET_SELECTED_FILE"):
                kind = message["type"]
                reply_type = "ACTIVE_TAB" if kind == "GET_ACTIVE_TAB" else "SELECTED_FILE"
                pending_lookup = None
                try:
                    if desktop is None or lookups is None or outbox is None:
                        raise ValueError("Voice lookup handler is unavailable")
                    hwnd = desktop.remembered_window(kind == "GET_ACTIVE_TAB")
                    pending_lookup = lookups.submit(kind, hwnd)
                    if pending_lookup is None:
                        raise RuntimeError("Previous voice lookup is still busy; try again")
                    result = await asyncio.wait_for(asyncio.shield(pending_lookup), 1.5)
                except TimeoutError:
                    result = {"type": reply_type, "error": "Window lookup timed out; try again"}
                except Exception as error:
                    result = {"type": reply_type, "error": str(error)}
                finally:
                    if pending_lookup is not None:
                        pending_lookup.add_done_callback(
                            lambda future: None if future.cancelled() else future.exception())
                if outbox is not None:
                    outbox.put(result)
            elif message.get("type") in ("HIDE_WINDOW", "SHOW_WINDOW", "CLOSE_WINDOW", "OPEN_URL", "BOUNCE_WINDOW"):
                if controller is None or outbox is None:
                    raise ValueError("Window command handler is unavailable")
                loop = asyncio.get_running_loop()
                try:
                    if message["type"] == "OPEN_URL":
                        result = await loop.run_in_executor(executor, controller.open_url, message, stopped)
                        outbox.put(result)
                    elif message["type"] == "BOUNCE_WINDOW":
                        await loop.run_in_executor(executor, controller.bounce,
                                                   message.get("hwnd"), message.get("edge"), stopped)
                    else:
                        operation = {"HIDE_WINDOW": controller.hide, "SHOW_WINDOW": controller.show,
                                     "CLOSE_WINDOW": controller.close}[message["type"]]
                        await loop.run_in_executor(executor, operation, message.get("hwnd"))
                except asyncio.QueueFull:
                    raise
                except Exception as error:
                    log.warning("Window command %s failed: %s", message["type"], error)
                    if message["type"] == "OPEN_URL":
                        outbox.put({"type": "OPEN_FAILED", "transferId": message.get("transferId"),
                                    "error": str(error)})
            else:
                log.warning("Command not implemented: %s", message.get("type"))
        except (ValueError, TypeError, UnicodeError):
            log.warning("Ignoring malformed bridge command", exc_info=True)


async def poll_desktop(desktop, active, outbox, reader, previews=None):
    tracker = DragTracker()
    files = FileDragTracker()
    pending = None
    pending_generation = None
    preview_pending = None
    preview_generation = None
    cache_generation = None
    preview_data = None
    preview_edge = None
    loop = asyncio.get_running_loop()
    try:
        while True:
            tick = loop.time()
            try:
                sample = desktop.sample()
                info = desktop.screen_info()
                for event in files.update(sample, (info["screenWidth"], info["screenHeight"]), active):
                    outbox.put(event)
                events, request = tracker.update(
                    sample, (info["screenWidth"], info["screenHeight"]), active)
                if cache_generation != tracker.generation:
                    cache_generation = tracker.generation
                    preview_data = None
                    preview_edge = None
                if preview_pending is not None and preview_pending.done():
                    try:
                        data = preview_pending.result()
                        if preview_generation == tracker.generation and tracker.started:
                            preview_data = data
                    except Exception:
                        log.warning("Window preview failed", exc_info=True)
                    preview_pending = None
                for event in events:
                    if event["type"] == "LOCAL_DRAG_MOVE" and previews is not None and tracker.started:
                        edge = event["edge"]
                        if edge is None:
                            preview_edge = None
                        elif preview_data is not None and edge != preview_edge:
                            outbox.put(preview_data)
                            preview_edge = edge
                        elif preview_data is None and preview_pending is None:
                            preview_pending = previews.submit(event["hwnd"])
                            preview_generation = tracker.generation
                    outbox.put(event)
                # Never stack UIA reads behind a blocked browser. A stale read
                # finishes in its worker but cannot qualify a later drag.
                if pending is not None and pending.done():
                    try:
                        start = tracker.qualify(pending_generation, pending.result())
                        if start:
                            outbox.put(start)
                    except Exception:
                        log.warning("Browser qualification failed; ignoring drag", exc_info=True)
                    pending = None
                if request and pending is None:
                    pending_generation, hwnd = request
                    pending = reader.submit(hwnd)
            except asyncio.QueueFull:
                raise RuntimeError("Bridge stalled; resetting drag session") from None
            except Exception:
                # If a window vanishes, cancel any already announced drag.
                if tracker.started:
                    outbox.put({"type": "LOCAL_DRAG_END", "hwnd": tracker.hwnd,
                                "edge": None, "cursorAtEdge": False, "velocity": 0.0})
                tracker.reset()
                if files.edge is not None:
                    outbox.put({"type": "LOCAL_FILE_DRAG", "active": False, "edge": files.edge})
                    files.edge = None
                log.exception("Desktop poll failed; continuing")
            await asyncio.sleep(max(0, POLL_SECONDS - (loop.time() - tick)))
    finally:
        for future in (pending, preview_pending):
            if future is not None:
                # Consume eventual errors without awaiting a slow native call.
                future.add_done_callback(lambda result: None if result.cancelled() else result.exception())


async def run_session(socket, desktop, reader, controller=None, previews=None, lookups=None):
    active = set()  # Tech 2 resends the layout after every SIDECAR_READY.
    outbox = Outbox()
    controller = controller or WindowController()
    own_previews = previews is None
    previews = previews or PreviewReader()
    own_lookups = lookups is None
    lookups = lookups or LookupReader()
    stopped = threading.Event()
    commands = ThreadPoolExecutor(max_workers=1, thread_name_prefix="window-commands")
    await socket.send(json.dumps({"type": "SIDECAR_READY", **desktop.screen_info()}))
    tasks = [asyncio.create_task(receive_commands(socket, active, controller, outbox, commands, stopped,
                                                  desktop, lookups)),
             asyncio.create_task(poll_desktop(desktop, active, outbox, reader, previews)),
             asyncio.create_task(outbox.send(socket))]
    try:
        done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in done:
            task.result()
    finally:
        stopped.set()
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        # Ordered after any in-flight command so a delayed hide cannot escape
        # restoration. A disconnect is never permission to close the original.
        await asyncio.get_running_loop().run_in_executor(commands, controller.restore_hidden)
        commands.shutdown(wait=False, cancel_futures=True)
        if own_previews:
            previews.close()
        if own_lookups:
            lookups.close()


async def run():
    from websockets.asyncio.client import connect
    desktop = WindowsDesktop()
    reader = BrowserReader()
    previews = PreviewReader()
    controller = WindowController()
    lookups = LookupReader()
    try:
        await reader.warm()
        await lookups.warm()
        while True:
            try:
                async with connect(BRIDGE_URL, proxy=None, compression=None,
                                   open_timeout=3, close_timeout=1,
                                   max_size=65536, max_queue=16, write_limit=16384) as socket:
                    await run_session(socket, desktop, reader, controller, previews, lookups)
            except (OSError, RuntimeError, ValueError) as error:
                log.warning("Bridge unavailable: %s; retrying in 1 s", error)
            except Exception:
                log.exception("Bridge session failed; retrying in 1 s")
            await asyncio.sleep(1)
    finally:
        reader.close()
        previews.close()
        lookups.close()


def main():
    enable_dpi_awareness()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    with suppress(KeyboardInterrupt):
        asyncio.run(run())


if __name__ == "__main__":
    main()
