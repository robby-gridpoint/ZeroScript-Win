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

## Target architecture

A genuine multi-agent mode should use a coordinator and isolated worker sessions:

- **Lead developer / orchestrator** — owns the user goal, creates the task graph, delegates, merges results, and makes the completion decision.
- **Project manager** — turns the request into acceptance criteria, dependencies, milestones, and a prioritized task queue.
- **Implementation worker** — owns implementation tasks and reports changed files, decisions, and verification evidence.
- **QA worker** — independently checks acceptance criteria, runs relevant tests, and files reproducible failures.
- **Code reviewer** — inspects diffs for regressions, maintainability, and edge cases; should not rubber-stamp the implementation worker.
- **Security reviewer** — evaluates tool permissions, untrusted input, secrets, and high-impact operations.
- **Documentation worker** — updates setup, usage, and handoff documentation based on verified behavior.
- **Ideas & insights agent** — independently searches for high-value improvements, simplifications, overlooked risks, and opportunities beyond the immediate acceptance criteria. It ranks ideas by impact, effort, risk, and relevance; the lead decides whether to implement or defer them. It must not turn speculative ideas into unapproved scope expansion.

Workers should be routed to separate provider sessions when available, with per-provider capability and availability checks. If only one provider is available, the UI must explicitly label the workflow as **single-provider role simulation** rather than claiming independent agents.

## Shared task ledger

Persist a project-scoped run record with:
- run ID, original user goal, active workspace, current state, and stop/cancel status;
- tasks with owner role, status, dependencies, acceptance criteria, and bounded retry count;
- worker findings and references to relevant files, diffs, tool results, and test output;
- unresolved questions, approval requests, and final verification summary.

The ledger is the source of truth; agents must not infer completion merely from a confident final answer. Task state transitions should be validated and append a short event record so a failed or reloaded tab can recover safely.

## Orchestration cycle

1. Plan: the lead creates explicit, testable acceptance criteria.
2. Delegate: independent analysis tasks can run in parallel; conflicting writes to the same files must be serialized or isolated in separate worktrees/patches.
3. Implement: the implementation worker makes scoped changes.
4. Verify: QA runs relevant checks and reports evidence, not just a pass/fail claim.
5. Review: reviewer and security findings return to the lead.
6. Resolve: the lead assigns targeted fixes or asks the user when a decision/approval is required.
7. Close: finish only when acceptance criteria are verified, or report a precise blocker. Enforce run-wide time, task, and retry budgets.

## Safety and control boundaries

- Autopilot is opt-in, visible, and immediately stoppable.
- Stop cancels queued work and prevents new tool dispatches; in-flight calls are allowed to return or time out safely.
- Read and inspect actions may be automated within the selected workspace. File edits and local test commands are limited to the active workspace and existing tool policies.
- Publishing, deployment, external communication, purchases, credential/security changes, destructive operations, and other consequential actions require explicit user approval.
- Never claim a test, import, deployment, or external action succeeded without its actual result.
- Preserve task state and report incomplete work when the browser/provider disconnects, context limits are reached, or a worker becomes unavailable.

## Completion contract

The lead produces a concise report with: delivered changes, verification actually performed, QA/reviewer findings, remaining risks, approval-gated actions, and any uncompleted acceptance criteria. A bounded run must end in `completed`, `blocked`, `needs_approval`, `failed`, or `cancelled`—never an unbounded self-prompt loop.
