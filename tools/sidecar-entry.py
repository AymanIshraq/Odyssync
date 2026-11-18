"""Frozen helper entry point, with a read-only native dependency smoke check."""

import json
import os
from pathlib import Path
import sys
import subprocess

if not getattr(sys, "frozen", False):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sidecar.win32_daemon import main


def self_test():
    """Check bundled DLLs and COM before distributing a build to other laptops."""
    from io import BytesIO
    import mss
    from PIL import Image
    import win32com.client
    from websockets.asyncio.client import connect
    from sidecar.windows import WindowsDesktop, enable_dpi_awareness, warm_browser_worker
    from sidecar.handoff import browser_launch_environment

    enable_dpi_awareness()
    warm_browser_worker()
    desktop = WindowsDesktop()
    desktop.sample()
    with mss.mss() as capture:
        assert capture.monitors, "No monitor found"
    image = BytesIO()
    Image.new("RGB", (2, 2)).save(image, format="JPEG")
    assert image.getvalue().startswith(b"\xff\xd8"), "JPEG encoder unavailable"
    with browser_launch_environment():
        subprocess.run([str(Path(os.environ["SystemRoot"]) / "System32" / "cmd.exe"),
                        "/d", "/c", "exit", "0"], check=True,
                       creationflags=subprocess.CREATE_NO_WINDOW)
    print(json.dumps({"selfTest": "passed", "frozen": bool(getattr(sys, "frozen", False)),
                      **desktop.screen_info()}), flush=True)


if __name__ == "__main__":
    from multiprocessing import freeze_support
    freeze_support()
    if sys.argv[1:] == ["--self-test"]:
        self_test()
    else:
        main()
