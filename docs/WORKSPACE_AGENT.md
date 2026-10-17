# Workspace agent foundation

ZeroScript-Win is being decoupled from Roblox Studio into a local-first coding
agent. The existing browser provider adapters and MCP bridge remain available
while the workspace backend is introduced independently.

## Initial workspace tools

The `workspace_agent` Python package currently exposes a workspace root and
safe, project-relative tools:

- `describe()`: report the selected workspace.
- `list_files(path, max_results, include_hidden)`: enumerate project files
  while skipping common generated directories.
- `read_file(path)`: read a bounded UTF-8 source file.
- `search(query, path, max_results)`: case-insensitive source search.
- `write_file(path, content)`: create or replace a UTF-8 text file and return
  a unified diff.
- `git_status()`: show repository status.
- `run_command(argv, timeout)`: run an argument-array command without a shell
  from the selected project directory.

## Safety boundaries

- Paths are resolved and checked against the selected root, including resolved
  symlinks.
- Text reads and writes are bounded to avoid unexpectedly loading large files.
- Command execution accepts argv arrays and uses `shell=False`; this reduces
  shell-injection risk but does not make an arbitrary program harmless.
- The workspace layer itself does not ask for permission. A UI/bridge integration
  must add explicit approval and policy checks before exposing command execution.
- Do not bind any future local service to a public interface by default.

## Run tests

From the repository root:

```powershell
py -3 -m unittest workspace_agent.test_tools -v
```

This module is intentionally independent of Roblox MCP. The next integration
step is to add a configurable workspace tool provider to the bridge, then let
the extension present its tools through the same validated tool-call flow.
