// SPDX-License-Identifier: GPL-3.0-or-later
"use strict";
const assert = require("node:assert/strict");
const L = require("./autopilot-ledger.js");

const run = L.createRun({
  goal: "Implement a sample feature safely.",
  workspace: "C:/projects/sample",
  acceptanceCriteria: ["Feature is implemented", "Relevant tests pass"],
  maxRunMs: 300000,
});
assert.equal(run.tasks.length, 8);
assert.equal(run.state, "planning");
assert.throws(() => L.createRun({ goal: "missing criteria" }), /acceptance criterion/);

let ready = L.refreshReady(run);
assert.deepEqual(ready.map((t) => t.role), ["project_manager"]);
let claim = L.claimNext(run, { id: "worker-pm", provider: "deepseek", tabId: 1, roles: ["project_manager"] });
assert.equal(claim.task.role, "project_manager");
assert.equal(claim.task.status, "leased");
assert.throws(() => L.transition(run, claim.task.id, "running", { leaseToken: "wrong" }), /lease token/);
L.transition(run, claim.task.id, "running", { leaseToken: claim.lease.token });
L.transition(run, claim.task.id, "completed", {
  evidence: [{ summary: "Plan written and acceptance criteria enumerated", source: "worker report" }],
});
ready = L.refreshReady(run);
assert.deepEqual(ready.map((t) => t.role).sort(), ["ideas_insights", "implementation"]);

const impl = L.claimNext(run, { id: "worker-impl", provider: "gemini", tabId: 2, roles: ["implementation"] });
L.transition(run, impl.task.id, "running", { leaseToken: impl.lease.token });
L.transition(run, impl.task.id, "completed", {
  evidence: [{ summary: "Changed src/feature.js", source: "diff" }],
});
ready = L.refreshReady(run);
assert(ready.some((t) => t.role === "qa"));
assert(ready.some((t) => t.role === "code_review"));
assert(ready.some((t) => t.role === "security"));

const qa = run.tasks.find((t) => t.role === "qa");
L.transition(run, qa.id, "ready");
const qaClaim = L.claimNext(run, { id: "qa-worker", provider: "chatgpt", roles: ["qa"] });
L.transition(run, qa.id, "running", { leaseToken: qaClaim.lease.token });
assert.throws(() => L.transition(run, qa.id, "completed", {
  evidence: [{ summary: "looks fine" }], criteriaVerified: ["Feature is implemented"],
}), /explicit verified criteria/);
L.transition(run, qa.id, "completed", {
  evidence: [{ summary: "Test output: 12 passed" }],
  criteriaVerified: ["Feature is implemented", "Relevant tests pass"],
});
assert.equal(qa.criteriaVerified.length, 2);

const run2 = L.createRun({ goal: "Test cancellation", acceptanceCriteria: ["Done"] });
L.refreshReady(run2);
L.cancelRun(run2, "user clicked stop");
assert.equal(run2.state, "cancelled");
assert(run2.tasks.every((t) => !["queued", "ready", "leased", "running"].includes(t.status)));

const run3 = L.createRun({ goal: "Test lease recovery", acceptanceCriteria: ["Done"] });
L.refreshReady(run3);
const lease = L.claimNext(run3, { id: "lost-worker", leaseMs: 30000 });
lease.task.lease.expiresAt = new Date(Date.now() - 1000).toISOString();
assert.deepEqual(L.recoverExpiredLeases(run3), [lease.task.id]);
assert.equal(lease.task.status, "ready");

const cyclic = L.createRun({ goal: "Cycle", acceptanceCriteria: ["Done"] });
cyclic.tasks[0].dependencies.push(cyclic.tasks[1].id);
cyclic.tasks[1].dependencies.push(cyclic.tasks[0].id);
assert.throws(() => L.validate(cyclic), /cycle/);

process.stdout.write("Autopilot task graph tests passed.\n");
