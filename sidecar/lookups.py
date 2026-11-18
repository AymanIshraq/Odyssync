"""Read-only voice lookups; all COM objects stay on their calling worker."""

from pathlib import Path
import stat

from sidecar.windows import browser_for_window, read_browser_tab

AMBIGUOUS = "File Explorer selection is unavailable or ambiguous; use a separate Explorer window"


def selection_from_shell(shell, hwnd):
    """Read exactly one file from the remembered Explorer, never another window."""
    selections = []
    for window in shell.Windows():
        if int(window.HWND) != hwnd:
            continue
        items = window.Document.SelectedItems()
        selections.append([items.Item(index).Path for index in range(items.Count)])
    if len(selections) > 1:
        # Windows 11 Explorer tabs share one HWND: use the one tab with one item selected.
        singles = [selection for selection in selections if len(selection) == 1]
        if len(singles) == 1:
            selections = singles
        elif not any(selections):
            raise ValueError("No file is selected in File Explorer")
        else:
            raise ValueError(AMBIGUOUS)
    if len(selections) != 1:
        raise ValueError(AMBIGUOUS)
    if not selections[0]:
        raise ValueError("No file is selected in File Explorer")
    if len(selections[0]) != 1:
        raise ValueError("Select exactly one file in File Explorer")
    path = Path(selections[0][0])
    try:
        info = path.stat()
    except OSError:
        raise ValueError("Could not read the selected file") from None
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


def explorer_names(hwnds):
    """{hwnd: file name} for Explorer windows with exactly one regular file selected."""
    import pythoncom
    from win32com.client import Dispatch
    pythoncom.CoInitialize()
    try:
        return names_from_shell(Dispatch("Shell.Application"), hwnds)
    finally:
        pythoncom.CoUninitialize()


def names_from_shell(shell, hwnds):
    names = {}
    for hwnd in hwnds:
        try:
            names[hwnd] = selection_from_shell(shell, hwnd)["name"]
        except Exception:
            continue  # Nothing, several, or an unreadable item selected: not offered.
    return names


def open_windows_reply(desktop):
    """Run on the lookup worker: list windows, keeping Explorers with one selected file."""
    try:
        windows = desktop.open_windows()
        explorers = [window["hwnd"] for window in windows if window["kind"] == "explorer"]
        names = explorer_names(explorers) if explorers else {}
        offered = []
        for window in windows:
            if window["kind"] == "explorer":
                if window["hwnd"] not in names:
                    continue
                window = {**window, "name": names[window["hwnd"]]}
            offered.append(window)
        desktop.listed = {window["hwnd"]: window["pid"] for window in offered}
        return {"type": "OPEN_WINDOWS",
                "windows": [{key: value for key, value in window.items() if key != "pid"} for window in offered]}
    except ValueError as error:
        return {"type": "OPEN_WINDOWS", "error": str(error)}
    except Exception:
        return {"type": "OPEN_WINDOWS", "error": "Could not list open windows"}


def window_item_reply(hwnd, class_name):
    """Run on the lookup worker: read the one picked window without bringing it forward."""
    from sidecar.documents import read_window_document
    try:
        if browser_for_window(hwnd):
            data = read_browser_tab(hwnd)
            item = {"kind": "tab", "url": data["url"], "title": data["title"],
                    "browser": data["browser"], "tabCount": data["tabCount"]}
        elif class_name == "CabinetWClass":
            data = read_selected_file(hwnd)
            item = {"kind": "file", "path": data["path"], "name": data["name"], "size": data["size"]}
        else:
            data = read_window_document(hwnd)
            item = {"kind": "document", "path": data["path"], "title": data["title"], "app": data["app"],
                    **({"keepSource": True} if data.get("keepSource") else {})}
        return {"type": "WINDOW_ITEM", "hwnd": hwnd, **item}
    except ValueError as error:
        return {"type": "WINDOW_ITEM", "hwnd": hwnd, "error": str(error)}
    except Exception:
        return {"type": "WINDOW_ITEM", "hwnd": hwnd, "error": "Could not read that window"}


def lookup_reply(kind, hwnd):
    reply_type = "ACTIVE_TAB" if kind == "GET_ACTIVE_TAB" else "SELECTED_FILE"
    try:
        data = read_browser_tab(hwnd) if kind == "GET_ACTIVE_TAB" else read_selected_file(hwnd)
        return {"type": reply_type, **data}
    except Exception as error:
        # The contract uses the same reply type with `error`, not a new message.
        return {"type": reply_type, "error": str(error)}
