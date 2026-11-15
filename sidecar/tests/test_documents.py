"""Document drags and OPEN_FILE. Pure rules and fakes only: runs without Windows."""

import asyncio
import json
from pathlib import Path
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from sidecar.documents import (EDITOR_APPS, choose_document, editor_title_path, office_path,
                               office_window_path, read_dragged_window, read_window_document,
                               split_command_line, title_mentions)
from sidecar.drag import DragTracker, Sample, normalize_url
from sidecar.handoff import (DocumentWindows, WindowController, choose_opened_window, editor_install_path,
                             find_browser, find_editor, validate_open_file)
from sidecar.windows import process_exe
from sidecar.win32_daemon import Outbox, poll_desktop, receive_commands


def fake_win32():
    return patch.dict("sys.modules", {"win32api": Mock(), "win32gui": Mock(), "win32process": Mock()})


class LocalFileUrlTests(unittest.TestCase):
    def test_local_file_forms_become_one_canonical_url(self):
        expected = "file:///C:/Users/Rafi/My%20Docs/a.pdf"
        for value in ("file:///C:/Users/Rafi/My Docs/a.pdf", "file:///C:/Users/Rafi/My%20Docs/a.pdf",
                      "C:/Users/Rafi/My Docs/a.pdf", "C:\\Users\\Rafi\\My Docs\\a.pdf",
                      "c:/Users/Rafi/My Docs/a.pdf", "FILE:///C:/Users/Rafi/My Docs/a.pdf",
                      "file://C:/Users/Rafi/My Docs/a.pdf", "  file:///C:\\Users\\Rafi\\My Docs\\a.pdf  ",
                      "file:///C:/Users/Rafi/My%20Docs/a.pdf#page=2"):
            with self.subTest(value=value):
                self.assertEqual(normalize_url(value, "chrome"), expected)

    def test_other_characters_and_idempotence(self):
        self.assertEqual(normalize_url("C:\\Users\\Rafi\\a.pdf", "msedge"), "file:///C:/Users/Rafi/a.pdf")
        self.assertEqual(normalize_url("C:/x/100% sure (1).pdf", "chrome"),
                         "file:///C:/x/100%25%20sure%20%281%29.pdf")
        self.assertEqual(normalize_url("C:/x/r\u00e9sum\u00e9.pdf", "chrome"),
                         "file:///C:/x/r%C3%A9sum%C3%A9.pdf")
        for value in ("C:/My Docs/a b.pdf", "C:/x/100% sure.pdf", "file:///C:/a%25b.txt"):
            once = normalize_url(value, "chrome")
            self.assertEqual(normalize_url(once, "chrome"), once)

    def test_unc_and_broken_local_forms_are_refused(self):
        for value in ("\\\\server\\share\\a.pdf", "file://server/share/a.pdf", "file:////server/share/a.pdf",
                      "file:///a.pdf", "file:", "file:///C:/a\x01.pdf"):
            with self.subTest(value=value):
                self.assertEqual(normalize_url(value, "chrome"), "")

    def test_web_cases_unchanged(self):
        for value, expected in [("example.com/a", "https://example.com/a"),
                                ("chrome://newtab/", "chrome://newtab/"),
                                ("", ""), ("search words", ""),
                                ("http://localhost:8080", "http://localhost:8080"),
                                ("https://example.com/a b", ""), ("about:blank", "about:blank"),
                                ("edge://settings", "edge://settings"), ("localhost:3000", "https://localhost:3000"),
                                ("words", "")]:
            self.assertEqual(normalize_url(value, "chrome"), expected)


class CommandLineTests(unittest.TestCase):
    def test_microsoft_documented_examples(self):
        # Expected values from Microsoft's "Parsing C++ command-line arguments" table.
        for line, expected in [('"abc" d e', ["abc", "d", "e"]),
                               ('a\\\\b d"e f"g h', ["a\\\\b", "de fg", "h"]),
                               ('a\\\\\\"b c d', ['a\\"b', "c", "d"]),
                               ('a\\\\\\\\"b c" d e', ["a\\\\b c", "d", "e"])]:
            with self.subTest(line=line):
                self.assertEqual(split_command_line("prog.exe " + line)[1:], expected)

    def test_program_name_and_document_paths(self):
        self.assertEqual(split_command_line('"C:\\Program Files\\App\\app.exe" /p "C:\\My Docs\\a.txt"'),
                         ["C:\\Program Files\\App\\app.exe", "/p", "C:\\My Docs\\a.txt"])
        # Backslashes in the program name are never escapes.
        self.assertEqual(split_command_line('"C:\\dir\\"x'), ["C:\\dir\\", "x"])
        self.assertEqual(split_command_line("notepad.exe\tC:\\a.txt"), ["notepad.exe", "C:\\a.txt"])

    def test_trailing_backslashes_empty_args_and_whitespace(self):
        self.assertEqual(split_command_line('app C:\\dir\\ "C:\\dir\\\\"'), ["app", "C:\\dir\\", "C:\\dir\\"])
        # The classic trap: \" inside quotes is a literal quote, not the end.
        self.assertEqual(split_command_line('app "C:\\dir\\" next'), ["app", 'C:\\dir" next'])
        self.assertEqual(split_command_line('app "" x'), ["app", "", "x"])
        self.assertEqual(split_command_line("app   a    b  "), ["app", "a", "b"])
        self.assertEqual(split_command_line("app"), ["app"])
        self.assertEqual(split_command_line(""), [""])


