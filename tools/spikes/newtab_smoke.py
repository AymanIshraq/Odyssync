"""Verify native blank-tab qualification and reopening using temporary windows."""
import json
from pathlib import Path
import sys
import threading
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from sidecar.handoff import WindowController
from sidecar.windows import enable_dpi_awareness, read_browser_tab


def inspect(hwnd):
    deadline = time.monotonic() + 3
    while True:
        try:
            return read_browser_tab(hwnd)
        except ValueError:
            if time.monotonic() >= deadline:
                raise
            time.sleep(0.1)


def main():
    enable_dpi_awareness()
    controller = WindowController()
    created = []
    stopped = threading.Event()
    message = {"transferId": "newtab-source", "browser": "chrome", "url": "chrome://newtab/",
               "x": 100, "y": 100, "width": 900, "height": 650}
    try:
        source = controller.open_url(message, stopped)["hwnd"]
        created.append(source)
        controller.gui.ShowWindow(source, 9)  # SW_RESTORE: simulate a small sender.
        controller.place(source, (100, 100, 900, 650))
        assert controller.gui.GetWindowPlacement(source)[1] != 3, "Source must start windowed"
        tab = inspect(source)
        assert tab["tabCount"] == 1 and tab["url"] == "chrome://newtab/", tab
        controller.hide(source)
        destination = controller.open_url({**message, "transferId": "newtab-receiver",
                                           "url": tab["url"], "x": 300}, stopped)["hwnd"]
        created.append(destination)
        assert controller.gui.GetWindowPlacement(destination)[1] == 3, "Received browser did not maximize"
        received = inspect(destination)
        assert received["tabCount"] == 1 and received["url"] == "chrome://newtab/", received
        # Mirror the handoff's confirmation rule: close only after placement.
        controller.close(source)
        print(json.dumps({"blankSourceQualified": True, "blankReceiverPlaced": True,
                          "smallSenderReceivedMaximized": True,
                          "sourceClosedAfterPlacement": not controller.gui.IsWindow(source)}))
        assert not controller.gui.IsWindow(source)
    finally:
        controller.restore_hidden()
        for hwnd in created:
            if controller.gui.IsWindow(hwnd):
                controller.close(hwnd)


if __name__ == "__main__":
    main()
