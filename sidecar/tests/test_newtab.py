"""Blank tabs use browser-native new-tab addresses, never guessed web URLs."""
from contextlib import nullcontext
from types import SimpleNamespace
import threading
import unittest
from unittest.mock import Mock, patch

from sidecar.handoff import WindowController
from sidecar.windows import read_browser_tab


class Control:
    def __init__(self, kind, name="", value=None, children=()):
        self.ControlTypeName, self.Name = kind, name
        self.value, self.children = value, children

    def GetChildren(self):
        return self.children

    def GetValuePattern(self):
        if self.value is None:
            raise LookupError("ValuePattern unavailable")
        return SimpleNamespace(Value=self.value)


class NewTabInspectionTests(unittest.TestCase):
    def read(self, label="New Tab", value="", document="chrome://new-tab-page/", browser="chrome", count=1):
        root = Control("WindowControl", children=[
            *[Control("TabItemControl", label) for _ in range(count)],
            Control("EditControl", "Address and search bar", value),
            Control("DocumentControl", label, document),
        ])
        auto = SimpleNamespace(UIAutomationInitializerInThread=nullcontext, ControlFromHandle=lambda _: root)
        with patch.dict("sys.modules", {"uiautomation": auto}), \
                patch("sidecar.windows.browser_for_window", return_value=browser), \
                patch("win32gui.GetWindowText", return_value=label):
            return read_browser_tab(10)

    def test_native_document_identifies_new_tab_without_english_title(self):
        for label in ("Nouvel onglet", "New Tab - Memory usage: 32 MB"):
            with self.subTest(label=label):
                self.assertEqual(self.read(label=label)["url"], "chrome://newtab/")

    def test_each_browser_uses_its_own_launchable_new_tab_url(self):
        for browser, scheme in (("chrome", "chrome"), ("msedge", "edge"), ("brave", "brave")):
            with self.subTest(browser=browser):
                self.assertEqual(self.read(label="Localized label", browser=browser)["url"], f"{scheme}://newtab/")

    def test_nonempty_search_text_is_not_a_blank_tab(self):
        with self.assertRaises(ValueError):
            self.read(value="an unfinished search")

    def test_unreadable_omnibox_is_not_assumed_blank(self):
        with self.assertRaises(ValueError):
            self.read(value=None)

    def test_missing_url_on_an_ordinary_page_is_not_assumed_blank(self):
        with self.assertRaises(ValueError):
            self.read(document="https://example.com")

    def test_multitab_window_is_not_qualified_as_a_single_blank_tab(self):
        with self.assertRaises(ValueError):
            self.read(count=2)

    def test_real_url_still_wins_over_new_tab_document(self):
        self.assertEqual(self.read(value="youtube.com")["url"], "https://youtube.com")


class NewTabReceiverTests(unittest.TestCase):
    def test_missing_sender_browser_uses_an_installed_browser_for_blank_tab(self):
        controller = WindowController()
        controller.window_handles = Mock(return_value={1})
        controller.browser_windows = Mock(return_value={2: "msedge"})
        controller.place = Mock()
        controller.launch = Mock()
        message = {"transferId": "blank", "url": "chrome://newtab/", "browser": "chrome",
                   "x": 10, "y": 10, "width": 900, "height": 650}
        with patch("sidecar.handoff.find_browser", side_effect=lambda browser: "edge.exe" if browser == "msedge" else None):
            result = controller.open_url(message, threading.Event())
        self.assertEqual(result["type"], "WINDOW_PLACED")
        controller.launch.assert_called_once_with("edge://newtab/", "edge.exe")

    def test_no_supported_browser_fails_without_sending_internal_url_to_windows(self):
        controller = WindowController()
        controller.window_handles = Mock(return_value=set())
        controller.launch = Mock()
        message = {"transferId": "blank", "url": "chrome://newtab/", "browser": "chrome",
                   "x": 10, "y": 10, "width": 900, "height": 650}
        with patch("sidecar.handoff.find_browser", return_value=None), self.assertRaisesRegex(OSError, "browser"):
            controller.open_url(message, threading.Event())
        controller.launch.assert_not_called()
