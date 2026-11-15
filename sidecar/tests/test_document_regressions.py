"""Regression coverage for real document detection failures and quick swipes."""

import asyncio
from pathlib import Path
from types import SimpleNamespace
import threading
import unittest
from unittest.mock import Mock, patch

from sidecar.documents import DocumentReadError, read_window_document, office_window_path
from sidecar.drag import Sample
from sidecar.handoff import WindowController, validate_open_file
from sidecar.notepad import TextSnapshots, read_notepad_controls, snapshot_name
from sidecar.win32_daemon import Outbox, poll_desktop


def control(kind, children=(), **fields):
    return SimpleNamespace(ControlTypeName=kind, GetChildren=lambda: children, **fields)


class NotepadTests(unittest.TestCase):
    def test_full_document_including_unsaved_unicode_and_empty_text(self):
        for text in ("", "unsaved café\r\n" * 1000):
            editor = control('DocumentControl', ClassName='RichEditD2DPT', IsOffscreen=False,
                             GetTextPattern=lambda: SimpleNamespace(DocumentRange=SimpleNamespace(GetText=lambda limit: text)))
            search = control('EditControl', ClassName='SearchBox', IsOffscreen=False)
            root = control('WindowControl', [control('TabItemControl'), control('TabItemControl'), search, editor])
            self.assertEqual(read_notepad_controls(root), (text, 2))
            copies = TextSnapshots()
            self.addCleanup(copies.directory.cleanup)
            saved = Path(copies.write('draft.txt', text))
            self.assertEqual(saved.read_bytes(), text.encode('utf-8'))

    def test_multiple_editors_or_truncated_text_never_sends_partial_contents(self):
        with self.assertRaises(ValueError):
            read_notepad_controls(control('WindowControl'))
        editor = control('DocumentControl', ClassName='RichEditD2DPT', IsOffscreen=False,
                         GetTextPattern=lambda: SimpleNamespace(DocumentRange=SimpleNamespace(GetText=lambda limit: 'abcdef')))
        with patch('sidecar.notepad.MAX_BYTES', 5), self.assertRaises(ValueError):
            read_notepad_controls(control('WindowControl', [editor]))
        with self.assertRaises(ValueError):
            read_notepad_controls(control('WindowControl', [editor, editor]))

    def test_snapshot_names_cannot_escape_temporary_folder_or_execute(self):
        self.assertEqual(snapshot_name('Untitled - Notepad'), 'Untitled.txt')
        self.assertEqual(snapshot_name('*notes.md - Notepad'), 'notes.md')
        self.assertEqual(snapshot_name('run.exe - Notepad'), 'run.exe.txt')
        self.assertEqual(snapshot_name('CON - Notepad'), '_CON.txt')
        self.assertNotIn('\\', snapshot_name('..\\escape.txt - Notepad'))

    def test_current_document_does_not_depend_on_process_start_arguments(self):
        gui = Mock()
        gui.GetWindowText.return_value = 'report.txt - Notepad'
        with patch.dict('sys.modules', {'win32gui': gui}), \
                patch('sidecar.documents.window_process', return_value=Mock()), \
                patch('sidecar.documents.process_exe', return_value='notepad.exe'), \
                patch('sidecar.documents.process_command_line') as command, \
                patch('sidecar.notepad.notepad_document', return_value=('C:\\temp\\report.txt', 2)), \
                patch('sidecar.documents.is_regular_file', return_value=True):
            result = read_window_document(10)
        command.assert_not_called()
        self.assertTrue(result['keepSource'])
        self.assertEqual(result['path'], 'C:\\temp\\report.txt')


class DocumentSafetyTests(unittest.TestCase):
    def test_unsaved_office_changes_require_save(self):
        doc = SimpleNamespace(FullName='C:\\Docs\\report.docx', Saved=False)
        office = SimpleNamespace(Windows=[SimpleNamespace(Hwnd=10, Document=doc)])
        with self.assertRaisesRegex(ValueError, 'Save the active Office'):
            office_window_path('winword.exe', office, 10, lambda hwnd: hwnd, lambda path: True)

    def test_dirty_editor_never_transfers_outdated_disk_contents(self):
        gui = Mock()
        gui.GetWindowText.return_value = '\u25cf C:\\Docs\\file.py - Visual Studio Code'
        with patch.dict('sys.modules', {'win32gui': gui}), \
                patch('sidecar.documents.window_process', return_value=Mock()), \
                patch('sidecar.documents.process_exe', return_value='code.exe'), \
                self.assertRaisesRegex(DocumentReadError, 'Save the active editor'):
            read_window_document(10)

    def test_office_only_accepts_appropriate_document_types(self):
        message = dict(transferId='t', path=str(Path('file.exe').resolve()), app='excel.exe', x=0, y=0, width=100, height=100)
        with self.assertRaises(ValueError):
            validate_open_file(message, is_file=lambda path: True)
        message['path'] = str(Path('file.xlsx').resolve())
        validate_open_file(message, is_file=lambda path: True)
        for expiry in (float('nan'), float('inf'), True, 'tomorrow'):
            with self.assertRaises(ValueError):
                validate_open_file({**message, 'expiresAt': expiry}, is_file=lambda path: True)

    def test_expired_open_never_launches(self):
        controller = WindowController.__new__(WindowController)
        controller.launch_document = Mock()
        with patch('sidecar.handoff.validate_open_file'), self.assertRaises(TimeoutError):
            controller.open_file({'path': 'unused', 'app': 'notepad.exe', 'expiresAt': 1}, threading.Event())
        controller.launch_document.assert_not_called()


class DelayedQualificationTests(unittest.IsolatedAsyncioTestCase):
    async def run_drag(self, *, focus_changes=False, failure=False):
        future = asyncio.get_running_loop().create_future()
        reader = Mock(submit=Mock(return_value=future))
        class Desktop:
            tick = 0
            def screen_info(self):
                return dict(screenWidth=1000, screenHeight=800, dpiScale=1)
            def sample(self):
                self.tick += 1
                # Release at tick 3, lookup completes only at tick 6 (like Office).
                if self.tick == 6:
                    if failure:
                        future.set_exception(DocumentReadError('Save this document first'))
                    else:
                        future.set_result(dict(hwnd=10, kind='document', path='C:\\report.txt', app='notepad.exe'))
                return Sample(11 if focus_changes and self.tick >= 4 else 10, False,
                              (self.tick, 100, 500, 500), (0 if self.tick <= 3 else 500, 120),
                              self.tick < 3, self.tick * .016, 'Notepad')
        box = Outbox()
        task = asyncio.create_task(poll_desktop(Desktop(), {'LEFT'}, box, reader))
        await asyncio.sleep(.18)
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        return list(box.lifecycle._queue)

    async def test_release_is_retained_while_office_read_finishes(self):
        events = await self.run_drag()
        self.assertEqual([e['type'] for e in events], ['LOCAL_DRAG_START', 'LOCAL_DRAG_MOVE', 'LOCAL_DRAG_END'])
        self.assertTrue(events[-1]['cursorAtEdge'])  # exact release, not the later cursor

    async def test_focus_change_cancels_late_qualification(self):
        self.assertEqual(await self.run_drag(focus_changes=True), [])

    async def test_document_error_reaches_electron_on_release(self):
        with self.assertLogs('sidecar.win32_daemon', level='INFO'):
            events = await self.run_drag(failure=True)
        self.assertEqual(events[0]['error'], 'Save this document first')
        self.assertEqual(events[-1]['type'], 'LOCAL_DRAG_END')


if __name__ == '__main__':
    unittest.main()
