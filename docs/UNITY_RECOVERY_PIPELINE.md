# Unity Recovery Pipeline

## Purpose and boundaries

This pipeline supports a browser-playable fan restoration from an installed Unity player. It does not turn a packaged player into the original source project automatically. The installed game remains read-only; all catalogs, decompiled source, exports, QA logs, and screenshots belong under the selected ArcScript workspace.

The first target build is a Unity 6 Mono player. The known managed assemblies include \`Assembly-CSharp.dll\` and \`Assembly-CSharp-firstpass.dll\`. Treat the approximately 1.64 GB \`resources.assets\` file as a large input: inventory first, then select an extraction strategy.

## Tool sequence

1. **Discover the environment**
   - \`workspace_info\`
   - \`inspect_recovery_tooling\`
   - \`scan_unity_installation\` with the absolute game installation path
2. **Inventory before extraction**
   - Call \`catalog_unity_assets\` with the installation path and a modest \`batch_size\`.
   - Repeat until \`status=complete\`. The cursor and catalog are saved under \`recovery/asset-catalog.json\`.
   - This is a file-level catalog. It does not parse Unity serialized object IDs, bundle dependencies, or object types.
3. **Recover managed logic**
   - Install/configure ILSpy CLI separately if it is not available.
   - Use \`decompile_unity_type\` for targeted investigation of types such as \`StudentScript\`, \`StudentManagerScript\`, and \`ClockScript\`.
   - Use \`export_unity_assembly\` only when a searchable source tree is needed. It refuses to overwrite a non-empty output directory.
4. **Extract assets**
   - Use \`start_assetripper_export\` only after checking the executable path and available disk space.
   - Prefer \`Primary\` mode for a first raw-content pass; \`Unity\` mode aims to produce an editable Unity project and can require substantially more storage.
   - The executable must be an AssetRipper CLI-compatible build that accepts \`--cli --input --output --mode --script-content-level --log-path\`. Do not assume every AssetRipper distribution has the same CLI.
   - The job returns a durable ID. Poll \`assetripper_job_status\`; use \`cancel_assetripper_job\` if required. Export output must be workspace-relative and empty/new; the original input is never used as the output.
   - Current limitation: this starts a whole-input export. It does not yet perform per-asset selection or resume an interrupted AssetRipper export internally. A cancelled/interrupted export must be inspected before retrying.
5. **Validate the browser restoration**
   - \`inspect_browser_port\` audits the entry point and referenced local scripts/styles.
   - \`start_browser_server\` launches a static HTTP server bound to \`127.0.0.1\` and returns a job ID/URL.
   - \`run_browser_qa\` checks the HTTP response and static references. If Python Playwright and Chromium are installed, it also captures browser console/page errors, failed requests, and a screenshot.
   - \`stop_browser_server\` stops only a process tracked by the current bridge instance.
   - A successful page load is not gameplay parity. Movement, interactions, schedules, menus, persistence, and visual comparisons need explicit automated tests.

## Safety and resumability

- Unity installation paths are inputs, never export destinations.
- Export output paths are constrained to the selected workspace.
- Existing non-empty export directories are rejected.
- Process execution uses argument arrays with shell expansion disabled.
- AssetRipper jobs store status, PID, timeout, command, output paths, and separate stdout/tool logs.
- Job cancellation is permitted only when the current bridge instance owns the process. After a bridge restart, an untracked process is not killed by PID alone.
- Asset catalogs resume by a deterministic relative-path cursor and never read full large asset payloads.
- No tool silently installs software.

## Not yet implemented

- Unity serialized-object parsing, asset GUID/object dependency graphs, and targeted extraction by asset name/type.
- UnityPy/UABEA adapters and AssetRipper failure-manifest ingestion.
- Mono.Cecil metadata/call-reference analysis beyond what ILSpy CLI provides.
- A durable process supervisor that can safely adopt and cancel child processes after bridge restarts.
- Unity Editor compile/scene validation.
- Playwright-driven input scenarios for movement, interaction, menus, schedules, and save/load.
- Reference screenshot baselines and pixel/structure comparison.
- Feature-parity tracking that links each reconstructed system to decompilation evidence, asset dependencies, implementation files, and regression tests.

## Completion standard

Do not mark a subsystem recovered merely because assets were exported or a page loads. A subsystem is ready when its source behavior has evidence, required assets are cataloged and mapped, the browser implementation exists, relevant regression scenarios pass, and known gaps are recorded.
