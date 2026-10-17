# SPDX-License-Identifier: GPL-3.0-or-later
import json
import tempfile
import unittest
from pathlib import Path

from bridge import MCPManager
from workspace_agent.tools import Workspace


class WorkspaceBridgeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.manager = MCPManager.__new__(MCPManager)
        self.manager.workspace_settings_path = str(self.root / "settings.json")
        self.manager.workspace_root = str(self.root)
        self.manager.workspace_configured = False
        self.manager.workspace_source = "default"
        self.manager.workspace = Workspace(self.root)
        self.manager.workspace_error = None

    def tearDown(self):
        self.temp.cleanup()

    def test_workspace_catalogue_builds_python_schema_defaults(self):
        catalogue = self.manager._workspace_tools()
        by_name = {item["name"]: item for item in catalogue}
        self.assertIn("workspace_tree", by_name)
        self.assertIn("workspace_search", by_name)
        self.assertIs(by_name["workspace_tree"]["inputSchema"]["properties"]["include_hidden"]["default"], False)
        self.assertIs(by_name["workspace_search"]["inputSchema"]["properties"]["regex"]["default"], False)
        self.assertIn("configured: false", by_name["workspace_info"]["description"])

    def test_unconfigured_workspace_blocks_project_access(self):
        info = self.manager._call_workspace("workspace_info", {})
        self.assertFalse(info["configured"])
        with self.assertRaisesRegex(RuntimeError, "No project workspace has been selected"):
            self.manager._call_workspace("workspace_list_files", {})
        with self.assertRaisesRegex(RuntimeError, "No project workspace has been selected"):
            self.manager._call_workspace("workspace_run_command", {"command": ["python", "--version"]})

    def test_explicit_workspace_selection_persists_and_unlocks_tools(self):
        project = self.root / "project"
        project.mkdir()
        (project / "main.py").write_text("print('ok')\n", encoding="utf-8")
        result = self.manager._call_workspace("workspace_set_root", {"path": str(project)})
        self.assertTrue(result["configured"])
        self.assertEqual(self.manager.workspace_root, str(project.resolve()))
        self.assertTrue(self.manager.workspace_configured)
        with open(self.manager.workspace_settings_path, "r", encoding="utf-8") as handle:
            saved = json.load(handle)
        self.assertEqual(saved["root"], str(project.resolve()))
        listing = self.manager._call_workspace("workspace_list_files", {})
        self.assertEqual([item["path"] for item in listing["files"]], ["main.py"])


if __name__ == "__main__":
    unittest.main()
