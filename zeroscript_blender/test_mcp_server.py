# SPDX-License-Identifier: GPL-3.0-or-later
import unittest

from zeroscript_blender import mcp_server


class BpyMcpProtocolTests(unittest.TestCase):
    def test_initialize_advertises_tools_capability(self):
        result = mcp_server._reply({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}})
        self.assertEqual(result["id"], 1)
        self.assertEqual(result["result"]["serverInfo"]["name"], "zeroscript-bpy")
        self.assertIn("tools", result["result"]["capabilities"])

    def test_tools_list_does_not_require_bpy_import(self):
        result = mcp_server._reply({"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}})
        names = {tool["name"] for tool in result["result"]["tools"]}
        self.assertTrue({
            "bpy_status", "bpy_inspect_scene", "bpy_execute_script",
            "bpy_open_project", "bpy_save_project", "bpy_render", "bpy_export",
        }.issubset(names))

    def test_unknown_tool_returns_protocol_error(self):
        result = mcp_server._reply({
            "jsonrpc": "2.0", "id": 3, "method": "tools/call",
            "params": {"name": "not_a_tool", "arguments": {}},
        })
        self.assertEqual(result["error"]["code"], -32602)

    def test_workspace_path_rejects_traversal(self):
        with self.assertRaises(ValueError):
            mcp_server._workspace_path("../outside.blend")

    def test_workspace_path_accepts_relative_path(self):
        result = mcp_server._workspace_path("assets/test.blend")
        self.assertTrue(result.is_absolute())
        self.assertTrue(result.as_posix().endswith("assets/test.blend"))


if __name__ == "__main__":
    unittest.main()
