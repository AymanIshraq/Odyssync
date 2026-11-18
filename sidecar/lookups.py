"""Read-only voice lookups; all COM objects stay on their calling worker."""

import ntpath
from pathlib import Path
import stat

from sidecar.windows import (DESKTOP_CLASSES, OPEN_WINDOWS_LIMIT, browser_for_window, read_browser_tab,
                             window_process)

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


EXPLORER_FILES_LIMIT = 20
NOT_SELECTED = "That file is no longer selected in File Explorer"
NOT_ON_DESKTOP = "That file is no longer selected on the Desktop"
TWO_TABS = "Two Explorer tabs have a file with this name; close one tab"
SWC_DESKTOP = 8
SWFO_NEEDDISPATCH = 1


def selected_paths(window):
    items = window.Document.SelectedItems()
    return [items.Item(index).Path for index in range(items.Count)]


def regular_files(paths, files, limit):
    """Add regular files to `files` ({name: file}), one per name. A second, different
    file with the same name marks that name with "clash"."""
    for item in paths:
        path = Path(item)
        try:
            info = path.stat()
        except OSError:
            continue
        if not stat.S_ISREG(info.st_mode):
            continue
        known = files.get(path.name)
        if known is None:
            if len(files) < limit:
                files[path.name] = {"path": str(path), "name": path.name, "size": info.st_size}
        elif ntpath.normcase(known["path"]) != ntpath.normcase(str(path)):
            known["clash"] = True
    return files


def selected_files_from_shell(shell, hwnd, limit=EXPLORER_FILES_LIMIT):
    """Regular files selected in one Explorer window, in Explorer order; folders/virtual items skipped.

    Windows 11 Explorer tabs share one HWND: the selections of all its tabs are combined.
    """
    files = {}
    for window in shell.Windows():
        if int(window.HWND) == hwnd:
            regular_files(selected_paths(window), files, limit)
    return list(files.values())


def with_shell(function, *args):
    import pythoncom
    from win32com.client import Dispatch
    pythoncom.CoInitialize()
    try:
        return function(Dispatch("Shell.Application"), *args)
    finally:
        pythoncom.CoUninitialize()


def explorer_names(hwnds):
    """{hwnd: [file names]} for Explorer windows with at least one regular file selected."""
    return with_shell(names_from_shell, hwnds)


def names_from_shell(shell, hwnds):
    names = {}
    for hwnd in hwnds:
        try:
            files = selected_files_from_shell(shell, hwnd)
        except Exception:
            continue  # An unreadable window: not offered.
        if files:
            names[hwnd] = [file["name"] for file in files]
    return names


def pick_by_name(files, name, missing):
    for file in files:
        if file["name"] == name:
            if file.get("clash"):
                raise ValueError(TWO_TABS)
            return {key: value for key, value in file.items() if key != "clash"}
    raise ValueError(missing)


def named_file_from_shell(shell, hwnd, name):
    return pick_by_name(selected_files_from_shell(shell, hwnd), name, NOT_SELECTED)


def read_named_file(hwnd, name):
    return with_shell(named_file_from_shell, hwnd, name)


def desktop_view(shell):
    """The Desktop's folder view (same shape as an Explorer entry of Shell.Windows())."""
    import pythoncom
    from win32com.client import VARIANT, Dispatch
    windows = shell.Windows()
    attempts = (
        lambda: windows.FindWindowSW(VARIANT(pythoncom.VT_I4, 0), VARIANT(pythoncom.VT_EMPTY, None), SWC_DESKTOP,
                                     VARIANT(pythoncom.VT_BYREF | pythoncom.VT_I4, 0), SWFO_NEEDDISPATCH),
        lambda: windows.FindWindowSW(0, 0, SWC_DESKTOP, 0, SWFO_NEEDDISPATCH))
    error = None
    for attempt in attempts:
        try:
            view = attempt()
        except Exception as caught:
            error = caught
            continue
        if isinstance(view, tuple):  # Typed call: (dispatch, hwnd).
            view = view[0]
        if view is not None:
            return view if hasattr(view, "_oleobj_") else Dispatch(view)
    raise error or ValueError("No Desktop view")


def desktop_files_from_shell(shell, limit=EXPLORER_FILES_LIMIT):
    return list(regular_files(selected_paths(desktop_view(shell)), {}, limit).values())


def desktop_names():
    """File names selected on the Desktop; [] when none or it cannot be read."""
    try:
        return [file["name"] for file in with_shell(desktop_files_from_shell)]
    except Exception:
        return []


def desktop_file_from_shell(shell, name):
    return pick_by_name(desktop_files_from_shell(shell), name, NOT_ON_DESKTOP)


def read_desktop_file(name):
    return with_shell(desktop_file_from_shell, name)


def desktop_entry(desktop):
    """The Desktop as one Explorer-like entry, or None (nothing selected or unreadable)."""
    try:
        names = desktop_names()
        if not names:
            return None
        hwnd, pid = desktop.shell_window()
        return {"hwnd": hwnd, "pid": pid, "kind": "explorer", "where": "desktop", "app": "explorer.exe",
                "title": "Desktop", "names": names}
    except Exception:
        return None


