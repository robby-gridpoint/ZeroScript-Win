# Workspace agent remaster

ZeroScript-Win exposes a local-first coding workspace independently from its optional MCP integrations. The browser extension remains the agent UI and the loopback bridge owns local filesystem and process operations.

## First-run selection

- The first-run workspace falls back to the bridge directory for compatibility, but it is marked unconfigured.
- The bootstrap tool catalogue includes the current workspace path and its configured state in the `workspace_info` description. The agent uses that state to ask for a project folder before performing inspection or edits.
- The user can provide a full path through chat (`workspace_set_root`) or open the native operating-system folder dialog (`workspace_browse`). The picker returns a proposed path only; `workspace_set_root` activates and persists that exact path. The extension popup opens a persistent Workspace Explorer tab before launching the picker so losing popup focus cannot interrupt activation.
- The selected folder is persisted in `.zs-workspace.json` beside the bridge. This file is ignored by Git because it contains a machine-specific path.
- `ZS_WORKSPACE_ROOT`, when set, takes precedence over the saved folder.

## Workspace tool catalogue

| Tool | Purpose |
| --- | --- |
| `workspace_info` | Current root and explicit-selection status. |
| `workspace_set_root` | Validate and persist a folder explicitly supplied by the user. |
| `workspace_browse` | Open the native folder picker and return a candidate path without activating it. |
| `workspace_project_info` | Detect common manifests, project-type hints, package scripts, Git presence, and file-extension inventory. |
| `workspace_create_file` | Create a UTF-8 file without overwriting an existing path; its parent directory must already exist. |
| `workspace_create_directory` | Create a workspace-relative directory without overwriting an existing path. |
| `workspace_move_path` | Move/rename a file or directory within the workspace without overwriting a destination. |
| `workspace_delete_file` | Delete a single regular file; directories and symbolic links are refused. Use only after an explicit user request. |
| `workspace_tree` | Return a depth-limited project tree while skipping generated folders and symbolic links. |
| `workspace_list_files` | List project files while skipping common generated directories and symbolic links. |
| `workspace_find_files` | Find paths using glob patterns. |
| `workspace_read_file` | Read bounded UTF-8 text, optionally by 1-based line range. |
| `workspace_file_outline` | Extract import statements, headings, variables, and likely declarations with line numbers. |
| `workspace_search` | Text search with optional case sensitivity and regular expressions; matches include line and column. |
| `workspace_symbols` | Best-effort discovery of function, type, and variable declarations across multiple language families. |
| `workspace_write_file` | Create or replace a UTF-8 file and return a unified diff. |
| `workspace_apply_patch` | Apply one exact source replacement; repeated matches are rejected unless the caller explicitly opts into replace-all. |
| `workspace_multi_edit` | Validate and apply a batch of exact replacements across multiple files, refusing ambiguous/missing matches before writes and returning per-file diffs. |
| `workspace_git_status` | Read Git branch and working-tree status. |
| `workspace_git_diff` | Read staged or unstaged diffs, optionally for one path. |
| `workspace_git_branches` | List local and remote Git branches. |
| `workspace_git_log` | Read recent commit summaries. |
| `workspace_run_command` | Run argv-array commands from the selected root, without shell expansion and with bounded time/output. |

## Separate Roblox Studio domain

Roblox MCP tools are advertised under the `roblox/` namespace, while on-disk project operations use `workspace_*` names. This is a deliberate capability boundary:

- Roblox tools act on the live Studio/DataModel and may need an open place.
- Workspace tools act on local files and the selected folder, regardless of whether Studio is running.
- Tool names, working roots, output, and assumptions must not be mixed just because a task relates to Roblox.
- A Roblox project may use both domains, but the agent must decide explicitly whether it needs an on-disk edit, a live Studio operation, or both.

Legacy conversations calling bare Roblox tool names are routed to the matching Roblox server when the name is unambiguous. New prompts should always use the namespaced `roblox/` form.

## Safety and operational boundaries

- Workspace paths are resolved and checked against the selected root, including resolved symlinks.
- Text reads/writes and search results are bounded. Common generated directories are excluded by default.
- Targeted patches require a non-empty exact fragment. Ambiguous matches are refused by default.
- Command execution uses argv arrays and `shell=False`, which avoids shell expansion but does not sandbox the selected executable.
- The current foundation does not yet provide a per-command approval dialog. Treat command execution as powerful: select trusted workspaces and never expose the loopback bridge on a public interface.
- The native folder picker can depend on the local Python install having Tk support. If unavailable, the agent can use a folder path explicitly provided by the user.

## Tests

From the repository root:

```powershell
py -3 -m unittest workspace_agent.test_tools workspace_agent.test_bridge -v
```

## Workspace Explorer interface

Open **Workspace Explorer** from the extension popup to use the local tree, source editor, lightweight language-token highlighting and line numbers, fuzzy Quick Open, searchable Command Palette, search panel, outline/project panes, Git views, and command runner. The editor supports Tab indentation, basic Enter auto-indent, Ctrl+S, Ctrl+P quick open, and Ctrl+Shift+P command palette. Project metadata exposes detected package scripts as one-click Test/Build/Lint/Check tasks, each confirmed before running. It is not a full language-server-backed IDE: semantic highlighting, language servers, inline diagnostics, completion, breakpoints, and debugger integration are not implemented in this remaster stage. Unsaved files are not saved to a different workspace if the selected root changes.

This tool layer remains independent from the Roblox MCP package.
