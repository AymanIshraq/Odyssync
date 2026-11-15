"""Frozen launch cleanup must not affect the browser or future helper commands."""
import os
import sys
import unittest
from unittest.mock import patch

from sidecar.handoff import browser_launch_environment


class BrowserEnvironmentTests(unittest.TestCase):
    def test_frozen_launch_restores_environment_even_when_browser_launch_fails(self):
        bundle = os.path.abspath("build/frozen helper")
        system_path = os.path.abspath("build/system programs")
        original = os.pathsep.join([bundle, os.path.join(bundle, "uiautomation", "bin"), system_path])
        with patch.object(sys, "frozen", True, create=True), \
                patch.object(sys, "_MEIPASS", bundle, create=True), \
                patch.dict(os.environ, {"PATH": original}), \
                patch("sidecar.handoff.ctypes.windll.kernel32.SetDllDirectoryW") as set_dll:
            with self.assertRaisesRegex(OSError, "launch failed"):
                with browser_launch_environment():
                    self.assertEqual(os.environ["PATH"], system_path)
                    set_dll.assert_called_once_with(None)
                    raise OSError("launch failed")
            self.assertEqual(os.environ["PATH"], original)
            self.assertEqual(set_dll.call_args.args, (bundle,))

    def test_source_launch_does_not_change_dll_paths(self):
        with patch.object(sys, "frozen", False, create=True), \
                patch("sidecar.handoff.ctypes.windll.kernel32.SetDllDirectoryW") as set_dll:
            original = os.environ.get("PATH")
            with browser_launch_environment():
                self.assertEqual(os.environ.get("PATH"), original)
            set_dll.assert_not_called()
