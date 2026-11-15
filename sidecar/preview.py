"""Window snapshots and the contract's little-endian binary framing."""

from io import BytesIO
import json
import struct


def encode_preview(hwnd, image):
    from PIL import Image
    image = image.convert("RGB")
    if image.width > 800:
        image = image.resize((800, max(1, round(image.height * 800 / image.width))),
                             Image.Resampling.LANCZOS)
    payload = BytesIO()
    image.save(payload, "JPEG", quality=75)
    header = json.dumps({"type": "LOCAL_WINDOW_PREVIEW", "hwnd": hwnd,
                         "mime": "image/jpeg", "width": image.width,
                         "height": image.height}, separators=(",", ":")).encode("utf-8")
    return struct.pack("<I", len(header)) + header + payload.getvalue()


def mostly_black(image):
    # Ignore isolated bright pixels on failed GPU captures.
    histogram = image.convert("L").resize((64, 64)).histogram()
    return sum(histogram[:16]) / sum(histogram) > 0.98


def print_window(hwnd, width, height):
    """Release every GDI object even when capture or conversion fails."""
    import ctypes
    from ctypes import wintypes
    from PIL import Image
    import win32gui
    import win32ui
    window_dc = win32gui.GetWindowDC(hwnd)
    source = memory = bitmap = old_bitmap = None
    try:
        source = win32ui.CreateDCFromHandle(window_dc)
        memory = source.CreateCompatibleDC()
        bitmap = win32ui.CreateBitmap()
        bitmap.CreateCompatibleBitmap(source, width, height)
        old_bitmap = memory.SelectObject(bitmap)
        capture = ctypes.windll.user32.PrintWindow
        capture.argtypes = [wintypes.HWND, wintypes.HDC, wintypes.UINT]
        capture.restype = wintypes.BOOL
        if not capture(hwnd, memory.GetSafeHdc(), 2):  # PW_RENDERFULLCONTENT
            raise OSError("PrintWindow failed")
        return Image.frombuffer("RGB", (width, height), bitmap.GetBitmapBits(True),
                                "raw", "BGRX", 0, 1).copy()
    finally:
        if memory is not None and old_bitmap is not None:
            memory.SelectObject(old_bitmap)
        if bitmap is not None:
            win32gui.DeleteObject(bitmap.GetHandle())
        if memory is not None:
            memory.DeleteDC()
        if source is not None:
            source.DeleteDC()
        win32gui.ReleaseDC(hwnd, window_dc)


def screen_fallback(rect):
    """Capture the visible part, preserving full-window size and alignment."""
    import mss
    from PIL import Image
    left, top, right, bottom = rect
    image = Image.new("RGB", (right - left, bottom - top))
    with mss.mss() as screen:
        bounds = screen.monitors[0]
        x = max(left, bounds["left"])
        y = max(top, bounds["top"])
        end_x = min(right, bounds["left"] + bounds["width"])
        end_y = min(bottom, bounds["top"] + bounds["height"])
        if end_x <= x or end_y <= y:
            raise ValueError("Window is outside the visible desktop")
        shot = screen.grab({"left": x, "top": y, "width": end_x - x, "height": end_y - y})
        visible = Image.frombytes("RGB", shot.size, shot.rgb)
        image.paste(visible, (x - left, y - top))
    return image


def capture_preview(hwnd):
    import win32gui
    rect = win32gui.GetWindowRect(hwnd)
    width, height = rect[2] - rect[0], rect[3] - rect[1]
    if width <= 0 or height <= 0 or width * height > 40_000_000:
        raise ValueError("Invalid window capture dimensions")
    try:
        image = print_window(hwnd, width, height)
        if mostly_black(image):
            image = screen_fallback(rect)
    except OSError:
        image = screen_fallback(rect)
    return encode_preview(hwnd, image)
