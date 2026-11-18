"""Windows sidecar: browser and document drags, previews, and native handoff commands."""

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

from sidecar.documents import DocumentReadError, read_dragged_window
from sidecar.drag import DragTracker, FileDragTracker
from sidecar.handoff import WindowController
from sidecar.lookups import lookup_reply, open_windows_reply, window_item_reply
from sidecar.notepad import clear_snapshots
from sidecar.preview import capture_preview
from sidecar.windows import WindowsDesktop, enable_dpi_awareness, warm_browser_worker

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
        self.pending = self.executor.submit(read_dragged_window, hwnd)
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
        return self.call(lookup_reply, kind, hwnd)

    def call(self, function, *args):
        if self.pending is not None and not self.pending.done():
            return None
        self.pending = self.executor.submit(function, *args)
        return asyncio.wrap_future(self.pending)

    def abandon(self):
        """A native call is hung and Python cannot interrupt it. Leave that thread
        behind and continue on a fresh, warmed worker so later lookups still run."""
        if self.pending is None or self.pending.done():
            return
        old, self.executor = self.executor, ThreadPoolExecutor(max_workers=1, thread_name_prefix="lookup")
        self.pending = None
        old.shutdown(wait=False, cancel_futures=True)
        # Same warm step as startup; it queues ahead of the next lookup on this worker.
        warmed = self.executor.submit(warm_browser_worker)
        warmed.add_done_callback(lambda future: future.exception())


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
                           desktop=None, lookups=None, visibility_executor=None):
    opening = set()

    async def open_window(message):
        try:
            opener = controller.open_url if message["type"] == "OPEN_URL" else controller.open_file
            result = await asyncio.get_running_loop().run_in_executor(executor, opener, message, stopped)
        except Exception as error:
            log.warning("Window command %s failed: %s", message["type"], error)
            result = {"type": "OPEN_FAILED", "transferId": message.get("transferId"), "error": str(error)}
        outbox.put(result)

    try:
        await command_stream(socket, active, controller, outbox, executor, stopped, desktop, lookups,
                             opening, open_window, visibility_executor)
        await asyncio.gather(*opening)
    except BaseException:
        for task in opening:
            task.cancel()
        raise
    finally:
        await asyncio.gather(*opening, return_exceptions=True)


async def command_stream(socket, active, controller, outbox, executor, stopped, desktop, lookups,
                         opening, open_window, visibility_executor):
    async for raw in socket:
        for task in list(opening):
            if task.done():
                opening.remove(task)
                task.result()  # Propagate a response-queue failure instead of hiding it.
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

                def start(kind=kind):
                    if desktop is None or lookups is None or outbox is None:
                        raise ValueError("Voice lookup handler is unavailable")
                    return lookups.submit(kind, desktop.remembered_window(kind == "GET_ACTIVE_TAB"))

                result = await answer_lookup(lookups, start, {"type": reply_type}, 1.5,
                                             "Window lookup timed out; try again")
                if outbox is not None:
                    outbox.put(result)
            elif message.get("type") == "LIST_OPEN_WINDOWS":
                def start():
                    if desktop is None or lookups is None or outbox is None:
                        raise ValueError("Window list handler is unavailable")
                    return lookups.call(open_windows_reply, desktop)

                result = await answer_lookup(lookups, start, {"type": "OPEN_WINDOWS"}, 2.0,
                                             "Listing open windows timed out; try again", "Could not list open windows")
                if outbox is not None:
                    outbox.put(result)
            elif message.get("type") == "GET_WINDOW_ITEM":
                hwnd = message.get("hwnd")

                def start(hwnd=hwnd):
                    if desktop is None or lookups is None or outbox is None:
                        raise ValueError("Window read handler is unavailable")
                    class_name = desktop.listed_window(hwnd)
                    return lookups.call(window_item_reply, hwnd, class_name)

                result = await answer_lookup(lookups, start, {"type": "WINDOW_ITEM", "hwnd": hwnd}, 1.5,
                                             "Reading that window timed out; try again", "Could not read that window")
                if outbox is not None:
                    outbox.put(result)
            elif message.get("type") in ("HIDE_WINDOW", "SHOW_WINDOW", "CLOSE_WINDOW", "OPEN_URL", "OPEN_FILE",
                                         "BOUNCE_WINDOW"):
                if controller is None or outbox is None:
                    raise ValueError("Window command handler is unavailable")
                loop = asyncio.get_running_loop()
                try:
                    if message["type"] in ("OPEN_URL", "OPEN_FILE"):
                        opening.add(asyncio.create_task(open_window(message)))
                    elif message["type"] == "BOUNCE_WINDOW":
                        await loop.run_in_executor(executor, controller.bounce,
                                                   message.get("hwnd"), message.get("edge"), stopped)
                    else:
                        operation = {"HIDE_WINDOW": controller.hide, "SHOW_WINDOW": controller.show,
                                     "CLOSE_WINDOW": controller.close}[message["type"]]
                        # Visibility cannot wait behind a browser that is starting.
                        lane = visibility_executor if message["type"] in ("HIDE_WINDOW", "SHOW_WINDOW") else executor
                        await loop.run_in_executor(lane, operation, message.get("hwnd"))
                except asyncio.QueueFull:
                    raise
                except Exception as error:
                    log.warning("Window command %s failed: %s", message["type"], error)
                    if message["type"] in ("OPEN_URL", "OPEN_FILE"):
                        outbox.put({"type": "OPEN_FAILED", "transferId": message.get("transferId"),
                                    "error": str(error)})
            else:
                log.warning("Command not implemented: %s", message.get("type"))
        except (ValueError, TypeError, UnicodeError):
            log.warning("Ignoring malformed bridge command", exc_info=True)


