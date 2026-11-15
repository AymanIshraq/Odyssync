"""Which saved file a dragged non-browser window shows. Fails closed when unsure.

The choosing rules are pure functions; the Windows calls below them are thin.
Error messages never contain paths, titles, or command lines (they are logged).
"""

import ctypes
from ctypes import wintypes
import logging
import ntpath
import os
import re
import stat
import time

from sidecar.windows import browser_for_window, process_exe, read_browser_tab, window_process

log = logging.getLogger(__name__)

# Our own app (development and packaged names), plus the Explorer file-drop path.
NOT_DOCUMENT_APPS = frozenset({"electron.exe", "odyssync.exe", "explorer.exe"})
OFFICE_APPS = {"winword.exe": "Word.Application", "excel.exe": "Excel.Application",
               "powerpnt.exe": "PowerPoint.Application"}
# Editors whose window title starts with the active file's full path (README:
# the one-time "window.title" setting). Value: the exe under its install folder.
EDITOR_APPS = {"code.exe": "Microsoft VS Code\\Code.exe", "cursor.exe": "cursor\\Cursor.exe"}


class DocumentReadError(ValueError):
    """An actionable, path-free error for a supported document application."""


def is_regular_file(path) -> bool:
    try:
        return stat.S_ISREG(os.stat(path).st_mode)
    except (OSError, ValueError):
        return False


def is_local_absolute(path: str) -> bool:
    """A drive path such as C:\\x. Not UNC shares, not drive-relative C:x."""
    return re.match(r"[A-Za-z]:[\\/]", path) is not None


def title_mentions(title: str, name: str) -> bool:
    """The title shows the file's name or its name without extension, as a whole word."""
    stem = ntpath.splitext(name)[0]
    return any(word and re.search(r"(?<!\w)" + re.escape(word) + r"(?!\w)", title, re.IGNORECASE)
               for word in (name, stem))


