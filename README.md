# ArcScript — Local-First AI Development Environment

ArcScript is a GPL-3.0-or-later, local-first, VS Code-inspired development environment powered through supported AI chat sites.

The extension preserves the existing browser-provider integrations and Roblox Studio capabilities. General project editing and Roblox Studio automation are separate domains: the local workspace layer works with Studio closed, while live Roblox tools use the explicit `roblox/` namespace.

**ChatGPT compatibility hotfix (1.11.1):** recognizes the updated composer, modern message-turn attributes, and current Stop control. The provider falls back to a non-invasive anchored status bar if the new composer no longer exposes a safe grid slot.

## Autopilot

The extension includes an opt-in bounded continuation toggle and a separate **Independent Autopilot run** coordinator in the popup. For a coordinated run, enter a goal and one acceptance criterion per line. ArcScript persists a dependency graph for project management, implementation, QA, code review, security, documentation, ideas & insights, and lead closeout.

The coordinator dispatches tasks to idle ArcScript sessions in open provider tabs. To get independent parallel workers, open multiple supported AI provider tabs, start the ArcScript agent in each, and leave the sessions idle. The scheduler leases tasks, tracks dependencies and evidence, retries worker failures within a bounded budget, recovers expired leases, and records blocked/unverified outcomes instead of treating a formatted answer as proof of success. The popup shows task state and can cancel the run; run state is stored locally and survives popup closure.

Worker sessions share the selected local workspace. Role-level read-only rules are prompt-enforced, not a filesystem sandbox. Isolated Git worktrees and automatic patch conflict resolution are not yet implemented. High-impact actions (publishing, deployment, destructive changes, external communications, purchases, and credential/security changes) remain approval-gated.
## Current status

**Workspace-first IDE remaster in progress (v1.11.1).**

The bridge exposes an expanded, project-scoped toolset:

- Persistent local workspace selection, native folder picker exposed through the workspace tools, and a recent-project list for switching between saved workspaces.
- Project metadata, detected package manager, popular framework/tooling hints, package scripts, and source inventory.
- An agent-facing declared-task runner (`workspace_run_task`) that refuses scripts not present in the root `package.json`.
- Bounded file reads that preserve original CRLF/LF line endings, a dedicated `workspace_preview_image` tool that returns PNG/JPEG/WebP/GIF/SVG files as image content in the ArcScript preview panel (8 MB maximum), with SVG rasterization before provider upload, a depth-limited project tree, recursive file listing, glob search, regex/case-sensitive text search, and line/column matches.
- Source-file outlines for imports, headings, variables, and declarations, plus cross-language declaration/symbol discovery.
- Exact-match patch edits, validated multi-file edit batches, preview-first Replace in Files for literal or regex replacements, stale-preview protection, and complete-file writes that return unified diffs.
- Safe no-overwrite file/directory creation, rename/move, and single-file delete operations. Directory deletion and symbolic-link mutation are refused.
- Bulk `workspace_write_files` import for transferring source collected from Roblox Studio MCP into workspace-relative files, with preflight validation, overwrite protection by default, rollback on write failures, and bounded payload sizes.
- `roblox_export_tree` composite export: traverses the connected Studio DataModel, mirrors Script/LocalScript/ModuleScript source into hierarchy-preserving folders, and writes locally in bounded batches without sending the full source dump through the agent conversation.
  - Supports `exclude` hierarchy substrings and `max_script_bytes`; oversized scripts are skipped and reported instead of aborting the full export.
- Git status, structured changed-file listing, staged/unstaged diffs, branch listing, recent history, single-file stage/unstage, and confirmed local commits (no automatic push).
- A project-scoped workspace toolset exposed directly to the agent for file inspection/editing, search, project metadata, Git operations, task execution, and image preview. The standalone `/workspace.html` editor/page system is intentionally not part of the extension.
- One-click project Test/Build/Lint/Check tasks discovered from package.json and package manager metadata, each with an explicit confirmation.
- Bounded command execution from the selected project directory using an argument array and `shell=False`.

## Choose a workspace

