// Gorgon Workbench — Phase 2 formal Task Model + State Machine + Timeline.
//
// PURE MODULE: no DOM, no React, no API calls, no localStorage access.
// Persistence lives in task-repository.js. This keeps §6: the state
// machine is a pure function layer that Phase 3 Router / Skills can reuse
// unchanged, and it is unit-testable in plain Node (§25).
//
// Contents:
//   * TASK_STATUS / STEP_STATUS — the formal Phase-2 vocabularies (§3/§11)
//   * TRANSITIONS — the legal transition table (§5)
//   * canTransition(from, to) — pure predicate
//   * transitionTaskState(task, to, opts) — pure task->task
//   * createTask(goal, opts) — factory for the §2 schema
//   * makeTimelineEvent / makeStep / makeSource / makeResult — factories
//   * migrateV1TasksToV2 — Phase-1 (draft/ready/completed) -> v2 schema (§8)
//   * MAX_TIMELINE_EVENTS — §32 data boundary (cap, keep newest)

import { randomUUID } from "./uuid.js";

// ── §3 formal statuses ────────────────────────────────────────────────
export const TASK_STATUS = {
  CREATED: "created",
  PLANNING: "planning",
  READY: "ready",
  RUNNING: "running",
  REVIEW_REQUIRED: "review_required",
  COMPLETED: "completed",
  FAILED: "failed",
};

export const ALL_TASK_STATUSES = [
  "created", "planning", "ready", "running", "review_required", "completed", "failed",
];

export const STEP_STATUS = {
  PENDING: "pending",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
};

// ── §9 timeline event types (stable vocabulary) ───────────────────────
// Phase-2 vocabulary (immutable — never rename these):
export const TIMELINE_EVENT_TYPES = [
  "task_created", "status_changed", "step_added", "step_updated",
  "source_added", "result_saved", "task_failed",
];

// Phase-3 execution-event vocabulary (§23). Appended by the Task Runner in
// addition to the Phase-2 set; old types are preserved untouched.
export const EXECUTION_EVENT_TYPES = [
  "routing_started", "routing_completed",
  "skill_started", "skill_completed", "skill_failed",
  "task_execution_completed",
];

// ── §5 legal transition table ─────────────────────────────────────────
// created -> planning | ready (Phase-2 local shortcut) | failed | cancelled is NOT enabled (unused)
export const TRANSITIONS = {
  created:         ["planning", "ready", "failed"],
  planning:        ["ready", "failed"],
  ready:           ["running", "failed"],
  running:         ["completed", "failed", "review_required"],
  review_required: ["running"],
  completed:       [],
  failed:          [],
};

export function canTransition(from, to) {
  const allowed = TRANSITIONS[from];
  return Array.isArray(allowed) && allowed.indexOf(to) >= 0;
}

export class InvalidTransitionError extends Error {
  constructor(from, to) {
    super(`Illegal task transition: ${from} -> ${to}`);
    this.name = "InvalidTransitionError";
    this.from = from;
    this.to = to;
  }
}

const nowIso = () => new Date().toISOString();

// ── §9 timeline event factory ─────────────────────────────────────────
export function makeTimelineEvent(type, message, metadata, timestamp) {
  return {
    id: randomUUID(),
    type,
    timestamp: timestamp || nowIso(),
    message: typeof message === "string" ? message : "",
    metadata: metadata && typeof metadata === "object" ? metadata : {},
  };
}

/** §32: cap a timeline at MAX_TIMELINE_EVENTS, keeping the NEWEST entries. */
export const MAX_TIMELINE_EVENTS = 500;

function pushTimeline(timeline, event) {
  const next = timeline.concat([event]);
  return next.length > MAX_TIMELINE_EVENTS ? next.slice(next.length - MAX_TIMELINE_EVENTS) : next;
}

// ── §2 createTask — the formal schema factory ─────────────────────────
// Phase 2 titles are auto-truncated from the goal (§16).
export function makeTitleFromGoal(goal) {
  const g = String(goal || "").replace(/\s+/g, " ").trim();
  if (!g) return "";
  return g.length > 24 ? g.slice(0, 24) + "…" : g;
}