class ChooseDocumentTests(unittest.TestCase):
    files = {"C:\\Docs\\report.txt", "C:\\Docs\\other.txt", "C:\\Docs\\a.pdf"}

    def choose(self, args, title):
        return choose_document(["app.exe", *args], title, lambda path: path in self.files)

    def test_one_file_with_matching_title(self):
        self.assertEqual(self.choose(["C:\\Docs\\report.txt"], "report.txt - Notepad"), "C:\\Docs\\report.txt")
        self.assertEqual(self.choose(["C:/Docs/../Docs/report.txt"], "*report - Notepad"), "C:\\Docs\\report.txt")

    def test_stem_match_is_case_insensitive_and_whole_word(self):
        self.assertEqual(self.choose(["C:\\Docs\\a.pdf"], "A - Reader"), "C:\\Docs\\a.pdf")
        with self.assertRaises(ValueError):
            self.choose(["C:\\Docs\\a.pdf"], "Adobe Acrobat Reader")

    def test_options_urls_relative_and_missing_are_ignored(self):
        args = ["/p", "--flag", "-n", "https://example.com/a.pdf", "report.txt", "C:\\Docs\\missing.txt",
                "\\\\server\\share\\report.txt", "C:\\Docs\\report.txt"]
        self.assertEqual(self.choose(args, "report.txt - App"), "C:\\Docs\\report.txt")

    def test_none_two_or_title_mismatch_fail_closed(self):
        for args, title in [([], "Notepad"), (["report.txt"], "report.txt - Notepad"),
                            (["C:\\Docs\\report.txt", "C:\\Docs\\other.txt"], "report.txt - App"),
                            (["C:\\Docs\\report.txt"], "other.txt - Notepad")]:
            with self.subTest(args=args), self.assertRaises(ValueError):
                self.choose(args, title)

    def test_same_file_twice_is_one_candidate(self):
        self.assertEqual(self.choose(["C:\\Docs\\report.txt", "c:\\docs\\REPORT.txt"], "report.txt"),
                         "C:\\Docs\\report.txt")


class OfficeTests(unittest.TestCase):
    def test_full_name_checks(self):
        exists = lambda path: path == "C:\\Docs\\Plan.docx"
        self.assertEqual(office_path("C:\\Docs\\Plan.docx", exists), "C:\\Docs\\Plan.docx")
        for name in ("Document1", "Book1", "", None, "https://d.docs.live.net/abc/Plan.docx",
                     "https://contoso.sharepoint.com/sites/x/Plan.docx", "\\\\server\\share\\Plan.docx",
                     "C:\\Docs\\Gone.docx"):
            with self.subTest(name=name), self.assertRaises(ValueError):
                office_path(name, exists)

    def office(self, app):
        def window(handle, name):
            document = SimpleNamespace(FullName=name)
            return SimpleNamespace(Hwnd=handle, hWnd=handle, HWND=handle, Document=document,
                                   Parent=document, Presentation=document)
        return SimpleNamespace(Windows=[window(11, "C:\\Docs\\Other.docx"), window(10, "C:\\Docs\\Plan.docx")])

    def test_window_handle_selects_the_document(self):
        for app in ("winword.exe", "excel.exe", "powerpnt.exe"):
            with self.subTest(app=app):
                self.assertEqual(office_window_path(app, self.office(app), 10, lambda h: h, lambda p: True),
                                 "C:\\Docs\\Plan.docx")
                # Office reporting an inner window still matches through its root.
                self.assertEqual(office_window_path(app, self.office(app), 99,
                                                    lambda h: 99 if h == 10 else h, lambda p: True),
                                 "C:\\Docs\\Plan.docx")
                with self.assertRaises(ValueError):
                    office_window_path(app, self.office(app), 12, lambda h: h, lambda p: True)

    def test_each_handle_spelling_is_accepted(self):
        for name in ("Hwnd", "hWnd", "HWND"):
            window = SimpleNamespace(**{name: 10}, Document=SimpleNamespace(FullName="C:\\a.docx"))
            self.assertEqual(office_window_path("winword.exe", SimpleNamespace(Windows=[window]), 10,
                                                lambda h: h, lambda p: True), "C:\\a.docx")

    def test_handles_compare_on_low_32_bits(self):
        office = SimpleNamespace(Windows=[SimpleNamespace(Hwnd=-2, Document=SimpleNamespace(FullName="C:\\a.docx"))])
        self.assertEqual(office_window_path("winword.exe", office, 0xFFFFFFFE, lambda h: h, lambda p: True),
                         "C:\\a.docx")


