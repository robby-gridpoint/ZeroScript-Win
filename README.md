# ZeroScript Win — Local-First Coding Agent

ZeroScript Win is a GPL-3.0-or-later fork of ZeroScript Free, being evolved from a Roblox Studio-specific agent into a local-first software development agent.

The original browser provider integrations are being retained during the transition. The long-term architecture uses a general workspace tool backend, optional MCP integrations, and Roblox Studio as an optional adapter rather than a hard requirement.

## Current status

**Early migration: workspace foundation added.**

The `workspace_agent` Python package provides project-scoped tools for:

- Listing files while skipping common generated directories.
- Reading bounded UTF-8 text files.
- Case-insensitive source search.
- Creating/updating text files with unified diffs.
- Reading Git working-tree status.
- Running argv-array commands from the selected project directory without shell expansion.

See [Workspace Agent Foundation](docs/WORKSPACE_AGENT.md) for implementation boundaries and next steps.

## Run the workspace tests

Requires Python 3.10 or later.

```powershell
py -3 -m unittest workspace_agent.test_tools -v
```

## Security notes

The workspace package is an execution primitive, not a complete security sandbox. Do not expose arbitrary command execution to a model or remote client without adding an approval and policy layer. The eventual bridge should bind to loopback by default, require an explicitly selected workspace, validate tool schemas, bound execution time and output, and ask for confirmation before destructive or externally consequential operations.

## Upstream project

This project is derived from [sebattfg/ZeroScript-Free](https://github.com/sebattfg/ZeroScript-Free). Preserve the original license and copyright notices. Changes in this fork should be identified as modifications.

The project is licensed under [GNU GPL v3](LICENSE).
