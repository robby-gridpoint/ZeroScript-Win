# ZeroScript Win — Local-First Coding Agent

ZeroScript Win is a GPL-3.0-or-later fork of ZeroScript Free, being evolved from a Roblox Studio-specific agent into a local-first software development agent.

The original browser provider integrations are being retained during the transition. The long-term architecture uses a general workspace tool backend, optional MCP integrations, and Roblox Studio as an optional adapter rather than a hard requirement.

## Current status

**Workspace-first coding agent foundation integrated (v1.6.0).**

The `workspace_agent` Python package provides project-scoped tools for:

- Listing files while skipping common generated directories.
- Reading bounded UTF-8 text files.
- Case-insensitive source search.
- Creating/updating text files with unified diffs.
- Reading Git working-tree status.
- Running argv-array commands from the selected project directory without shell expansion.

See [Workspace Agent Foundation](docs/WORKSPACE_AGENT.md) for implementation boundaries and next steps.

## Select a project workspace

The bridge exposes workspace tools even when Roblox Studio is closed. No MCP server is required. By default, the workspace is the ZeroScript-Win repository directory. To target another project on Windows, set `ZS_WORKSPACE_ROOT` to that project's absolute path before starting the bridge. For example, in PowerShell:

```powershell
$env:ZS_WORKSPACE_ROOT = 'D:\Projects\MyApp'
py -3 bridge.py
```

The setting applies to that bridge process. Restart the bridge after changing it. Only select a directory you trust: the agent can write files and run local commands in that workspace. Optional MCP servers are configured in config.json; Roblox Studio is no longer required or started by default.

## Run the workspace tests

Requires Python 3.10 or later.

```powershell
py -3 -m unittest workspace_agent.test_tools -v
```

## Security notes

The workspace package is an execution primitive, not a complete security sandbox. Do not expose arbitrary command execution to a model or remote client without adding an approval and policy layer. The bridge binds to loopback by default and bounds execution time and output. Command execution is not a sandbox, and this iteration does not yet implement per-command approval prompts; use only trusted workspaces and add a policy/approval layer before broader distribution.

## Upstream project

This project is derived from [sebattfg/ZeroScript-Free](https://github.com/sebattfg/ZeroScript-Free). Preserve the original license and copyright notices. Changes in this fork should be identified as modifications.

The project is licensed under [GNU GPL v3](LICENSE).


## Native Blender Python integration

An optional native `bpy` MCP server is available on the `feature/bpy-native-runtime`
branch. It imports Blender's Python module directly in a dedicated Python process
instead of launching `blender.exe` for each task. Tools include scene inspection,
script execution, `.blend` open/save, rendering, and mesh export.

See [Native Blender bpy integration](docs/BLENDER_BPY.md) for installation and
configuration. Keep the `bpy` wheel in a dedicated Python environment matching
its supported interpreter version, then merge the entry in
`config.bpy.example.json` into `config.json`. Do not replace existing MCP
entries. This is an optional integration; ordinary ZeroScript and Roblox tools
remain independent of `bpy`.
