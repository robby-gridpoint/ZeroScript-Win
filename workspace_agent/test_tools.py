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

    def test_search_regex_case_sensitivity_and_columns(self):
        self.ws.write_file("src/search.txt", "Hello 123\nhello 456\n")
        sensitive = self.ws.search("Hello", case_sensitive=True)
        self.assertEqual(len(sensitive["matches"]), 1)
        numeric = self.ws.search(r"\d+", regex=True)
        self.assertEqual([item["line"] for item in numeric["matches"]], [1, 2])
        self.assertEqual(numeric["matches"][0]["column"], 7)
        with self.assertRaises(WorkspaceError):
            self.ws.search("[", regex=True)

    def test_finds_files_by_glob(self):
        (self.root / "src").mkdir()
        (self.root / "src" / "main.luau").write_text("return true\n", encoding="utf-8")
        (self.root / "src" / "theme.json").write_text("{}\n", encoding="utf-8")
        result = self.ws.find_files("*.luau")
        self.assertEqual([item["path"] for item in result["matches"]], ["src/main.luau"])

    def test_project_info_detects_node_scripts(self):
        (self.root / "package.json").write_text(
            '{"name":"sample-project","scripts":{"test":"vitest run","build":"tsc"}}',
            encoding="utf-8",
        )
        result = self.ws.project_info()
        self.assertEqual(result["project_type"], "Node.js / JavaScript / TypeScript")
        self.assertEqual(result["package_scripts"]["test"], "vitest run")
        self.assertIn("package.json", result["manifest_files"])

    def test_symbols_finds_function_and_type(self):
        (self.root / "src").mkdir()
        (self.root / "src" / "app.py").write_text(
            "class WorkspaceManager:\n    def select_workspace(self):\n        return True\n",
            encoding="utf-8",
        )
        result = self.ws.symbols()
        names = {item["name"] for item in result["symbols"]}
        self.assertIn("WorkspaceManager", names)
        self.assertIn("select_workspace", names)

    def test_apply_patch_rejects_ambiguous_match(self):
        self.ws.write_file("src/main.txt", "same\nsame\n")
        with self.assertRaises(WorkspaceError):
            self.ws.apply_patch("src/main.txt", "same", "changed")
        result = self.ws.apply_patch("src/main.txt", "same", "changed", replace_all=True)
        self.assertEqual(result["replacements"], 2)
        self.assertEqual(self.ws.read_file("src/main.txt")["content"], "changed\nchanged\n")

    def test_tree_respects_depth_and_ignored_folders(self):
        (self.root / "src" / "nested").mkdir(parents=True)
        (self.root / "src" / "main.py").write_text("print('ok')\n", encoding="utf-8")
        (self.root / "src" / "nested" / "detail.py").write_text("pass\n", encoding="utf-8")
        (self.root / "node_modules").mkdir()
        (self.root / "node_modules" / "ignored.js").write_text("ignored\n", encoding="utf-8")
        result = self.ws.tree(max_depth=2)
        paths = {item["path"] for item in result["entries"]}
        self.assertIn("src", paths)
        self.assertIn("src/main.py", paths)
        self.assertIn("src/nested", paths)
        self.assertNotIn("node_modules", paths)
        self.assertNotIn("node_modules/ignored.js", paths)

    def test_file_outline_extracts_imports_and_declarations(self):
        self.ws.write_file(
            "src/app.py",
            "from pathlib import Path\n\nclass App:\n    def run(self):\n        return Path('.')\n",
        )
        result = self.ws.file_outline("src/app.py")
        kinds = {item["kind"] for item in result["outline"]}
        self.assertIn("import", kinds)
        self.assertIn("declaration", kinds)
        self.assertEqual(result["path"], "src/app.py")

    def test_run_command_without_shell(self):
        result = self.ws.run_command([sys.executable, "-c", "print('workspace-ok')"])
        self.assertEqual(result["exit_code"], 0)
        self.assertIn("workspace-ok", result["output"])

    def test_run_command_validates_argv(self):
        with self.assertRaises(WorkspaceError):
            self.ws.run_command("echo unsafe")  # type: ignore[arg-type]


if __name__ == "__main__":
    unittest.main()