class EditorTitleTests(unittest.TestCase):
    files = {"C:\\proj\\src\\main.py", "C:\\My Docs\\a - b.txt", "C:\\proj - old\\x.py",
             "C:\\notes", "C:\\notes - draft.txt"}

    def path(self, title):
        return editor_title_path(title, lambda path: path in self.files)

    def test_plain_dirty_and_only_the_path(self):
        for title in ("C:\\proj\\src\\main.py - proj - Visual Studio Code",
                      "\u25cf C:\\proj\\src\\main.py - proj - Visual Studio Code",
                      "C:\\proj\\src\\main.py",
                      "C:\\proj\\src\\main.py \u2014 proj \u2014 Cursor",
                      "C:/proj/src/main.py - proj - Cursor"):
            with self.subTest(title=title):
                self.assertEqual(self.path(title), "C:\\proj\\src\\main.py")

    def test_separator_and_spaces_inside_the_path(self):
        self.assertEqual(self.path("C:\\My Docs\\a - b.txt - My Docs - Visual Studio Code"),
                         "C:\\My Docs\\a - b.txt")
        self.assertEqual(self.path("\u25cf C:\\proj - old\\x.py - proj - old - Visual Studio Code"),
                         "C:\\proj - old\\x.py")

    def test_longest_existing_file_wins_over_a_shorter_one(self):
        # "C:\notes" (a file) and the folder "C:\proj" are prefixes; the longer real file wins.
        self.assertEqual(self.path("C:\\notes - draft.txt - notes - Visual Studio Code"),
                         "C:\\notes - draft.txt")
        self.assertEqual(self.path("C:\\notes - Visual Studio Code"), "C:\\notes")

    def test_drive_letter_case_is_kept(self):
        self.assertEqual(editor_title_path("c:\\proj\\src\\main.py - proj - Visual Studio Code",
                                           lambda path: path.lower() == "c:\\proj\\src\\main.py"),
                         "c:\\proj\\src\\main.py")

    def test_no_file_path_fails_closed_without_leaking_the_title(self):
        for title in ("main.py - proj - Visual Studio Code", "\u25cf main.py - proj - Visual Studio Code",
                      "Untitled-1 - proj - Visual Studio Code", "\u25cf Untitled-1 - Visual Studio Code",
                      "/home/rafi/main.py - proj [SSH: box] - Visual Studio Code",
                      "vscode-remote://ssh-remote+box/home/main.py - Visual Studio Code",
                      "\\\\server\\share\\main.py - share - Visual Studio Code",
                      "src\\main.py - proj - Visual Studio Code", "C:main.py - proj - Visual Studio Code",
                      "C:\\proj\\src\\gone.py - proj - Visual Studio Code",
                      "C:\\proj\\src - proj - Visual Studio Code",
                      "* C:\\proj\\src\\main.py - proj - Visual Studio Code",
                      "Visual Studio Code", ""):
            with self.subTest(title=title), self.assertRaises(ValueError) as caught:
                self.path(title)
            self.assertIn("window.title", str(caught.exception))
            self.assertNotIn("main", str(caught.exception))

    def test_exe_name_arrives_lower_case_and_matches_the_table(self):
        def query(handle, flags, buffer, size):
            buffer.value = "C:\\Users\\Rafi\\AppData\\Local\\Programs\\Microsoft VS Code\\CODE.EXE"
            return True
        with patch("sidecar.windows.ctypes.WinDLL", create=True,
                   return_value=SimpleNamespace(QueryFullProcessImageNameW=query)):
            self.assertEqual(process_exe(1), "code.exe")
        self.assertEqual(set(EDITOR_APPS), {"code.exe", "cursor.exe"})
        self.assertNotIn("Code.exe", EDITOR_APPS)


