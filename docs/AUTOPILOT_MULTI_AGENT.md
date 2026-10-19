# Autopilot Multi-Agent Architecture

## Current implementation

The extension popup now exposes a separate **Independent Autopilot run** coordinator. A user supplies a goal and explicit acceptance criteria; the coordinator persists a run record in `chrome.storage.local` and creates a dependency graph for project management, implementation, QA, code review, security, documentation, ideas & insights, and lead closeout.

Implemented runtime capabilities:

- **Durable task graph:** validated task-state transitions, dependencies, per-task retry budgets, leases with expiration, append-only bounded event history, and recovery of expired leases after service-worker/popup interruptions.
- **Independent browser-session workers:** the background coordinator probes open provider tabs and dispatches ready tasks only to ArcScript sessions that are already started and idle. A worker receives one role-scoped task, original goal, acceptance criteria, and completed dependency evidence. Different tabs can execute independent ready tasks concurrently.
- **Evidence-backed task completion:** a worker must return a report and actual successful tool output. QA must explicitly mark every user-supplied acceptance criterion as VERIFIED in its report, and must have successful tool evidence. The final run can complete only when all graph tasks are complete, the QA record covers every acceptance criterion, and the lead task has evidence.
- **Bounded recovery:** worker errors or missing evidence are retried within the task attempt budget; exhausted tasks block the run. Expired leases can be reclaimed. The popup can stop a run, and run state survives popup closure.
- **Role boundaries:** project management, QA, code review, security, and ideas & insights are instructed to be read-only; implementation owns implementation edits; documentation edits only after review dependencies; the lead integrates after all required reviews.
- **Approval boundaries:** publishing, deployment, external communication, purchases, destructive actions, credential/security changes, and other consequential actions remain approval-gated.

The worker pool uses authenticated, already-started provider conversations in separate browser tabs; it does not provision provider accounts or bypass site authentication. If no idle worker tab is available, tasks remain ready and the run stays resumable. The extension still uses the shared selected workspace for every worker. A dispatch-boundary capability policy now denies write/command tools to project management, QA, code review, security, and ideas workers; documentation workers may edit only approved documentation paths; implementation and lead workers are blocked from destructive filesystem and Git index/history operations. The ledger serializes all write-capable roles while the workspace is shared. QA completion now requires a structured record for every user acceptance criterion, with a tool name and an excerpt that must match a successful tool output recorded by that QA worker. These are meaningful enforcement improvements, but not an OS sandbox, isolated Git worktrees, automatic patch conflict resolution, or a native multi-provider API runtime. Treat the worker pool as multi-session with enforced dispatch policy and serialized writes, **not** as a fully isolated/sandboxed worker system.

## Remaining architecture gaps

The task graph, leases, durable run ledger, worker dispatch, and evidence-gated closeout are implemented. The next hardening steps are:

- **Workspace isolation:** workers still share the selected workspace. Writes are serialized by role, but per-task Git worktrees or isolated copies are needed before enabling parallel implementation tasks.
- **Structured patch integration:** collect worker changes as patches or branch commits, detect file conflicts, and require the lead to resolve conflicts before verification. The current writer lock prevents simultaneous writes but is not a patch merge system.
- **Stronger criterion verification:** QA evidence excerpts are checked against actual successful tool outputs, but test command/exit status and relevant-file attribution are not yet represented in a typed evidence schema. A matched excerpt is evidence provenance, not proof the criterion is satisfied.
- **Run management:** the popup now exposes manual retry for blocked/failed tasks whose dependencies are complete and an expandable evidence/findings view per task. A dedicated event timeline and explicit resume controls for stale provider sessions remain follow-on work.

Do not claim workspace isolation, automatic patch merging, or criterion-level proof until those controls are implemented and tested. The dispatch capability policy is implemented as defense in depth; it is not an OS sandbox and still requires CI/runtime verification.

## Safety and control boundaries

- Autopilot is opt-in, visible, and immediately stoppable.
- Stop cancels queued work and prevents new tool dispatches; in-flight calls are allowed to return or time out safely.
- Read and inspect actions may be automated within the selected workspace. File edits and local test commands are limited to the active workspace and existing tool policies.
- Publishing, deployment, external communication, purchases, credential/security changes, destructive operations, and other consequential actions require explicit user approval.
- Never claim a test, import, deployment, or external action succeeded without its actual result.
- Preserve task state and report incomplete work when the browser/provider disconnects, context limits are reached, or a worker becomes unavailable.

## Completion contract

The lead produces a concise report with: delivered changes, verification actually performed, QA/reviewer findings, remaining risks, approval-gated actions, and any uncompleted acceptance criteria. A bounded run must end in `completed`, `blocked`, `needs_approval`, `failed`, or `cancelled`—never an unbounded self-prompt loop.


## Unity recovery pipeline milestone

The workspace bridge now exposes a bounded Unity inspection/code-intelligence layer:

- Installation scanning reports Unity version, managed assembly evidence, Mono/IL2CPP indicators, serialized asset sizes, and editable-project markers without mutating the source installation.
- File-level asset cataloging is deterministic and resumable using a workspace-local JSON catalog and cursor state. Large asset bytes are not read; this is inventory, not extraction.
- Tool discovery reports available executables without installing software.
- ILSpy CLI operations support single-type decompilation and whole-assembly source export, with argument-array execution, timeouts, and output overwrite protection.

Still outstanding: AssetRipper process/job orchestration and resumable extraction, serialized object/dependency parsing, Mono.Cecil call/reference analysis, Unity Editor validation, Playwright browser regression tests, durable job IDs/cancellation, and per-task artifact manifests. The implementation must not describe the current file catalog as a parsed Unity asset catalog.
