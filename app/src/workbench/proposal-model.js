// Gorgon Workbench — Proposal / Action Model (Phase 6).
//
// This migrates Gorgon's original Human Review idea into the Workbench as a
// FIRST-CLASS, REAL data model — not a demo card. The Phase-1 review cards are
// UI sugar; a Proposal is persisted, versioned and auditable.
//
// Design (§6):
//   * A Skill never performs an external side effect directly. It emits a
//     Proposal describing WHAT it wants done.
//   * Anything with external consequences (send mail, create calendar event,
//     modify a file, external submit) carries requiresReview = true and waits
//     for a human decision.
//   * Read-only capabilities (search / summarize / extract / plan / write)
//     default to requiresReview = false — they change nothing outside the app.
//
// Status machine (mirrors the Task state machine's discipline):
//
//   PROPOSED ─▶ APPROVED ─▶ EXECUTED
//       │           ▲
//       │           └── EDITED
//       ├──▶ REJECTED
//       └──▶ FAILED ◀──┘
//
// PURE module: no localStorage, no React, no network. The repository layer
// persists; this file only defines the shape and the rules.

export const PROPOSAL_STATUS = Object.freeze({
  PROPOSED: "proposed",
  APPROVED: "approved",
  EDITED: "edited",
  REJECTED: "rejected",
  EXECUTED: "executed",
  FAILED: "failed",
});

/** Legal transitions. Anything not listed here is a programming error. */
export const PROPOSAL_TRANSITIONS = Object.freeze({
  proposed: ["approved", "edited", "rejected"],
  // `edited` keeps an explicit route back to approved: a human edit is not
  // itself consent, so the corrected payload still needs a final yes. It may
  // also be rejected outright.
  approved: ["executed", "edited", "failed"],
  edited: ["approved", "rejected", "executed", "failed"],
  rejected: [],
  executed: [],
  failed: [],
});

/**
 * Capability → whether it has external consequences. Read-only capabilities
 * default to false; only the listed side-effecting ones require review.
 */
export const ACTION_KINDS = Object.freeze({
  READ_ONLY: "read_only",
  CREATE_REMINDER: "create_reminder",
  CREATE_CALENDAR: "create_calendar",
  SEND_EMAIL: "send_email",
  WRITE_FILE: "write_file",
  EXTERNAL_SUBMIT: "external_submit",
});

/** Actions that ALWAYS require a human decision before execution. */
export const ALWAYS_REVIEW_ACTIONS = Object.freeze([
  ACTION_KINDS.CREATE_REMINDER,
  ACTION_KINDS.CREATE_CALENDAR,
  ACTION_KINDS.SEND_EMAIL,
  ACTION_KINDS.WRITE_FILE,
  ACTION_KINDS.EXTERNAL_SUBMIT,
]);

export function requiresReview(kind) {
  return ALWAYS_REVIEW_ACTIONS.indexOf(kind) >= 0;
}

export function canProposeTransition(from, to) {
  const allowed = PROPOSAL_TRANSITIONS[from];
  return Array.isArray(allowed) && allowed.indexOf(to) >= 0;
}

let seq = 0;
function fallbackId() {
  seq += 1;
  return `prop_${Date.now().toString(36)}_${seq.toString(36)}`;
}

/**
 * Create a Proposal.
 *
 * @param {object} input
 *   taskId     : string  — originating task (optional for ad-hoc proposals)
 *   kind       : string  — ACTION_KINDS value
 *   title      : string  — short human label
 *   payload    : object  — what the action would do (always kept verbatim)
 *   rationale  : string  — WHY the system is proposing this
 *   sourceSkill: string  — which skill proposed it
 *   createdAt  : string  — ISO timestamp
 */
export function createProposal(input = {}) {
  const kind = input.kind || ACTION_KINDS.READ_ONLY;
  const now = input.createdAt || new Date().toISOString();
  return {
    id: input.id || fallbackId(),
    schemaVersion: 1,
    taskId: input.taskId || null,
    kind,
    // Read-only work is auto-routable; side effects always wait for a human.
    requiresReview: input.requiresReview != null ? Boolean(input.requiresReview) : requiresReview(kind),
    status: PROPOSAL_STATUS.PROPOSED,
    title: typeof input.title === "string" ? input.title : "未命名建议",
    payload: input.payload && typeof input.payload === "object" ? input.payload : {},
    rationale: typeof input.rationale === "string" ? input.rationale : "",
    sourceSkill: input.sourceSkill || null,
    history: [{ status: PROPOSAL_STATUS.PROPOSED, at: now, note: "已生成建议" }],
  };
}

/**
 * Apply a human decision. Returns a NEW proposal object (never mutates).
 * @param {object} proposal
 * @param {string} to      — target status
 * @param {object} opts    { at, note, editedPayload, onExecuted, onRejected }
 */
export function transitionProposal(proposal, to, opts = {}) {
  if (!proposal || typeof proposal !== "object") {
    throw new Error("transitionProposal: proposal required");
  }
  if (!canProposeTransition(proposal.status, to)) {
    throw new Error(
      `transitionProposal: illegal transition ${proposal.status} → ${to}`,
    );
  }

  const at = opts.at || new Date().toISOString();
  const next = {
    ...proposal,
    status: to,
    history: [...(proposal.history || []), { status: to, at, note: opts.note || "" }],
  };

  // EDITED carries the human's corrected payload — that is what executes.
  if (to === PROPOSAL_STATUS.EDITED) {
    next.editedPayload =
      opts.editedPayload && typeof opts.editedPayload === "object"
        ? { ...proposal.payload, ...opts.editedPayload }
        : { ...proposal.payload };
    next.requiresReview = true; // an edit still needs a final human yes
  }

  if (to === PROPOSAL_STATUS.APPROVED && opts.onApproved) opts.onApproved(next);
  if (to === PROPOSAL_STATUS.REJECTED && opts.onRejected) opts.onRejected(next);
  if (to === PROPOSAL_STATUS.EXECUTED && opts.onExecuted) opts.onExecuted(next);

  return next;
}

/** The payload that would actually be executed (edit wins over original). */
export function effectivePayload(proposal) {
  if (!proposal) return null;
  return proposal.editedPayload || proposal.payload;
}

export function isPending(proposal) {
  return Boolean(proposal) && proposal.status === PROPOSAL_STATUS.PROPOSED;
}

export function isTerminal(proposal) {
  if (!proposal) return false;
  return (
    proposal.status === PROPOSAL_STATUS.REJECTED ||
    proposal.status === PROPOSAL_STATUS.EXECUTED ||
    proposal.status === PROPOSAL_STATUS.FAILED
  );
}