class ReadWindowTests(unittest.TestCase):
    def test_dispatch_browser_or_document(self):
        with patch("sidecar.documents.browser_for_window", return_value="chrome"), \
                patch("sidecar.documents.read_browser_tab", return_value={"tabCount": 1}) as browser:
            self.assertEqual(read_dragged_window(10), {"tabCount": 1})
            browser.assert_called_once_with(10)
        with patch("sidecar.documents.browser_for_window", return_value=""), \
                patch("sidecar.documents.read_window_document", return_value={"kind": "document"}) as document:
            self.assertEqual(read_dragged_window(10), {"kind": "document"})
            document.assert_called_once_with(10)

    def read(self, exe, command_line, title):
        gui = Mock()
        gui.GetWindowText.return_value = title
        with tempfile.TemporaryDirectory() as directory:
            with patch.dict("sys.modules", {"win32gui": gui}), \
                    patch("sidecar.documents.window_process", return_value=Mock()), \
                    patch("sidecar.documents.process_exe", return_value=exe), \
                    patch("sidecar.documents.process_command_line", return_value=command_line), \
                    patch("sidecar.documents.choose_document", return_value=directory) as choose, \
                    patch("sidecar.documents.office_document", return_value=directory) as office, \
                    patch("sidecar.documents.is_regular_file", return_value=True):
                return read_window_document(10), directory, choose, office

    def test_level2_result_shape(self):
        result, path, choose, office = self.read("notepad.exe", 'notepad.exe "C:\\a b.txt"', "a b.txt - Notepad")
        self.assertEqual(result, {"hwnd": 10, "kind": "document", "path": path,
                                  "title": "a b.txt - Notepad", "app": "notepad.exe"})
        self.assertEqual(choose.call_args[0][:2], (["notepad.exe", "C:\\a b.txt"], "a b.txt - Notepad"))
        office.assert_not_called()

    def test_level3_asks_office_and_own_app_is_refused(self):
        result, _, choose, office = self.read("winword.exe", "", "Plan - Word")
        office.assert_called_once_with("winword.exe", 10)
        choose.assert_not_called()
        self.assertEqual(result["app"], "winword.exe")
        with self.assertRaises(ValueError):
            self.read("electron.exe", "electron.exe C:\\app\\main.js", "main.js")

    def test_editor_path_comes_from_the_title_not_the_command_line(self):
        title = "\u25cf C:\\proj\\main.py - proj - Visual Studio Code"
        for exe in ("code.exe", "cursor.exe"):
            gui = Mock()
            gui.GetWindowText.return_value = title
            with self.subTest(exe=exe), patch.dict("sys.modules", {"win32gui": gui}), \
                    patch("sidecar.documents.window_process", return_value=Mock()), \
                    patch("sidecar.documents.process_exe", return_value=exe), \
                    patch("sidecar.documents.process_command_line") as command_line, \
                    patch("sidecar.documents.choose_document") as choose, \
                    patch("sidecar.documents.office_document") as office, \
                    patch("sidecar.documents.is_regular_file",
                          side_effect=lambda path: path == "C:\\proj\\main.py"):
                self.assertEqual(read_window_document(10),
                                 {"hwnd": 10, "kind": "document", "path": "C:\\proj\\main.py",
                                  "title": title, "app": exe})
                command_line.assert_not_called()
                choose.assert_not_called()
                office.assert_not_called()

    def test_editor_without_the_title_setting_is_refused(self):
        gui = Mock()
        gui.GetWindowText.return_value = "main.py - proj - Visual Studio Code"
        with patch.dict("sys.modules", {"win32gui": gui}), \
                patch("sidecar.documents.window_process", return_value=Mock()), \
                patch("sidecar.documents.process_exe", return_value="code.exe"), \
                patch("sidecar.documents.process_command_line",
                      return_value="Code.exe C:\\proj\\main.py") as command_line, \
                patch("sidecar.documents.is_regular_file",
                      side_effect=lambda path: path == "C:\\proj\\main.py"), \
                self.assertRaises(ValueError):
            read_window_document(10)
        command_line.assert_not_called()  # No command-line fallback for editors.


def sample(hwnd=10, browser=False, class_name="Notepad", rect=(100, 100, 500, 500), pressed=True, time=1.0):
    return Sample(hwnd, browser, rect, (200, 110), pressed, time, class_name)