async def answer_lookup(lookups, start, reply, seconds, timeout_error, fallback=None):
    """Run one lookup on the bounded worker; every failure becomes `reply` plus `error`.

    fallback: sentence used instead of non-ValueError text (e.g. raw pywintypes tuples).
    """
    pending_lookup = None
    try:
        pending_lookup = start()
        if pending_lookup is None:
            raise ValueError("A previous lookup is still busy; try again")
        return await asyncio.wait_for(asyncio.shield(pending_lookup), seconds)
    except TimeoutError:
        if lookups is not None:
            lookups.abandon()  # Never let a hung native call block every later lookup.
        return {**reply, "error": timeout_error}
    except Exception as error:
        return {**reply, "error": str(error) if fallback is None or isinstance(error, ValueError) else fallback}
    finally:
        if pending_lookup is not None:
            pending_lookup.add_done_callback(
                lambda future: None if future.cancelled() else future.exception())


async def poll_desktop(desktop, active, outbox, reader, previews=None, documents=None):
    tracker = DragTracker()
    files = FileDragTracker()
    pending = None
    pending_generation = None
    requested = None
    preview_pending = None
    preview_generation = None
    cache_generation = None
    preview_data = None
    preview_edge = None
    release_sample = None
    release_deadline = 0
    loop = asyncio.get_running_loop()
    try:
        while True:
            tick = loop.time()
            try:
                sample = desktop.sample()
                info = desktop.screen_info()
                for event in files.update(sample, (info["screenWidth"], info["screenHeight"]), active):
                    outbox.put(event)
                if release_sample is not None and (sample.pressed or sample.hwnd != release_sample.hwnd):
                    # A new gesture/focus change revokes a deferred release.
                    tracker.reset()
                    release_sample = None
                # Consume qualification BEFORE mouse-up resets the generation.
                if pending is not None and pending.done():
                    try:
                        start = tracker.qualify(pending_generation, pending.result())
                        if start:
                            if start.get("kind") == "document" and documents is not None:
                                documents.add(start["hwnd"])
                            outbox.put(start)
                    except Exception as error:
                        log.info("Window qualification failed: %s", error)
                        if isinstance(error, DocumentReadError) and pending_generation == tracker.generation:
                            start = tracker.qualify(pending_generation, {"hwnd": tracker.hwnd,
                                                    "kind": "document", "error": str(error)})
                            if start:
                                outbox.put(start)
                    pending = None
                qualifying = ((pending is not None and pending_generation == tracker.generation)
                              or (requested is not None and requested[0] == tracker.generation))
                if (release_sample is None and tracker.hwnd == sample.hwnd and not sample.pressed
                        and not tracker.started and qualifying):
                    # Office may finish a COM read only when its native move loop
                    # ends. Retain the exact release position, never a later cursor.
                    release_sample = sample
                    release_deadline = loop.time() + 2
                if release_sample is not None and qualifying and not tracker.started and loop.time() < release_deadline:
                    events, request = [], None
                else:
                    if release_sample is not None and qualifying and not tracker.started:
                        start = tracker.qualify(tracker.generation, {"hwnd": tracker.hwnd, "kind": "document",
                                                "error": "Reading this window took too long. Please try the swipe again."})
                        if start:
                            outbox.put(start)
                    events, request = tracker.update(
                        release_sample or sample, (info["screenWidth"], info["screenHeight"]), active)
                    release_sample = None
                if request:
                    requested = request
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
                # Keep only the current gesture while the bounded lookup worker is busy.
                if requested and requested != (tracker.generation, tracker.hwnd):
                    requested = None
                if requested and pending is None:
                    pending_generation, hwnd = requested
                    pending = reader.submit(hwnd)
                    if pending is not None:
                        requested = None
            except asyncio.QueueFull:
                raise RuntimeError("Bridge stalled; resetting drag session") from None
            except Exception:
                # If a window vanishes, cancel any already announced drag.
                if tracker.started:
                    outbox.put({"type": "LOCAL_DRAG_END", "hwnd": tracker.hwnd,
                                "edge": None, "cursorAtEdge": False, "velocity": 0.0})
                tracker.reset()
                release_sample = None
                requested = None
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
    visibility = ThreadPoolExecutor(max_workers=1, thread_name_prefix="window-visibility")
    await socket.send(json.dumps({"type": "SIDECAR_READY", **desktop.screen_info()}))
    tasks = [asyncio.create_task(receive_commands(socket, active, controller, outbox, commands, stopped,
                                                  desktop, lookups, visibility)),
             asyncio.create_task(poll_desktop(desktop, active, outbox, reader, previews,
                                              getattr(controller, "documents", None))),
             asyncio.create_task(outbox.send(socket))]
    tasks.append(asyncio.create_task(socket.wait_closed()))
    try:
        done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in done:
            task.result()
    finally:
        stopped.set()
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        # Drain in-flight visibility calls before restoring; no late hide may
        # run after disconnect cleanup has already shown the original window.
        await asyncio.get_running_loop().run_in_executor(visibility, lambda: None)
        # Ordered after any in-flight command so a delayed hide cannot escape
        # restoration. A disconnect is never permission to close the original.
        await asyncio.get_running_loop().run_in_executor(commands, controller.restore_hidden)
        clear_snapshots()
        commands.shutdown(wait=False, cancel_futures=True)
        visibility.shutdown(wait=False, cancel_futures=True)
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
