"""Read-only voice lookups; all COM objects stay on their calling worker."""

from pathlib import Path
import stat

from sidecar.windows import read_browser_tab


def selection_from_shell(shell, hwnd):
    """Read exactly one file from the remembered Explorer, never another window."""
    selections = []
    for window in shell.Windows():
        if int(window.HWND) != hwnd:
            continue
        items = window.Document.SelectedItems()
        selections.append([items.Item(index).Path for index in range(items.Count)])
    if len(selections) != 1:
        raise ValueError("File Explorer selection is unavailable or ambiguous; use a separate Explorer window")
    if not selections[0]:
        raise ValueError("No file is selected in File Explorer")
    if len(selections[0]) != 1:
        raise ValueError("Select exactly one file in File Explorer")
    path = Path(selections[0][0])
    info = path.stat()
    if not stat.S_ISREG(info.st_mode):
        raise ValueError("Select a regular file, not a folder or virtual item")
    return {"path": str(path), "name": path.name, "size": info.st_size}


def read_selected_file(hwnd):
    import pythoncom
    from win32com.client import Dispatch
    pythoncom.CoInitialize()
    try:
        return selection_from_shell(Dispatch("Shell.Application"), hwnd)
    finally:
        pythoncom.CoUninitialize()


def lookup_reply(kind, hwnd):
    reply_type = "ACTIVE_TAB" if kind == "GET_ACTIVE_TAB" else "SELECTED_FILE"
    try:
        data = read_browser_tab(hwnd) if kind == "GET_ACTIVE_TAB" else read_selected_file(hwnd)
        return {"type": reply_type, **data}
    except Exception as error:
        # The contract uses the same reply type with `error`, not a new message.
        return {"type": reply_type, "error": str(error)}
