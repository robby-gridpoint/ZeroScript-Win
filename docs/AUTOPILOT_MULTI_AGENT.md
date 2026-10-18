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

The worker pool uses authenticated, already-started provider conversations in separate browser tabs; it does not provision provider accounts or bypass site authentication. If no idle worker tab is available, tasks remain ready and the run stays resumable. The extension still uses the shared selected workspace for every worker. Role-level read-only rules are prompt-enforced rather than OS-enforced, and there are not yet isolated Git worktrees, automatic patch conflict resolution, or a native multi-provider API runtime. Therefore, this is now a real multi-session task coordinator, but **not** a fully isolated/sandboxed worker system.

## Remaining architecture gaps

The task graph, leases, durable run ledger, worker dispatch, and evidence-gated closeout are implemented. The next hardening steps are:

- **Workspace isolation:** worker sessions currently share the selected workspace. Add per-task Git worktrees or isolated copies before permitting concurrent write-capable tasks.
- **Enforced capabilities:** role-specific read-only policies are currently prompt-enforced. Enforce permissions at the tool-dispatch boundary so analysis/review workers cannot call edit or command tools.
- **Structured patch integration:** collect worker changes as patches or branch commits, detect file conflicts, serialize overlapping edits, and require the lead to resolve conflicts before verification.
- **Criterion-level verification:** require structured QA evidence tied to each acceptance criterion (test command, exit status, output excerpt, and relevant files), rather than relying only on the worker report's VERIFIED labels plus successful tool-call records.
- **Run management:** add explicit UI controls for retrying blocked tasks, inspecting full event/evidence history, and resuming a run from a stale browser session.

Do not claim workspace isolation, enforced role permissions, automatic patch merging, or criterion-level proof until those controls are implemented and tested.

## Safety and control boundaries

- Autopilot is opt-in, visible, and immediately stoppable.
- Stop cancels queued work and prevents new tool dispatches; in-flight calls are allowed to return or time out safely.
- Read and inspect actions may be automated within the selected workspace. File edits and local test commands are limited to the active workspace and existing tool policies.
- Publishing, deployment, external communication, purchases, credential/security changes, destructive operations, and other consequential actions require explicit user approval.
- Never claim a test, import, deployment, or external action succeeded without its actual result.
- Preserve task state and report incomplete work when the browser/provider disconnects, context limits are reached, or a worker becomes unavailable.

## Completion contract

The lead produces a concise report with: delivered changes, verification actually performed, QA/reviewer findings, remaining risks, approval-gated actions, and any uncompleted acceptance criteria. A bounded run must end in `completed`, `blocked`, `needs_approval`, `failed`, or `cancelled`—never an unbounded self-prompt loop.
