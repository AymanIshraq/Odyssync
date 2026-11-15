"""Print URL/tab count and elapsed time for each browser drag; Ctrl+C exits."""

import asyncio
import json
from pathlib import Path
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from sidecar.drag import DragTracker
from sidecar.win32_daemon import BrowserReader
from sidecar.windows import WindowsDesktop, enable_dpi_awareness


async def observe():
    desktop = WindowsDesktop()
    tracker = DragTracker()
    reader = BrowserReader()
    pending = None
    started = 0.0
    try:
        await reader.warm()
        print("Drag a Chrome/Edge/Brave window. URLs are printed locally; Ctrl+C exits.", flush=True)
        while True:
            sample = desktop.sample()
            info = desktop.screen_info()
            _, request = tracker.update(sample, (info["screenWidth"], info["screenHeight"]), set())
            if pending is not None and pending.done():
                elapsed = (time.monotonic() - started) * 1000
                try:
                    result = pending.result()
                    print(json.dumps({**result, "elapsedMs": round(elapsed, 1),
                                      "within300ms": elapsed <= 300}), flush=True)
                except Exception as error:
                    print(json.dumps({"error": str(error), "elapsedMs": round(elapsed, 1)}), flush=True)
                pending = None
            if request and pending is None:
                started = time.monotonic()
                pending = reader.submit(request[1])
            await asyncio.sleep(0.016)
    finally:
        reader.close()


def main():
    enable_dpi_awareness()
    try:
        asyncio.run(observe())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
