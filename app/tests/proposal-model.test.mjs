// Phase 6 Gate — Human Review / Action Safety.
//
// Proves the Review Center is backed by a REAL Proposal model:
//   Proposal created → Review Center → Approve → local apply
//   Reject → never executes
//   Edit  → the EDITED payload is what executes
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createProposal,
  transitionProposal,
  effectivePayload,
  canProposeTransition,
  isPending,
  isTerminal,
  requiresReview,
  PROPOSAL_STATUS,
  ACTION_KINDS,
  ALWAYS_REVIEW_ACTIONS,
} from "../src/workbench/proposal-model.js";

// ── read-only capabilities never require review ─────────────────────────

test("read-only actions do not require review", () => {
  assert.equal(requiresReview(ACTION_KINDS.READ_ONLY), false);
  const p = createProposal({ kind: ACTION_KINDS.READ_ONLY, title: "只读建议" });
  assert.equal(p.requiresReview, false);
});

test("every external side-effect action requires review", () => {
  for (const kind of ALWAYS_REVIEW_ACTIONS) {
    assert.equal(requiresReview(kind), true, `${kind} must require review`);
    const p = createProposal({ kind, title: "副作用" });
    assert.equal(p.requiresReview, true);
  }
  // The five the brief calls out explicitly.
  assert.deepEqual(
    [...ALWAYS_REVIEW_ACTIONS].sort(),
    ["create_calendar", "create_reminder", "external_submit", "send_email", "write_file"].sort(),
  );
});

// ── state machine discipline ────────────────────────────────────────────

test("a new proposal starts PROPOSED and is pending", () => {
  const p = createProposal({ title: "创建后续任务", kind: ACTION_KINDS.CREATE_REMINDER });
  assert.equal(p.status, PROPOSAL_STATUS.PROPOSED);
  assert.equal(isPending(p), true);
  assert.equal(isTerminal(p), false);
  assert.equal(p.history.length, 1);
});

test("illegal transitions throw rather than silently corrupt state", () => {
  const p = createProposal({ title: "x" });
  assert.throws(() => transitionProposal(p, PROPOSAL_STATUS.EXECUTED), /illegal transition/);
  const rejected = transitionProposal(p, PROPOSAL_STATUS.REJECTED);
  assert.throws(
    () => transitionProposal(rejected, PROPOSAL_STATUS.EXECUTED),
    /illegal transition/,
    "a rejected proposal must be terminal",
  );
});

test("the full legal path is walkable", () => {
  let p = createProposal({ title: "创建后续任务", kind: ACTION_KINDS.CREATE_REMINDER });
  p = transitionProposal(p, PROPOSAL_STATUS.APPROVED);
  p = transitionProposal(p, PROPOSAL_STATUS.EXECUTED);
  assert.equal(p.status, PROPOSAL_STATUS.EXECUTED);
  assert.equal(isTerminal(p), true);
  assert.equal(p.history.length, 3, "every transition is recorded");
});

test("canProposeTransition encodes the machine", () => {
  assert.equal(canProposeTransition("proposed", "approved"), true);
  assert.equal(canProposeTransition("proposed", "rejected"), true);
  assert.equal(canProposeTransition("proposed", "executed"), false);
  assert.equal(canProposeTransition("rejected", "approved"), false);
  assert.equal(canProposeTransition("executed", "failed"), false);
});

test("all six required statuses exist", () => {
  for (const s of ["PROPOSED", "APPROVED", "EDITED", "REJECTED", "EXECUTED", "FAILED"]) {
    assert.ok(PROPOSAL_STATUS[s], `${s} must be defined`);
  }
});

// ── edit semantics: the EDITED payload is what executes ─────────────────

test("editing merges the payload and still requires a final human yes", () => {
  const p = createProposal({
    title: "创建后续任务",
    kind: ACTION_KINDS.CREATE_REMINDER,
    payload: { goal: "原目标", priority: "low" },
  });
  const edited = transitionProposal(p, PROPOSAL_STATUS.EDITED, {
    editedPayload: { goal: "修改后的目标" },
  });
  assert.equal(edited.status, PROPOSAL_STATUS.EDITED);
  assert.equal(edited.editedPayload.goal, "修改后的目标");
  assert.equal(edited.editedPayload.priority, "low", "unrelated fields are preserved");
  assert.equal(edited.requiresReview, true, "an edit must still be confirmed");
  // The EDITED payload wins over the original.
  assert.equal(effectivePayload(edited).goal, "修改后的目标");
  // And it is executable after approval.
  const approved = transitionProposal(edited, PROPOSAL_STATUS.APPROVED);
  const executed = transitionProposal(approved, PROPOSAL_STATUS.EXECUTED);
  assert.equal(effectivePayload(executed).goal, "修改后的目标");
});