class TrackerTests(unittest.TestCase):
    def begin(self, **fields):
        tracker = DragTracker()
        tracker.update(sample(**fields), (1000, 800), {"LEFT"})
        _, request = tracker.update(sample(rect=(90, 100, 490, 500), time=1.016, **fields), (1000, 800), {"LEFT"})
        return tracker, request

    def test_non_browser_window_starts_qualification(self):
        for class_name in ("Notepad", "OpusApp", "XLMAIN", "AcrobatSDIWindow"):
            self.assertEqual(self.begin(class_name=class_name)[1][1], 10)

    def test_excluded_unknown_and_empty_never_start(self):
        for class_name in ("Progman", "WorkerW", "Shell_TrayWnd", "CabinetWClass", "#32770",
                           "ConsoleWindowClass", ""):
            with self.subTest(class_name=class_name):
                self.assertIsNone(self.begin(class_name=class_name)[1])
        self.assertIsNone(self.begin(hwnd=0)[1])

    def test_browser_samples_still_start(self):
        self.assertIsNotNone(self.begin(browser=True, class_name="")[1])

    def test_document_result_emits_exact_contract_fields(self):
        tracker, (generation, hwnd) = self.begin()
        info = {"hwnd": 10, "kind": "document", "path": "C:\\a.txt", "title": "a.txt - Notepad",
                "app": "notepad.exe", "extra": "dropped"}
        self.assertEqual(tracker.qualify(generation, info),
                         {"type": "LOCAL_DRAG_START", "hwnd": 10, "kind": "document", "path": "C:\\a.txt",
                          "title": "a.txt - Notepad", "app": "notepad.exe"})
        self.assertTrue(tracker.started)

    def test_editor_window_is_chromium_class_and_still_starts_as_document(self):
        tracker, (generation, hwnd) = self.begin(browser=True, class_name="Chrome_WidgetWin_1")
        info = {"hwnd": hwnd, "kind": "document", "path": "C:\\proj\\main.py",
                "title": "C:\\proj\\main.py - proj - Visual Studio Code", "app": "code.exe"}
        self.assertEqual(tracker.qualify(generation, info), {"type": "LOCAL_DRAG_START", **info})

    def test_wrong_hwnd_stale_generation_or_empty_path_rejected(self):
        good = {"hwnd": 10, "kind": "document", "path": "C:\\a.txt", "title": "a", "app": "notepad.exe"}
        for changes, stale in [({"hwnd": 11}, False), ({}, True), ({"path": ""}, False), ({"path": None}, False)]:
            with self.subTest(changes=changes, stale=stale):
                tracker, (generation, _) = self.begin()
                self.assertIsNone(tracker.qualify(generation - 1 if stale else generation, {**good, **changes}))
                self.assertFalse(tracker.started)


class OpenedWindowTests(unittest.TestCase):
    before = {1: "Inbox - Mail", 2: "notes.txt - Notepad", 3: "Edge"}

    def choose(self, after, grace=False):
        return choose_opened_window(self.before, after, "report.pdf", grace)

    def test_new_matching_window(self):
        self.assertEqual(self.choose({**self.before, 9: "report.pdf - Reader"}), ("new", 9))
        self.assertEqual(self.choose({**self.before, 9: "report - Reader", 8: "Welcome"}), ("new", 9))

    def test_new_non_matching_waits_for_grace(self):
        self.assertEqual(self.choose({**self.before, 9: "Photos"}), ("wait", None))
        self.assertEqual(self.choose({**self.before, 9: "Photos"}, grace=True), ("new", 9))

    def test_several_new_none_or_both_matching_is_ambiguous(self):
        self.assertEqual(self.choose({9: "Splash", 8: "Welcome"}, grace=True), ("ambiguous", None))
        self.assertEqual(self.choose({9: "report.pdf", 8: "report.pdf - Reader"}), ("ambiguous", None))

    def test_existing_window_that_gained_the_name_is_not_moved(self):
        self.assertEqual(self.choose({**self.before, 3: "report.pdf - Edge"}), ("existing", 3))
        before = {**self.before, 4: "report.pdf - Reader"}
        self.assertEqual(choose_opened_window(before, before, "report.pdf", True), ("wait", None))

    def test_nothing(self):
        self.assertEqual(self.choose(dict(self.before), grace=True), ("wait", None))
        self.assertEqual(self.choose({}), ("wait", None))


def open_file_message(path, changes=None, **fields):
    return {"type": "OPEN_FILE", "transferId": "t1", "path": path, "x": -50, "y": 10,
            "width": 800, "height": 600, **fields, **(changes or {})}


class OpenFileTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.directory = directory.name
        self.path = str(Path(directory.name) / "report.pdf")
        Path(self.path).write_bytes(b"%PDF")

    def test_validation(self):
        validate_open_file(open_file_message(self.path))
        for changes in ({"transferId": ""}, {"transferId": 5}, {"path": self.directory},
                        {"path": self.path + ".missing"}, {"path": "report.pdf"}, {"path": 7},
                        {"path": self.path + "\n"}, {"x": 1.5}, {"width": 0}, {"height": -1}, {"y": True}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                validate_open_file(open_file_message(self.path, changes))

    def test_validation_of_the_editor_app(self):
        for app in ("code.exe", "cursor.exe", None):
            validate_open_file(open_file_message(self.path, app=app))
        for app in ("Code.exe", "notepad.exe", "", 5, ["code.exe"], {"x": 1}):
            with self.subTest(app=app), self.assertRaises(ValueError):
                validate_open_file(open_file_message(self.path, app=app))

    def controller(self, snapshots):
        with fake_win32():
            controller = WindowController()
        controller.work_area = Mock(return_value=(0, 0, 1920, 1040))
        controller.titled_windows = Mock(side_effect=lambda everything=False: snapshots.pop(0))
        controller.launch_file = Mock()
        return controller

    def test_new_window_is_placed_clamped(self):
        controller = self.controller([{1: "Mail"}, {1: "Mail", 9: "report.pdf - Reader"}])
        result = controller.open_file(open_file_message(self.path), threading.Event())
        self.assertEqual(result, {"type": "WINDOW_PLACED", "transferId": "t1", "hwnd": 9})
        controller.launch_file.assert_called_once_with(self.path)
        controller.gui.SetWindowPos.assert_called_once_with(9, 0, 0, 10, 800, 600, 0x14)

    def test_reused_window_is_reported_but_not_moved(self):
        controller = self.controller([{3: "Edge"}, {3: "report.pdf - Edge"}])
        self.assertEqual(controller.open_file(open_file_message(self.path), threading.Event())["hwnd"], 3)
        controller.gui.SetWindowPos.assert_not_called()

    def test_timeout_and_ambiguity_fail(self):
        for snapshots, error in [([{1: "Mail"}] + [{1: "Mail"}] * 3, TimeoutError),
                                 ([{}] + [{8: "A", 9: "B"}] * 3, RuntimeError)]:
            with self.subTest(error=error):
                controller = self.controller(snapshots)
                with patch("sidecar.handoff.time.monotonic", side_effect=[0, 0, 1, 5]), self.assertRaises(error):
                    controller.open_file(open_file_message(self.path), threading.Event())
                controller.gui.SetWindowPos.assert_not_called()

    def test_editor_app_launches_a_new_editor_window_instead_of_the_default_program(self):
        controller = self.controller([{1: "Mail"}, {1: "Mail", 9: "report.pdf - Visual Studio Code"}])
        with patch("sidecar.handoff.find_editor", return_value="C:\\VS Code\\Code.exe") as find, \
                patch("sidecar.handoff.subprocess.Popen") as popen, \
                patch("sidecar.handoff.os.startfile", create=True) as startfile:
            result = controller.open_file(open_file_message(self.path, app="code.exe"), threading.Event())
        self.assertEqual(result, {"type": "WINDOW_PLACED", "transferId": "t1", "hwnd": 9})
        find.assert_called_once_with("code.exe")
        popen.assert_called_once_with(["C:\\VS Code\\Code.exe", "--new-window", self.path], shell=False)
        controller.launch_file.assert_not_called()
        startfile.assert_not_called()
        controller.gui.SetWindowPos.assert_called_once_with(9, 0, 0, 10, 800, 600, 0x14)

    def test_missing_editor_or_failed_start_never_opens_anything_else(self):
        controller = self.controller([{}])
        with patch("sidecar.handoff.find_editor", return_value=None), \
                patch("sidecar.handoff.subprocess.Popen") as popen, self.assertRaises(OSError) as caught:
            controller.open_file(open_file_message(self.path, app="cursor.exe"), threading.Event())
        self.assertEqual(str(caught.exception), "editor not installed")
        popen.assert_not_called()
        controller.launch_file.assert_not_called()
        controller = self.controller([{}])
        with patch("sidecar.handoff.find_editor", return_value="C:\\VS Code\\Code.exe"), \
                patch("sidecar.handoff.subprocess.Popen", side_effect=OSError(2, "missing", self.path)), \
                self.assertRaises(OSError) as caught:
            controller.open_file(open_file_message(self.path, app="code.exe"), threading.Event())
        self.assertNotIn(self.path, str(caught.exception))
        controller.gui.SetWindowPos.assert_not_called()

    def test_disconnect_before_launch_never_opens(self):
        controller = self.controller([{}])
        stopped = threading.Event()
        stopped.set()
        with self.assertRaises(RuntimeError):
            controller.open_file(open_file_message(self.path), stopped)
        controller.launch_file.assert_not_called()


class EditorInstallPathTests(unittest.TestCase):
    environ = {"LOCALAPPDATA": "C:\\Users\\Rafi\\AppData\\Local", "ProgramFiles": "C:\\Program Files"}
    user_code = "C:\\Users\\Rafi\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe"
    system_code = "C:\\Program Files\\Microsoft VS Code\\Code.exe"

    def test_user_install_first_then_system_install(self):
        self.assertEqual(editor_install_path("code.exe", self.environ, lambda path: True), self.user_code)
        self.assertEqual(editor_install_path("code.exe", self.environ, lambda path: path == self.system_code),
                         self.system_code)
        self.assertEqual(editor_install_path("cursor.exe", self.environ, lambda path: True),
                         "C:\\Users\\Rafi\\AppData\\Local\\Programs\\cursor\\Cursor.exe")
        self.assertEqual(editor_install_path("cursor.exe", self.environ, lambda path: "Program Files" in path),
                         "C:\\Program Files\\cursor\\Cursor.exe")

    def test_order_of_checks_and_nothing_found(self):
        checked = []
        self.assertIsNone(editor_install_path("code.exe", self.environ, lambda path: checked.append(path)))
        self.assertEqual(checked, [self.user_code, self.system_code])

    def test_missing_variables_never_become_relative_paths(self):
        checked = []
        self.assertIsNone(editor_install_path("code.exe", {"LOCALAPPDATA": ""}, lambda path: checked.append(path)))
        self.assertEqual(checked, [])
        self.assertEqual(editor_install_path("code.exe", {"ProgramFiles": "C:\\Program Files"}, lambda path: True),
                         self.system_code)


class FindEditorTests(unittest.TestCase):
    def winreg(self, registered):
        """A fake winreg whose App Paths default value is `registered` (None: no key)."""
        class Key:
            def __enter__(self):
                return self

            def __exit__(self, *_):
                return False

        def open_key(hive, path, reserved, access):
            if registered is None:
                raise OSError("no key")
            self.opened.append(path)
            return Key()

        self.opened = []
        return SimpleNamespace(HKEY_CURRENT_USER=1, HKEY_LOCAL_MACHINE=2, KEY_WOW64_64KEY=0x100,
                               KEY_WOW64_32KEY=0x200, KEY_READ=0x20019, OpenKey=open_key,
                               QueryValueEx=lambda key, name: (f'"{registered}"', 1))

    def test_registry_first_then_install_folders(self):
        with tempfile.NamedTemporaryFile() as exe:
            with patch.dict("sys.modules", {"winreg": self.winreg(exe.name)}), \
                    patch("sidecar.handoff.editor_install_path") as folders:
                self.assertEqual(find_editor("code.exe"), exe.name)
                folders.assert_not_called()
            self.assertTrue(self.opened[0].endswith("\\App Paths\\code.exe"))
            with patch.dict("sys.modules", {"winreg": self.winreg(None)}), \
                    patch("sidecar.handoff.editor_install_path", return_value="C:\\VS\\Code.exe") as folders:
                self.assertEqual(find_editor("code.exe"), "C:\\VS\\Code.exe")
            self.assertEqual(folders.call_args[0][0], "code.exe")
            # The browser lookup still uses the shared App Paths code.
            with patch.dict("sys.modules", {"winreg": self.winreg(exe.name)}):
                self.assertEqual(find_browser("brave"), exe.name)
            self.assertTrue(self.opened[0].endswith("\\App Paths\\brave.exe"))
        with patch.dict("sys.modules", {"winreg": self.winreg("C:\\gone\\brave.exe")}):
            self.assertIsNone(find_browser("brave"))


class TitledWindowsTests(unittest.TestCase):
    def test_only_windows_that_could_show_a_document(self):
        with fake_win32():
            controller = WindowController()
        windows = {1: ("Notepad", "a.txt - Notepad", True, (0, 0, 500, 400), 0),
                   2: ("Notepad", "hidden", False, (0, 0, 500, 400), 0),
                   3: ("Notepad", "", True, (0, 0, 500, 400), 0),
                   4: ("Shell_TrayWnd", "Taskbar", True, (0, 0, 500, 40), 0),
                   5: ("Tool", "Palette", True, (0, 0, 100, 100), 0x80),
                   6: ("Notepad", "Empty", True, (0, 0, 0, 0), 0),
                   7: ("Chrome_WidgetWin_1", "Odyssync", True, (0, 0, 500, 400), 0),
                   8: ("Chrome_WidgetWin_1", "a.pdf - Edge", True, (0, 0, 500, 400), 0),
                   9: None}  # Vanishes during enumeration.

        def field(index):
            def read(hwnd, *_):
                if windows[hwnd] is None:
                    raise OSError("Invalid window handle")
                return windows[hwnd][index]
            return read

        gui = controller.gui
        gui.EnumWindows.side_effect = lambda visit, arg: [visit(hwnd, arg) for hwnd in windows]
        gui.GetClassName.side_effect = field(0)
        gui.GetWindowText.side_effect = field(1)
        gui.IsWindowVisible.side_effect = field(2)
        gui.GetWindowRect.side_effect = field(3)
        gui.GetWindowLong.side_effect = field(4)
        controller.is_own_app = Mock(side_effect=lambda hwnd: hwnd == 7)
        self.assertEqual(controller.titled_windows(), {1: "a.txt - Notepad", 8: "a.pdf - Edge"})
        everything = controller.titled_windows(everything=True)
        self.assertEqual(set(everything), {1, 2, 3, 4, 5, 6, 7, 8})
        self.assertEqual(everything[2], "hidden")


class AllowListTests(unittest.TestCase):
    def test_bounded_and_forgets_dead_handles(self):
        documents = DocumentWindows(limit=3)
        for hwnd in (1, 2, 3, 4):
            documents.add(hwnd)
        self.assertFalse(documents.allows(1, lambda h: True))
        self.assertTrue(documents.allows(4, lambda h: True))
        self.assertFalse(documents.allows(4, lambda h: h != 4))
        self.assertEqual(documents.handles, [2, 3])

    def controller(self):
        with fake_win32():
            controller = WindowController()
        controller.gui.IsWindow.side_effect = lambda hwnd: hwnd != 99
        return controller

    def test_document_handles_pass_and_arbitrary_handles_are_refused(self):
        controller = self.controller()
        controller.documents.add(10)
        with patch("sidecar.handoff.browser_for_window", return_value="") as browser:
            controller.require_browser(10)
            browser.assert_not_called()
            for hwnd in (11, 99, "10", None):
                with self.subTest(hwnd=hwnd), self.assertRaises(ValueError):
                    controller.require_browser(hwnd)
        with patch("sidecar.handoff.browser_for_window", return_value="chrome"):
            controller.require_browser(11)

    def test_hidden_document_is_restored_even_after_eviction(self):
        controller = self.controller()
        controller.work_area = Mock(return_value=(0, 0, 1920, 1040))
        controller.gui.GetWindowRect.return_value = (10, 10, 510, 410)
        controller.documents.add(10)
        with patch("sidecar.handoff.browser_for_window", return_value=""):
            controller.hide(10)
            controller.documents.handles.clear()
            controller.restore_hidden()
        self.assertEqual(controller.hidden, {})
        controller.gui.ShowWindow.assert_called_with(10, 4)


class DaemonTests(unittest.IsolatedAsyncioTestCase):
    async def test_open_file_dispatch_and_failure_reply(self):
        class Socket:
            def __aiter__(self):
                return self.messages()

            async def messages(self):
                yield json.dumps(open_file_message("C:\\a.pdf"))
                yield json.dumps(open_file_message("C:\\b.pdf", transferId="t2"))

        controller = Mock()
        controller.open_file.side_effect = [{"type": "WINDOW_PLACED", "transferId": "t1", "hwnd": 9},
                                            OSError("No program is associated")]
        box = Outbox()
        with self.assertLogs("sidecar.win32_daemon", level="WARNING"):
            await receive_commands(Socket(), set(), controller, box, None, threading.Event())
        self.assertEqual(box.lifecycle.get_nowait(), {"type": "WINDOW_PLACED", "transferId": "t1", "hwnd": 9})
        self.assertEqual(box.lifecycle.get_nowait(), {"type": "OPEN_FAILED", "transferId": "t2",
                                                     "error": "No program is associated"})
        controller.open_url.assert_not_called()

    async def test_document_drag_start_registers_the_handle(self):
        loop = asyncio.get_running_loop()
        qualification = loop.create_future()
        qualification.set_result({"hwnd": 10, "kind": "document", "path": "C:\\a.txt",
                                  "title": "a.txt - Notepad", "app": "notepad.exe"})
        reader = Mock()
        reader.submit.return_value = qualification
        documents = Mock()

        class Desktop:
            tick = 0

            def screen_info(self):
                return {"screenWidth": 1920, "screenHeight": 1080, "dpiScale": 1}

            def sample(self):
                self.tick += 1
                return Sample(10, False, (100 - min(self.tick, 5), 100, 500, 500), (0, 120),
                              self.tick < 6, self.tick * 0.016, "Notepad")

        box = Outbox()
        task = asyncio.create_task(poll_desktop(Desktop(), {"LEFT"}, box, reader, None, documents))
        await asyncio.sleep(0.16)
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        events = []
        while not box.lifecycle.empty():
            events.append(box.lifecycle.get_nowait())
        self.assertEqual([event["type"] for event in events],
                         ["LOCAL_DRAG_START", "LOCAL_DRAG_MOVE", "LOCAL_DRAG_END"])
        self.assertEqual(events[0]["kind"], "document")
        documents.add.assert_called_once_with(10)
        reader.submit.assert_called_once_with(10)


if __name__ == "__main__":
    unittest.main()