def started_with_file(hwnd, title):
    """The swipe rule for an unknown program: its command line names the file its title shows."""
    from sidecar.documents import choose_document, is_regular_file, process_command_line, split_command_line
    try:
        handle = window_process(hwnd)
        try:
            command_line = process_command_line(handle)
        finally:
            handle.Close()
        choose_document(split_command_line(command_line), title, is_regular_file)
        return True
    except Exception:
        return False


def open_windows_reply(desktop):
    """Run on the lookup worker: list windows, keeping Explorers with selected files."""
    try:
        windows = desktop.open_windows()
        explorers = [window["hwnd"] for window in windows if window["kind"] == "explorer"]
        names = explorer_names(explorers) if explorers else {}
        offered = []
        for window in windows:
            if window["kind"] == "explorer":
                if window["hwnd"] not in names:
                    continue
                window = {**window, "names": names[window["hwnd"]]}
            elif window.get("needsCheck"):
                if not started_with_file(window["hwnd"], window["title"]):
                    continue
                window = {key: value for key, value in window.items() if key != "needsCheck"}
            offered.append(window)
            if len(offered) >= OPEN_WINDOWS_LIMIT:
                break
        entry = desktop_entry(desktop)
        if entry:
            offered = offered[:OPEN_WINDOWS_LIMIT - 1] + [entry]
        desktop.listed = {window["hwnd"]: window["pid"] for window in offered}
        return {"type": "OPEN_WINDOWS",
                "windows": [{key: value for key, value in window.items() if key != "pid"} for window in offered]}
    except ValueError as error:
        return {"type": "OPEN_WINDOWS", "error": str(error)}
    except Exception:
        return {"type": "OPEN_WINDOWS", "error": "Could not list open windows"}


def window_item_reply(hwnd, class_name, name=None):
    """Run on the lookup worker: read the one picked window without bringing it forward.

    name: which selected file of an Explorer window; echoed in every reply when given.
    """
    from sidecar.documents import read_window_document
    base = {"type": "WINDOW_ITEM", "hwnd": hwnd, **({"name": name} if name is not None else {})}
    try:
        if class_name in DESKTOP_CLASSES:  # Only the Desktop entry is listed with these classes.
            if not name:
                raise ValueError("Pick a file to send")
            data = read_desktop_file(name)
            item = {"kind": "file", "path": data["path"], "name": data["name"], "size": data["size"]}
        elif browser_for_window(hwnd):
            data = read_browser_tab(hwnd)
            item = {"kind": "tab", "url": data["url"], "title": data["title"],
                    "browser": data["browser"], "tabCount": data["tabCount"]}
        elif class_name == "CabinetWClass":
            if not name:
                raise ValueError("Pick a file to send")
            data = read_named_file(hwnd, name)
            item = {"kind": "file", "path": data["path"], "name": data["name"], "size": data["size"]}
        else:
            data = read_window_document(hwnd)
            item = {"kind": "document", "path": data["path"], "title": data["title"], "app": data["app"],
                    **({"keepSource": True} if data.get("keepSource") else {})}
        return {**base, **item}
    except ValueError as error:
        return {**base, "error": str(error)}
    except Exception:
        return {**base, "error": "Could not read that window"}


def lookup_reply(kind, hwnd):
    reply_type = "ACTIVE_TAB" if kind == "GET_ACTIVE_TAB" else "SELECTED_FILE"
    try:
        data = read_browser_tab(hwnd) if kind == "GET_ACTIVE_TAB" else read_selected_file(hwnd)
        return {"type": reply_type, **data}
    except Exception as error:
        # The contract uses the same reply type with `error`, not a new message.
        return {"type": reply_type, "error": str(error)}


def plain_files(files):
    return [{key: value for key, value in file.items() if key != "clash"} for file in files]


def current_item_reply(hwnd, class_name):
    """Run on the lookup worker: what the user is looking at right now (voice "send this")."""
    from sidecar.documents import read_window_document
    base = {"type": "CURRENT_ITEM"}
    try:
        if class_name in DESKTOP_CLASSES:
            files = plain_files(with_shell(desktop_files_from_shell))
            if not files:
                raise ValueError("No file is selected on the Desktop")
            item = {"kind": "files", "where": "desktop", "files": files}
        elif class_name == "CabinetWClass":
            files = plain_files(with_shell(selected_files_from_shell, hwnd))
            if not files:
                raise ValueError("No file is selected in File Explorer")
            item = {"kind": "files", "where": "explorer", "files": files}
        elif browser_for_window(hwnd):
            data = read_browser_tab(hwnd)
            item = {"kind": "tab", "url": data["url"], "title": data["title"],
                    "browser": data["browser"], "tabCount": data["tabCount"]}
        else:
            data = read_window_document(hwnd)
            item = {"kind": "document", "path": data["path"], "title": data["title"], "app": data["app"],
                    **({"keepSource": True} if data.get("keepSource") else {})}
        return {**base, **item}
    except ValueError as error:
        return {**base, "error": str(error)}
    except Exception:
        return {**base, "error": "Could not read that window"}