// ── execute semantics (repository-level, local apply) ───────────────────

function memStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

// ONE shared storage per process: a "reload" must still see prior writes, so
// freshRepo() re-reads the same backing store rather than making a new one.
let SHARED = memStorage();
globalThis.localStorage = SHARED;

async function freshRepo() {
  globalThis.localStorage = SHARED;
  // Cache-bust so each call gets a clean module instance (as a page reload would).
  const mod = await import(`../src/store/proposal-repository.js?bust=${Math.random()}`);
  return mod;
}

function resetStorage() {
  SHARED = memStorage();
  globalThis.localStorage = SHARED;
}

test("approve → executes a local action and records it", async () => {
  resetStorage();
  const repo = await freshRepo();
  const p = repo.saveProposal({
    kind: ACTION_KINDS.CREATE_REMINDER,
    title: "创建后续任务",
    payload: { goal: "报名参加活动" },
  });
  const done = repo.approveProposal(p.id, { createTask: (pl) => ({ id: "t1", title: pl.goal }) });
  assert.equal(done.status, PROPOSAL_STATUS.EXECUTED);
  assert.equal(isTerminal(done), true);
  const stored = repo.getProposal(p.id);
  assert.equal(stored.status, PROPOSAL_STATUS.EXECUTED);
  assert.ok(/已创建后续任务/.test(stored.history[stored.history.length - 1].note));
});

test("reject → never executes", async () => {
  resetStorage();
  const repo = await freshRepo();
  let executed = false;
  const p = repo.saveProposal({
    kind: ACTION_KINDS.CREATE_REMINDER,
    title: "创建后续任务",
    payload: { goal: "不该被创建" },
  });
  const done = repo.rejectProposal(p.id);
  assert.equal(done.status, PROPOSAL_STATUS.REJECTED);
  assert.equal(executed, false, "reject must not execute anything");
  assert.equal(repo.getProposal(p.id).status, PROPOSAL_STATUS.REJECTED);
  // A rejected proposal is terminal: a stale approve() call must be a no-op
  // returning the proposal unchanged, never a throw and never an execution.
  const afterApprove = repo.approveProposal(p.id, {
    createTask: () => { executed = true; return { id: "nope" }; },
  });
  assert.equal(afterApprove.status, PROPOSAL_STATUS.REJECTED, "still rejected after approve()");
  assert.equal(executed, false, "a rejected proposal must never execute");
  assert.equal(repo.getProposal(p.id).status, PROPOSAL_STATUS.REJECTED);
});

test("edit → the modified content is what executes", async () => {
  resetStorage();
  const repo = await freshRepo();
  let createdPayload = null;
  const p = repo.saveProposal({
    kind: ACTION_KINDS.CREATE_REMINDER,
    title: "创建后续任务",
    payload: { goal: "原始目标" },
  });
  repo.editProposal(p.id, { goal: "修改后的目标" });
  assert.equal(repo.getProposal(p.id).status, PROPOSAL_STATUS.EDITED);
  // EDITED is not directly executable — a human must still approve.
  repo.executeProposal(p.id);
  assert.equal(repo.getProposal(p.id).status, PROPOSAL_STATUS.EDITED, "edit alone must not execute");
  const done = repo.approveProposal(p.id, {
    createTask: (pl) => { createdPayload = pl; return { id: "t2", title: pl.goal }; },
  });
  assert.equal(done.status, PROPOSAL_STATUS.EXECUTED);
  assert.equal(createdPayload.goal, "修改后的目标", "the EDITED payload must be executed");
});

test("an external action fails honestly instead of faking success", async () => {
  resetStorage();
  const repo = await freshRepo();
  const p = repo.saveProposal({
    kind: ACTION_KINDS.SEND_EMAIL,
    title: "发送报名邮件",
    payload: { to: "someone@example.com" },
  });
  const done = repo.approveProposal(p.id);
  assert.equal(done.status, PROPOSAL_STATUS.FAILED, "we must not fake an external send");
  assert.ok(/未实现外部写入/.test(done.history[done.history.length - 1].note));
});

test("proposals persist across a reload", async () => {
  resetStorage();
  const repo = await freshRepo();
  repo.saveProposal({ kind: ACTION_KINDS.READ_ONLY, title: "只读建议", payload: { a: 1 } });
  const same = await freshRepo(); // new module instance, same storage
  assert.equal(same.listProposals().length, 1);
  assert.equal(same.listProposals()[0].title, "只读建议");
});

test("approve with execute:false stops at APPROVED", async () => {
  resetStorage();
  const repo = await freshRepo();
  const p = repo.saveProposal({ kind: ACTION_KINDS.READ_ONLY, title: "只读" });
  const done = repo.approveProposal(p.id, { execute: false });
  assert.equal(done.status, PROPOSAL_STATUS.APPROVED);
});
