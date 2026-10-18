# Autopilot Multi-Agent Architecture

## Current implementation

The extension popup has an opt-in Autopilot toggle, persisted in `chrome.storage.local`. It defaults to off. When enabled, the current agent loop may perform up to three bounded follow-up review passes after it would otherwise return a final answer. These passes ask the active provider to focus on useful remaining work, tests, code review, security, or documentation. The normal Stop control remains authoritative.

**This is a first-stage role-guided continuation loop, not yet a true multi-model team.** It reuses the active AI provider and conversation. It must not be represented as independent agents or parallel brains.

## Target architecture

A genuine multi-agent mode should use a coordinator and isolated worker sessions:

- **Lead developer / orchestrator** — owns the user goal, creates the task graph, delegates, merges results, and makes the completion decision.
- **Project manager** — turns the request into acceptance criteria, dependencies, milestones, and a prioritized task queue.
- **Implementation worker** — owns implementation tasks and reports changed files, decisions, and verification evidence.
- **QA worker** — independently checks acceptance criteria, runs relevant tests, and files reproducible failures.
- **Code reviewer** — inspects diffs for regressions, maintainability, and edge cases; should not rubber-stamp the implementation worker.
- **Security reviewer** — evaluates tool permissions, untrusted input, secrets, and high-impact operations.
- **Documentation worker** — updates setup, usage, and handoff documentation based on verified behavior.

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
