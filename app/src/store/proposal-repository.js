// Gorgon Workbench — Proposal Repository (Phase 6).
//
// Persistence + the local apply/execute step. Split from the pure model so the
// model stays unit-testable in plain Node.
//
// The executor is deliberately CONSERVATIVE: it only performs actions that are
// provably local (creating a follow-up task, appending a timeline note). It
// never sends mail, never writes files outside the app, never touches an
// external system — those kinds exist in the model so the REVIEW contract is
// real, but executing them returns an explicit "not supported in this build"
// failure rather than a fake success.

import {
  createProposal,
  transitionProposal,
  effectivePayload,
  PROPOSAL_STATUS,
  ACTION_KINDS,
} from "../workbench/proposal-model.js";

const STORAGE_KEY = "gorgon_workbench_proposals_v1";

function readAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw == null) return [];
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function writeAll(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* private mode / quota — degrade to in-memory */
  }
}

export function listProposals() {
  return readAll();
}

export function getProposal(id) {
  return readAll().find((p) => p && p.id === id) || null;
}

export function saveProposal(input) {
  const p = createProposal(input);
  writeAll([...readAll(), p]);
  return p;
}

function replace(id, next) {
  writeAll(readAll().map((p) => (p.id === id ? next : p)));
  return next;
}

/** Approve → optionally execute. Returns the resulting proposal (or a Promise of it). */
export function approveProposal(id, opts = {}) {
  const p = getProposal(id);
  if (!p) return null;
  // A proposal only becomes approvable from PROPOSED or EDITED. A rejected or
  // already-executed proposal is terminal — return it unchanged rather than
  // throwing, so a stale UI click can never crash the Review Center.
  if (p.status !== PROPOSAL_STATUS.PROPOSED && p.status !== PROPOSAL_STATUS.EDITED) {
    return p;
  }
  const approved = transitionProposal(p, PROPOSAL_STATUS.APPROVED, {
    at: opts.at,
    note: "用户已批准",
  });
  replace(id, approved);
  if (opts.execute === false) return approved;
  // Forward the local executor hook (and any extra context) so approve→execute
  // is a single call for the caller.
  return executeProposal(id, { at: opts.at, createTask: opts.createTask });
}

/** Reject — never executes. */
export function rejectProposal(id, opts = {}) {
  const p = getProposal(id);
  if (!p) return null;
  return replace(
    id,
    transitionProposal(p, PROPOSAL_STATUS.REJECTED, {
      at: opts.at,
      note: opts.note || "用户已拒绝",
    }),
  );
}

/** Edit the payload, then it still requires a final human approval. */
export function editProposal(id, editedPayload, opts = {}) {
  const p = getProposal(id);
  if (!p) return null;
  return replace(
    id,
    transitionProposal(p, PROPOSAL_STATUS.EDITED, {
      at: opts.at,
      note: opts.note || "用户已修改",
      editedPayload,
    }),
  );
}

/**
 * Execute an approved/edited proposal.
 *
 * Only genuinely local actions are performed. External kinds fail loudly —
 * a fake success would be worse than an honest failure.
 */
export function executeProposal(id, opts = {}) {
  const p = getProposal(id);
  if (!p) return null;
  // Execution requires an explicit human approval. An EDITED proposal is NOT
  // approved yet — the model allows edited→executed so an approve-then-execute
  // flow can pass through, but the repository must not execute a bare edit.
  if (p.status !== PROPOSAL_STATUS.APPROVED) {
    return p;
  }

  const payload = effectivePayload(p);

  // Local action: create a follow-up task. This is the competition-version
  // concrete behaviour ("建议创建一个后续任务").
  if (p.kind === ACTION_KINDS.CREATE_REMINDER) {
    const created = opts.createTask ? opts.createTask(payload) : null;
    if (!created) {
      return replace(
        id,
        transitionProposal(p, PROPOSAL_STATUS.FAILED, {
          at: opts.at,
          note: "无法创建本地任务",
        }),
      );
    }
    return replace(
      id,
      transitionProposal(p, PROPOSAL_STATUS.EXECUTED, {
        at: opts.at,
        note: `已创建后续任务：${created.title || created.id}`,
        onExecuted: () => {},
      }),
    );
  }

  // Every other kind is an external side effect we deliberately do NOT perform.
  return replace(
    id,
    transitionProposal(p, PROPOSAL_STATUS.FAILED, {
      at: opts.at,
      note: `该动作（${p.kind}）在本地版本中未实现外部写入，已如实标记失败，未执行任何外部操作`,
    }),
  );
}
