r"""Windows-only document capture/open checks, using disposable files and windows.

Run from the repo: .venv\Scripts\python.exe tools/spikes/document_smoke.py
Does not connect to a room or touch user documents. The JS handoff tests cover
transport messages; this exercises the real Notepad/Office/editor APIs.
"""

import argparse
import json
from pathlib import Path
import shutil
import sys
import tempfile
import threading
import time
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from sidecar.documents import read_window_document
from sidecar.handoff import WindowController
from sidecar.windows import enable_dpi_awareness


def close_notepad_tab(hwnd, name):
    """Only the named disposable tab; other restored Notepad tabs stay open."""
    import uiautomation as auto
    with auto.UIAutomationInitializerInThread():
        queue = [auto.ControlFromHandle(hwnd)]
        while queue:
            control = queue.pop()
            if control.ControlTypeName == 'TabItemControl':
                if control.Name.startswith(name + '.'):
                    control.GetSelectionItemPattern().Select()
                    for child in control.GetChildren():
                        if child.ControlTypeName == 'ButtonControl' and child.Name == 'Close Tab':
                            child.GetInvokePattern().Invoke()
                            return
                continue
            if control.ControlTypeName not in ('EditControl', 'DocumentControl'):
                queue.extend(control.GetChildren())


def open_message(path, app):
    return dict(type='OPEN_FILE', transferId=str(uuid.uuid4()), path=str(path), app=app,
                x=160, y=140, width=850, height=650, expiresAt=time.time() * 1000 + 20000)


def check(app, directory):
    import win32com.client
    controller = WindowController()
    source_handle = receiver_handle = None
    office = None
    extension = {'notepad.exe': '.txt', 'code.exe': '.py', 'winword.exe': '.docx', 'excel.exe': '.xlsx'}[app]
    source = directory / ('odyssync-source-' + uuid.uuid4().hex[:8] + extension)
    received = directory / ('odyssync-received-' + uuid.uuid4().hex[:8] + extension)
    try:
        if app in ('winword.exe', 'excel.exe'):
            office = win32com.client.DispatchEx('Word.Application' if app == 'winword.exe' else 'Excel.Application')
            office.Visible = True
            if app == 'winword.exe':
                doc = office.Documents.Add()
                doc.Content.Text = 'Odyssync document handoff test.'
                doc.SaveAs2(str(source), FileFormat=16)
                source_handle = int(doc.ActiveWindow.Hwnd)
            else:
                doc = office.Workbooks.Add()
                doc.Worksheets(1).Cells(1, 1).Value = 'Odyssync document handoff test.'
                doc.SaveAs(str(source), FileFormat=51)
                source_handle = int(doc.Windows(1).Hwnd)
        else:
            source.write_bytes('# Odyssync café\r\n# second line\r\n'.encode('utf-8'))
            source_handle = controller.open_file(open_message(source, app), threading.Event())['hwnd']
        result = read_window_document(source_handle)
        assert result['kind'] == 'document' and result['app'] == app
        captured = Path(result['path']).read_bytes()
        assert captured == source.read_bytes(), 'capture changed the file contents'
        shutil.copyfile(result['path'], received)
        reply = controller.open_file(open_message(received, app), threading.Event())
        receiver_handle = reply['hwnd']
        assert reply['type'] == 'WINDOW_PLACED'
        assert controller.gui.IsWindowVisible(receiver_handle)
        assert controller.gui.GetWindowPlacement(receiver_handle)[1] == 3, 'Receiver did not maximize'
        print(json.dumps(dict(app=app, capture=True, bytesMatch=True, receiverOpened=True, receiverMaximized=True)), flush=True)
    finally:
        if receiver_handle:
            if app == 'notepad.exe':
                close_notepad_tab(receiver_handle, received.name)
            else:
                controller.gui.PostMessage(receiver_handle, 0x10, 0, 0)
        if office is not None:
            office.Quit()
        elif source_handle:
            if app == 'notepad.exe':
                close_notepad_tab(source_handle, source.name)
            else:
                controller.gui.PostMessage(source_handle, 0x10, 0, 0)
        time.sleep(.5)  # let the disposable document release its file handle


def main():
    enable_dpi_awareness()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apps', nargs='+', default=['notepad', 'winword', 'excel', 'code'],
                        choices=['notepad', 'winword', 'excel', 'code'])
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='odyssync-document-smoke-') as folder:
        for app in args.apps:
            check(app + '.exe', Path(folder))


if __name__ == '__main__':
    main()
