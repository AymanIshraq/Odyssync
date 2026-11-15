"""Exercise native commands on a newly created blank browser window only."""

import argparse
import json
from pathlib import Path
import struct
import sys
import threading
import time
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from sidecar.handoff import WindowController
from sidecar.preview import capture_preview
from sidecar.lookups import lookup_reply
from sidecar.windows import enable_dpi_awareness


def main():
    enable_dpi_awareness()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--browser", choices=("chrome", "msedge", "brave"), default="chrome")
    parser.add_argument("--section3", action="store_true", help="Also verify tab lookup and four-edge bounce")
    args = parser.parse_args()
    controller = WindowController()
    created = None
    try:
        result = controller.open_url({"type": "OPEN_URL", "transferId": str(uuid.uuid4()),
                                      "url": "about:blank", "browser": args.browser,
                                      "x": 150, "y": 150, "width": 900, "height": 650},
                                     threading.Event())
        created = result["hwnd"]
        frame = capture_preview(created)
        length, = struct.unpack("<I", frame[:4])
        header = json.loads(frame[4:4 + length])
        controller.hide(created)
        hidden = not controller.gui.IsWindowVisible(created)
        controller.show(created)
        shown = bool(controller.gui.IsWindowVisible(created))
        print(json.dumps({"placed": result["type"] == "WINDOW_PLACED", "hidden": hidden,
                          "restored": shown, "previewWidth": header["width"],
                          "previewHeight": header["height"], "frameBytes": len(frame)}))
        if not hidden or not shown:
            raise RuntimeError("Native hide/restore check failed")
        if args.section3:
            reply = lookup_reply("GET_ACTIVE_TAB", created)
            if reply.get("tabCount") != 1 or not reply.get("url"):
                raise RuntimeError(f"Tab lookup failed: {reply.get('error', 'invalid tab metadata')}")
            bounce_results = []
            for edge in ("LEFT", "RIGHT", "TOP", "BOTTOM"):
                started = time.monotonic()
                controller.bounce(created, edge, threading.Event())
                left, top, right, bottom = controller.gui.GetWindowRect(created)
                area_left, area_top, area_right, area_bottom = controller.work_area()
                inside = left >= area_left and top >= area_top and right <= area_right and bottom <= area_bottom
                bounce_results.append({"edge": edge, "insideWorkArea": inside,
                                       "elapsedMs": round((time.monotonic() - started) * 1000, 1)})
                if not inside:
                    raise RuntimeError("Bounce left the test window outside the work area")
            print(json.dumps({"activeTabLookup": True, "bounces": bounce_results}))
    finally:
        controller.restore_hidden()
        if created is not None:
            controller.close(created)
            deadline = time.monotonic() + 2
            while controller.gui.IsWindow(created) and time.monotonic() < deadline:
                time.sleep(0.05)
            if controller.gui.IsWindow(created):
                raise RuntimeError("Test window did not close after WM_CLOSE")


if __name__ == "__main__":
    main()
