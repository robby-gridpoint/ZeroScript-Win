# SPDX-License-Identifier: GPL-3.0-or-later
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

from workspace_agent.tools import Workspace, WorkspaceError


class WorkspaceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.ws = Workspace(self.root)

    def tearDown(self):
        self.temp.cleanup()

    def test_read_write_and_diff(self):
        result = self.ws.write_file("src/main.py", "print('hello')\n")
        self.assertEqual(result["path"], "src/main.py")
        self.assertTrue(result["created"])
        self.assertIn("+print('hello')", result["diff"])
        self.assertEqual(self.ws.read_file("src/main.py")["content"], "print('hello')\n")

        result = self.ws.write_file("src/main.py", "print('updated')\n")
        self.assertFalse(result["created"])
        self.assertIn("-print('hello')", result["diff"])
        self.assertIn("+print('updated')", result["diff"])

    def test_blocks_path_traversal(self):
        with self.assertRaises(WorkspaceError):
            self.ws.read_file("../outside.txt")
        with self.assertRaises(WorkspaceError):
            self.ws.write_file("../../outside.txt", "bad")

    def test_blocks_symlink_escape(self):
        outside = self.root.parent / (self.root.name + "_outside")
        try:
            outside.mkdir()
            (outside / "secret.txt").write_text("secret", encoding="utf-8")
            link = self.root / "escape"
            try:
                link.symlink_to(outside, target_is_directory=True)
            except OSError:
                self.skipTest("Symlink creation is not available")
            with self.assertRaises(WorkspaceError):
                self.ws.read_file("escape/secret.txt")
        finally:
            if outside.exists():
                shutil.rmtree(outside)

    def test_lists_and_searches_project_files(self):
        (self.root / "src").mkdir()
        (self.root / "src" / "app.py").write_text("def greet():\n    return 'hello'\n", encoding="utf-8")
        listing = self.ws.list_files()
        self.assertEqual([item["path"] for item in listing["files"]], ["src/app.py"])
        search = self.ws.search("HELLO")
        self.assertEqual(len(search["matches"]), 1)
        self.assertEqual(search["matches"][0]["line"], 2)

    def test_run_command_without_shell(self):
        result = self.ws.run_command([sys.executable, "-c", "print('workspace-ok')"])
        self.assertEqual(result["exit_code"], 0)
        self.assertIn("workspace-ok", result["output"])

    def test_run_command_validates_argv(self):
        with self.assertRaises(WorkspaceError):
            self.ws.run_command("echo unsafe")  # type: ignore[arg-type]


if __name__ == "__main__":
    unittest.main()