def split_command_line(text: str) -> list:
    """Windows CommandLineToArgvW rules (as reimplemented by Wine), pure for testing."""
    # The program name has its own rule: no backslash escapes.
    if text.startswith('"'):
        end = text.find('"', 1)
        end = len(text) if end < 0 else end
        args, index = [text[1:end]], end + 1
    else:
        end = re.search(r"[ \t]|$", text).start()
        args, index = [text[:end]], end
    current, quotes, backslashes, started = [], 0, 0, False
    while index < len(text):
        character = text[index]
        if character in " \t" and quotes == 0:
            if started:
                args.append("".join(current) + "\\" * backslashes)
                current, backslashes, started = [], 0, False
            index += 1
            continue
        started = True
        if character == "\\":
            backslashes += 1
            index += 1
            continue
        if character == '"':
            # 2n backslashes + quote: n backslashes, quote toggles quoting.
            # 2n+1 backslashes + quote: n backslashes and a literal quote.
            current.append("\\" * (backslashes // 2))
            if backslashes % 2:
                current.append('"')
            else:
                quotes += 1
            backslashes = 0
            index += 1
            while index < len(text) and text[index] == '"':
                quotes += 1
                if quotes == 3:
                    current.append('"')
                    quotes = 0
                index += 1
            if quotes == 2:
                quotes = 0
            continue
        current.append("\\" * backslashes + character)
        backslashes = 0
        index += 1
    if started:
        args.append("".join(current) + "\\" * backslashes)
    return args


def choose_document(args: list, title: str, is_file) -> str:
    """The one existing file named after the program, which the title also shows.

    Options (-x, /x), URLs and relative paths (the program's working folder is
    unknown) are ignored. The title guard catches File > Open after start.
    """
    candidates = {}
    for arg in args[1:]:
        if not is_local_absolute(arg):
            continue  # Options, URLs, relative paths, UNC shares.
        path = ntpath.normpath(arg)
        if is_file(path):
            candidates[ntpath.normcase(path)] = path
    if len(candidates) != 1:
        raise ValueError(f"Window's program was started with {len(candidates)} files, not exactly one")
    path = next(iter(candidates.values()))
    if not title_mentions(title, ntpath.basename(path)):
        raise ValueError("Window title does not show the file it was started with")
    return path


def office_path(full_name, is_file) -> str:
    """A saved local Office document path, or raise (unsaved, online, missing)."""
    if not isinstance(full_name, str) or not full_name:
        raise ValueError("Office returned no document name")
    if "://" in full_name or full_name.lower().startswith(("http:", "https:")):
        raise ValueError("Office document is stored online, not as a local file")
    if not ntpath.dirname(full_name):
        raise ValueError("Office document has never been saved")
    if not is_local_absolute(full_name):
        raise ValueError("Office document is not on a local drive")
    path = ntpath.normpath(full_name)
    if not is_file(path):
        raise ValueError("Office document file does not exist")
    return path


def editor_title_path(title: str, is_file) -> str:
    """The active file's path at the start of an editor title, or raise.

    Needs the title setting in the README. A path may itself contain " - ",
    so the longest prefix ending at a separator (or the end) that is an
    existing file wins.
    """
    if title.startswith("\u25cf "):  # VS Code's ${dirty} marker: unsaved changes.
        title = title[2:]
    ends = [match.start() for match in re.finditer(r"(?= [-\u2014] )", title)] + [len(title)]
    for end in sorted(ends, reverse=True):
        candidate = title[:end]
        if not is_local_absolute(candidate):
            continue  # Untitled, remote, UNC, relative, or the default short-name title.
        path = ntpath.normpath(candidate)
        if is_file(path):
            return path
    raise ValueError("Editor title does not start with a file path; "
                     "set window.title to begin with ${activeEditorLong}")


def same_handle(a, b) -> bool:
    # COM returns a 32-bit Long; window handles are compared on their low 32 bits.
    return (int(a) & 0xFFFFFFFF) == (int(b) & 0xFFFFFFFF)


def office_window_path(app: str, office, hwnd: int, root, is_file) -> str:
    """Ask a running Office Application which document this window shows.

    `root(handle)` gives a handle's top-level window, in case Office reports
    an inner window. Member names follow Microsoft's object-model docs.
    """
    document = {
        "winword.exe": lambda window: window.Document,
        "excel.exe": lambda window: window.Parent,  # Window.Parent is the Workbook.
        "powerpnt.exe": lambda window: window.Presentation,
    }[app]
    names = []
    for window in office.Windows:
        # Docs spell it Hwnd (Word), hWnd (Excel), HWND (PowerPoint); generated
        # pywin32 wrappers are case-sensitive, so try each spelling.
        handle = next((getattr(window, name) for name in ("Hwnd", "hWnd", "HWND")
                       if hasattr(window, name)), None)
        if handle is None:
            raise ValueError("Office window has no handle property")
        handle = int(handle) & 0xFFFFFFFF
        if same_handle(handle, hwnd) or same_handle(root(handle), hwnd):
            current = document(window)
            if getattr(current, "Saved", True) is False:
                raise ValueError("Save the active Office document before swiping it")
            names.append(current.FullName)
    if len(names) != 1:
        raise ValueError("Office has no single document window for this handle")
    return office_path(names[0], is_file)


class UnicodeString(ctypes.Structure):
    _fields_ = [("Length", wintypes.USHORT), ("MaximumLength", wintypes.USHORT),
                ("Buffer", ctypes.c_void_p)]


def process_command_line(handle) -> str:
    """One kernel call (ProcessCommandLineInformation, Windows 8.1+); no COM/WMI."""
    query = ctypes.WinDLL("ntdll").NtQueryInformationProcess
    query.argtypes = [wintypes.HANDLE, wintypes.ULONG, ctypes.c_void_p, wintypes.ULONG,
                      ctypes.POINTER(wintypes.ULONG)]
    query.restype = ctypes.c_long
    header = ctypes.sizeof(UnicodeString)
    buffer = ctypes.create_string_buffer(header + 0x10000)  # Command lines max out at 64 KB.
    returned = wintypes.ULONG()
    status = query(int(handle), 60, buffer, len(buffer), ctypes.byref(returned))
    if status != 0:
        raise OSError(f"NtQueryInformationProcess failed: 0x{status & 0xFFFFFFFF:08X}")
    text = UnicodeString.from_buffer(buffer)
    start = ctypes.addressof(buffer)
    if not text.Length or not text.Buffer:
        return ""
    if not start <= text.Buffer <= start + len(buffer) - text.Length:
        raise OSError("Command line is outside the returned buffer")
    return ctypes.wstring_at(text.Buffer, text.Length // 2)


def window_root(handle: int) -> int:
    get_ancestor = ctypes.windll.user32.GetAncestor
    get_ancestor.argtypes = [wintypes.HWND, wintypes.UINT]
    get_ancestor.restype = wintypes.HWND
    return get_ancestor(handle, 2) or 0  # GA_ROOT


def office_document(app: str, hwnd: int) -> str:
    import pythoncom
    from win32com.client import GetActiveObject
    pythoncom.CoInitialize()
    try:
        # The Application object is released when this call returns, before uninitialising.
        # Bind to THIS window first. GetActiveObject alone can point to a
        # different Office instance, or fail before Office registers in the ROT.
        try:
            return native_office_path(app, hwnd)
        except ValueError:
            raise
        except Exception:
            return office_window_path(app, GetActiveObject(OFFICE_APPS[app]), hwnd, window_root,
                                      is_regular_file)
    finally:
        pythoncom.CoUninitialize()


def native_office_path(app, hwnd):
    """Use Office's documented OBJID_NATIVEOM interface on the dragged window.

    https://learn.microsoft.com/windows/win32/api/oleacc/nf-oleacc-accessibleobjectfromwindow
    COM references remain on the qualification worker and are released here.
    """
    import win32gui
    from comtypes import GUID
    from comtypes.automation import IDispatch
    from comtypes.client.dynamic import Dispatch

    class_name = {"winword.exe": "_WwG", "excel.exe": "EXCEL7", "powerpnt.exe": "paneClassDC"}[app]
    children = []
    win32gui.EnumChildWindows(hwnd, lambda child, _: children.append(child)
                             if win32gui.GetClassName(child) == class_name else None, None)
    if not children:
        raise RuntimeError("Office native window is unavailable")
    accessible = ctypes.WinDLL("oleacc").AccessibleObjectFromWindow
    accessible.argtypes = [wintypes.HWND, wintypes.DWORD, ctypes.POINTER(GUID),
                          ctypes.POINTER(ctypes.POINTER(IDispatch))]
    accessible.restype = ctypes.c_long
    for child in children:
        pointer = ctypes.POINTER(IDispatch)()
        if accessible(child, 0xFFFFFFF0, ctypes.byref(IDispatch._iid_), ctypes.byref(pointer)) != 0:
            continue
        window = Dispatch(pointer)
        return office_window_path(app, window.Application, hwnd, window_root, is_regular_file)
    raise RuntimeError("Office native document is unavailable")


def read_window_document(hwnd: int) -> dict:
    """Run on the qualification worker. Level 3 asks Office; editors give the path in
    their title; Level 2 reads the command line."""
    import win32gui
    started = time.monotonic()
    title = win32gui.GetWindowText(hwnd)
    handle = window_process(hwnd)
    try:
        app = process_exe(handle)
        if app in NOT_DOCUMENT_APPS:
            raise ValueError("Window belongs to a program that never shows a document")
        command_line = ("" if app in OFFICE_APPS or app in EDITOR_APPS or app == "notepad.exe"
                        else process_command_line(handle))
    finally:
        handle.Close()
    keep_source = False
    try:
        if app in OFFICE_APPS:
            path = office_document(app, hwnd)
        elif app in EDITOR_APPS:
            if title.startswith("\u25cf "):
                raise ValueError("Save the active editor file before swiping it")
            path = editor_title_path(title, is_regular_file)
        elif app == "notepad.exe":
            from sidecar.notepad import notepad_document
            path, tabs = notepad_document(hwnd, title)
            # Never close other documents in a tabbed Notepad window.
            keep_source = tabs > 1
        else:
            path = choose_document(split_command_line(command_line), title, is_regular_file)
    except Exception as error:
        if app in OFFICE_APPS or app in EDITOR_APPS or app == "notepad.exe":
            message = str(error) if isinstance(error, ValueError) else "Could not read this document. Save it locally and try again."
            raise DocumentReadError(message) from None
        raise
    if not is_regular_file(path):
        raise ValueError("Document file does not exist")
    log.info("Document qualification: %.1f ms, app=%s",
             (time.monotonic() - started) * 1000, app)
    return {"hwnd": hwnd, "kind": "document", "path": path, "title": title, "app": app,
            **({"keepSource": True} if keep_source else {})}


def read_dragged_window(hwnd: int) -> dict:
    """Qualification worker entry: browsers by tab, every other program by document."""
    if browser_for_window(hwnd):
        return read_browser_tab(hwnd)
    return read_window_document(hwnd)