On a fresh install, the agent asks which project folder to use before inspecting or changing files. Provide an absolute folder path or ask the agent to open the native folder picker through the workspace tools. The extension popup displays the currently selected workspace; the standalone `/workspace.html` page and editor system have been removed. The choice is saved in a private local `.zs-workspace.json` file and reused on subsequent starts.

An optional environment override is also supported:

```powershell
$env:ZS_WORKSPACE_ROOT = 'D:\Projects\MyApp'
py -3 bridge.py
```

The environment setting takes precedence over the saved folder. To change projects, ask the agent to use the workspace folder-selection tool or provide a new absolute path. The default fallback is the installation directory only for compatibility; the AI must not inspect it as a project until the user explicitly selects it.

## Two distinct tool domains

- **Workspace tools** (`workspace_*`) read and edit files on disk, inspect project structure, run relevant commands, and query Git.
- **Roblox Studio tools** (`roblox/*`) operate against the live Studio/DataModel through the optional Roblox MCP adapter.

The local workspace root and the open Roblox place are not interchangeable. Use each domain only for the actions it actually controls; use both only when a task needs both.

**Roblox MCP integrations are enabled by default.** The checked-in `config.json` keeps the existing `roblox` adapter and also registers **Dominus 2 / romcp** as `dominus` using `npx`. Dominus is a separate Studio plugin + local bridge: on first use, run `powershell -ExecutionPolicy Bypass -File .\\setup_dominus.ps1` from the repository root, follow its interactive setup, then open/reload Roblox Studio and verify the plugin reports connected. The installer uses the official `dominus-cli` npm package (now branded romcp) and its supported setup flow; it does not vendor or copy the closed-source implementation into this repository. The bridge launches configured MCP servers in parallel, so workspace tools and the existing Roblox adapter remain available independently. See [Dominus / romcp setup](docs/DOMINUS_MCP.md) for prerequisites, the 46-tool legacy catalog, current command names, and safety boundaries.

## Run the workspace tests

Requires Python 3.10 or later.

```powershell
py -3 -m unittest workspace_agent.test_tools workspace_agent.test_bridge -v
node zeroscript-extension/core/config.test.cjs
node zeroscript-extension/workspace-diagnostics.test.cjs
node zeroscript-extension/workspace-editor-utils.test.cjs
```

## Security notes

The workspace layer checks resolved paths against the selected root, bounds text operations, and launches commands without shell expansion. These controls reduce accidental scope and shell-injection risk, but do **not** make arbitrary programs harmless or constitute a security sandbox. Command execution does not yet have a per-command approval dialog. Select only trusted folders and do not expose the local bridge beyond loopback.

See [Workspace Agent Remaster](docs/WORKSPACE_AGENT.md) for tool details and boundaries.

## Upstream project

Upstream attribution: ArcScript is derived from the [original ZeroScript Free project](https://github.com/sebattfg/ZeroScript-Free). Preserve original license and copyright notices and identify modifications made in this fork.

Licensed under [GNU GPL v3](LICENSE).


## Native Blender Python integration

The full remaster includes an optional native Blender `bpy` MCP integration. It runs Blender's Python module directly in a dedicated Python process rather than launching `blender.exe` for each task. Tools cover runtime status, scene inspection, script execution, `.blend` open/save, rendering, and model export.

See [Native Blender bpy integration](docs/BLENDER_BPY.md) for the Windows setup and tool configuration. Install the `bpy` wheel in a dedicated Python environment compatible with the published wheel, then merge the entry in `config.bpy.example.json` into the existing `config.json` `mcpServers` object. Preserve the existing Roblox MCP entry and all other configured servers. This integration is optional and does not replace the remaster's workspace or Roblox tools.


### Blender-to-Roblox asset pipeline

The native `bpy` server supports texture packing, GLB export, and structural validation before upload. See [the Blender integration guide](docs/BLENDER_BPY.md) for the recommended pre-upload sequence and its limitations. GLB validation checks file structure and external references; visual material fidelity and Roblox import compatibility still require verification.