export function createTask(goal, opts = {}) {
  const g = String(goal || "").trim();
  if (!g) return null;
  const ts = opts.now || nowIso();
  const task = {
    id: opts.id || randomUUID(),
    version: 2,

    title: opts.title || makeTitleFromGoal(g),
    goal: g,

    status: TASK_STATUS.CREATED,

    createdAt: ts,
    updatedAt: ts,
    startedAt: null,
    completedAt: null,

    steps: [],
    result: null,

    sources: [],

    metadata: opts.metadata && typeof opts.metadata === "object" ? Object.assign({}, opts.metadata) : {},

    timeline: [],
    failureReason: null,
    // Phase-1 compat field kept visible to old UI paths; new code reads status.
    legacyStatus: null,
  };
  task.timeline = pushTimeline(
    task.timeline,
    makeTimelineEvent("task_created", `创建任务「${task.title}」`, { source: opts.source || "手动输入" }, ts),
  );
  return task;
}

// ── §4/§5/§10 transition — pure task -> task ──────────────────────────
// Returns a NEW task object (never mutates). Throws on illegal transitions
// so callers cannot silently corrupt state. Also auto-records the
// status_changed timeline event and startedAt / completedAt / failureReason.
export function transitionTaskState(task, to, opts = {}) {
  if (!task || typeof task !== "object") throw new InvalidTransitionError("?", String(to));
  const from = task.status;
  if (from === to) return task; // no-op transition, not an error
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, String(to));
  const ts = opts.at || nowIso();
  const next = Object.assign({}, task, {
    status: to,
    updatedAt: ts,
    timeline: task.timeline ? task.timeline.slice() : [],
  });
  const meta = Object.assign({ from, to }, opts.metadata || {});
  next.timeline = pushTimeline(next.timeline, makeTimelineEvent(
    "status_changed", `状态：${from} → ${to}`, meta, ts,
  ));
  if (to === TASK_STATUS.RUNNING && !next.startedAt) next.startedAt = ts;
  if (to === TASK_STATUS.COMPLETED) next.completedAt = ts;
  if (to === TASK_STATUS.FAILED) {
    next.failureReason = opts.failureReason || "未知原因";
    next.timeline = pushTimeline(next.timeline, makeTimelineEvent(
      "task_failed", `任务失败：${next.failureReason}`, { reason: next.failureReason }, ts,
    ));
  }
  return next;
}

// ── §11 steps ─────────────────────────────────────────────────────────
export function makeStep(title, opts = {}) {
  const t = String(title || "").trim();
  if (!t) return null;
  const ts = opts.now || nowIso();
  return {
    id: opts.id || randomUUID(),
    title: t,
    status: STEP_STATUS.PENDING,
    createdAt: ts,
    updatedAt: ts,
    // Phase 3: links a step to the Skill that produces it (§20). Optional.
    metadata: opts.metadata && typeof opts.metadata === "object" ? Object.assign({}, opts.metadata) : {},
    result: null,
  };
}

export function makeSource(input, opts = {}) {
  if (!input || typeof input !== "object") return null;
  const TYPES = ["web", "local", "search", "user", "system"];
  const type = TYPES.indexOf(input.type) >= 0 ? input.type : null;
  if (!type) return null;
  const title = String(input.title || "").trim();
  if (!title) return null;
  return {
    id: opts.id || randomUUID(),
    type,
    title,
    url: typeof input.url === "string" && input.url ? input.url : null,
    provider: typeof input.provider === "string" && input.provider ? input.provider : null,
    addedAt: opts.now || nowIso(),
  };
}

// ── §13 result ────────────────────────────────────────────────────────
export function makeResult(input) {
  if (!input || typeof input !== "object") return null;
  // "workflow_result" is the Phase-3 multi-skill aggregation envelope (§22).
  const TYPES = ["text", "json", "search_results", "plan", "workflow_result"];
  if (TYPES.indexOf(input.type) < 0) return null;
  if (input.content == null) return null;
  return {
    type: input.type,
    content: input.content,
    createdAt: input.createdAt || nowIso(),
  };
}

