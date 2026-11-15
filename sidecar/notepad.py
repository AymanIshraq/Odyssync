"""Read the active Notepad document without keystrokes or clipboard changes.

Modern Notepad restores tabs and reuses its process, so process arguments cannot
identify its active file. TextPattern.DocumentRange exposes the complete text,
including unsaved changes. Send a UTF-8 snapshot; never rewrite the source file.
"""

from collections import deque
from pathlib import Path
import re
import tempfile
import threading
import time
import uuid

MAX_BYTES = 50 * 1024 * 1024
_snapshots = None
_snapshot_lock = threading.Lock()


class TextSnapshots:
    """Private temporary copies, retained longer than the transfer timeout."""

    def __init__(self):
        self.directory = tempfile.TemporaryDirectory(prefix="odyssync-notepad-")
        self.entries = []

    def write(self, name, text):
        data = text.encode("utf-8")
        if len(data) > MAX_BYTES:
            raise ValueError("Notepad document is too large (max 50 MB)")
        now = time.monotonic()
        for created, path, size in list(self.entries):
            if now - created > 300:
                path.unlink(missing_ok=True)
                path.parent.rmdir()
                self.entries.remove((created, path, size))
        if len(self.entries) >= 128 or sum(size for _, _, size in self.entries) + len(data) > 256 * 1024 * 1024:
            raise ValueError("Too many recent Notepad transfers; try again in a few minutes")
        folder = Path(self.directory.name) / uuid.uuid4().hex
        folder.mkdir()
        path = folder / name
        path.write_bytes(data)
        self.entries.append((now, path, len(data)))
        return str(path)


def snapshot_name(title):
    name = title.removesuffix(" - Notepad").lstrip("* ").strip()
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name).rstrip(". ")[:180] or "Untitled"
    if re.match(r"^(CON|PRN|AUX|NUL|COM\d|LPT\d)(\.|$)", name, re.I):
        name = "_" + name
    # Text snapshots are plain text. Keep familiar text names, otherwise .txt.
    if Path(name).suffix.lower() not in (".txt", ".md", ".log", ".csv", ".json", ".xml"):
        name += ".txt"
    return name


def read_notepad_controls(root):
    """Return complete text and tab count; never use visible text fragments."""
    queue = deque([(root, 0)])
    editors, tabs = [], 0
    visited = 0
    while queue:
        control, depth = queue.popleft()
        visited += 1
        if visited > 300 or depth > 16:
            raise ValueError("Notepad's document controls could not be read")
        kind = control.ControlTypeName
        if kind == "TabItemControl":
            tabs += 1
            continue
        if kind in ("EditControl", "DocumentControl"):
            if control.ClassName in ("RichEditD2DPT", "RICHEDIT50W", "Edit") and not control.IsOffscreen:
                editors.append(control)
            continue
        queue.extend((child, depth + 1) for child in control.GetChildren())
    if len(editors) != 1:
        raise ValueError("Could not identify the active Notepad document")
    # One extra character detects truncation. The encoded byte limit is checked
    # separately because a Unicode character can occupy several bytes.
    text = editors[0].GetTextPattern().DocumentRange.GetText(MAX_BYTES + 1)
    if not isinstance(text, str) or len(text) > MAX_BYTES:
        raise ValueError("Notepad document is too large or could not be read")
    # RichEdit's TextPattern uses bare CR for paragraph breaks. Emit standard
    # Windows text so other editors also display the same lines.
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\n", "\r\n")
    return text, max(1, tabs)


def notepad_document(hwnd, title):
    import uiautomation as auto
    import win32gui
    global _snapshots
    with auto.UIAutomationInitializerInThread():
        text, tabs = read_notepad_controls(auto.ControlFromHandle(hwnd))
    if win32gui.GetWindowText(hwnd) != title:
        raise ValueError("The active Notepad tab changed; swipe it again")
    with _snapshot_lock:
        if _snapshots is None:
            _snapshots = TextSnapshots()
        return _snapshots.write(snapshot_name(title), text), tabs


def clear_snapshots():
    """The bridge session ended; no pending file send can use these copies."""
    global _snapshots
    with _snapshot_lock:
        if _snapshots is not None:
            _snapshots.directory.cleanup()
            _snapshots = None