// ── §8 migration: Phase-1 v1 store -> v2 schema ───────────────────────
// v1 task: { id, title, status(draft|ready|completed), source, createdAt, updatedAt }
// draft -> created; ready -> ready; completed -> completed. Everything
// else defaults to created. Missing fields are filled in; nothing is lost.
export function migrateV1TasksToV2(v1List) {
  if (!Array.isArray(v1List)) return [];
  return v1List.map((t) => {
    if (!t || typeof t !== "object" || !t.title) return null;
    // Already v2 (has goal + version >= 2): normalize only.
    if (typeof t.goal === "string" && t.goal && t.version >= 2) return normalizeTask(t);
    const goal = String(t.goal || t.title).trim();
    const created = createTask(goal, {
      id: typeof t.id === "string" && t.id ? t.id : undefined,
      title: t.title,
      now: typeof t.createdAt === "string" ? t.createdAt : undefined,
      source: typeof t.source === "string" ? t.source : "迁移自 Phase 1",
      metadata: { migratedFrom: "v1", v1Status: t.status || null },
    });
    // Map the v1 status onto the v2 vocabulary via legal transitions where
    // possible (draft->created is already the initial state; ready needs a
    // legal path created->ready; completed keeps its label but there is no
    // legal created->completed path, so we restore it post-normalization).
    let mapped = created;
    if (t.status === "ready") {
      mapped = transitionTaskState(mapped, TASK_STATUS.READY, { at: t.updatedAt || undefined });
    } else if (t.status === "completed") {
      // v1 completed == "user marked it done by hand". Restore directly and
      // record it as an explicit migrated status event.
      mapped.status = TASK_STATUS.COMPLETED;
      mapped.completedAt = t.updatedAt || mapped.createdAt;
      mapped.timeline = pushTimeline(mapped.timeline, makeTimelineEvent(
        "status_changed", "状态：created → completed（迁移自 Phase 1）",
        { from: "created", to: "completed", migrated: true }, t.updatedAt || undefined,
      ));
    }
    return normalizeTask(mapped);
  }).filter(Boolean);
}

// ── normalization (defensive reads; §31/§30 safety) ───────────────────
export function normalizeTask(t) {
  if (!t || typeof t !== "object") return null;
  if (typeof t.id !== "string" || !t.id) return null;
  const goal = typeof t.goal === "string" && t.goal ? t.goal : String(t.title || "").trim();
  if (!goal && !t.title) return null;
  const base = createTask(goal || t.title, { id: t.id, title: t.title || undefined, now: t.createdAt });
  const status = ALL_TASK_STATUSES.indexOf(t.status) >= 0 ? t.status : TASK_STATUS.CREATED;
  const merged = Object.assign({}, base, t, {
    id: t.id,
    version: 2,
    goal,
    title: typeof t.title === "string" && t.title ? t.title : base.title,
    status,
    createdAt: typeof t.createdAt === "string" ? t.createdAt : base.createdAt,
    updatedAt: typeof t.updatedAt === "string" ? t.updatedAt : base.createdAt,
    startedAt: typeof t.startedAt === "string" ? t.startedAt : null,
    completedAt: typeof t.completedAt === "string" ? t.completedAt : null,
    steps: Array.isArray(t.steps) ? t.steps.map(normalizeStep).filter(Boolean) : [],
    result: t.result && typeof t.result === "object" ? (makeResult(t.result) || null) : null,
    sources: Array.isArray(t.sources) ? t.sources.map((s) => makeSource(s) || s).filter(Boolean) : [],
    metadata: t.metadata && typeof t.metadata === "object" ? t.metadata : {},
    timeline: Array.isArray(t.timeline) ? t.timeline.filter(evValid) : [],
    failureReason: t.failureReason == null ? null : String(t.failureReason),
  });
  return merged;
}

function evValid(e) {
  return e && typeof e === "object" && typeof e.type === "string" && typeof e.id === "string";
}

function normalizeStep(s) {
  if (!s || typeof s !== "object") return null;
  if (typeof s.title !== "string" || !s.title.trim()) return null;
  return {
    id: typeof s.id === "string" && s.id ? s.id : randomUUID(),
    title: s.title.trim(),
    status: Object.values(STEP_STATUS).indexOf(s.status) >= 0 ? s.status : STEP_STATUS.PENDING,
    createdAt: typeof s.createdAt === "string" ? s.createdAt : nowIso(),
    updatedAt: typeof s.updatedAt === "string" ? s.updatedAt : nowIso(),
    metadata: s.metadata && typeof s.metadata === "object" ? s.metadata : {},
    result: s.result == null ? null : s.result,
  };
}
