// Gorgon Workbench — Phase 1 local store.
//
// PHASE 1 SCOPE (WORKBENCH_SHELL):
//   * local, browser-only persistence for the Workbench shell surfaces
//     (tasks, review cards, activity log). NO backend, NO task engine,
//     NO AI. The formal Task Model / State Machine is Phase 2 work.
//   * Deliberately SEPARATE from the legacy GorgonStore (store.js): the
//     weekend/favorites/district keys and their semantics are a tested
//     compatibility contract and must not be touched. This module owns its
//     own "gorgon_workbench_*" key namespace and its own reset.
//
// Every write is best-effort like store.js: private mode / quota errors
// degrade to in-memory for the session, never throw.

const K_TASKS = "gorgon_workbench_tasks";
const K_REVIEW = "gorgon_workbench_review";
const K_LOG = "gorgon_workbench_log";

export const KEYS = { tasks: K_TASKS, review: K_REVIEW, log: K_LOG };

// ---- Task status (Phase 1 UI vocabulary — NOT the final state machine) --
// draft    : captured from an input, never started
// ready    : explicitly staged for the (future) engine
// completed: user marked it done by hand
export const TASK_STATUS = { DRAFT: "draft", READY: "ready", COMPLETED: "completed" };

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    const v = JSON.parse(raw);
    return v == null ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    /* private mode / quota — degrade to in-memory */
  }
}

const nowIso = () => new Date().toISOString();

// ---- Tasks -----------------------------------------------------------

function sanitizeTask(t) {
  if (!t || typeof t !== "object") return null;
  const title = typeof t.title === "string" ? t.title.trim() : "";
  if (!title) return null;
  const status = Object.values(TASK_STATUS).includes(t.status) ? t.status : TASK_STATUS.DRAFT;
  return {
    id: typeof t.id === "string" && t.id ? t.id : "wb-" + Math.random().toString(36).slice(2, 10),
    title,
    status,
    source: typeof t.source === "string" && t.source ? t.source : "手动输入",
    createdAt: typeof t.createdAt === "string" ? t.createdAt : nowIso(),
    updatedAt: typeof t.updatedAt === "string" ? t.updatedAt : nowIso(),
  };
}

export function getTasks() {
  const v = read(K_TASKS, []);
  if (!Array.isArray(v)) return [];
  return v.map(sanitizeTask).filter(Boolean);
}

export function setTasks(list) {
  if (!Array.isArray(list)) return;
  write(K_TASKS, list.map(sanitizeTask).filter(Boolean));
}

/** Create a task from the home input. Returns the stored list. */
export function addTask(title, { source = "手动输入", status = TASK_STATUS.DRAFT } = {}) {
  const t = sanitizeTask({ title, status, source });
  if (!t) return getTasks();
  const next = [t].concat(getTasks());
  setTasks(next);
  logEvent("task_create", `创建任务「${t.title}」`);
  return next;
}

/** Update one task's status. Returns the stored list. */
export function setTaskStatus(id, status) {
  if (!Object.values(TASK_STATUS).includes(status)) return getTasks();
  const next = getTasks().map((t) =>
    t.id === id ? Object.assign({}, t, { status, updatedAt: nowIso() }) : t
  );
  setTasks(next);
  return next;
}

// ---- Review cards (DEMO / PREVIEW — local UI state only) --------------

function sanitizeReview(c) {
  if (!c || typeof c !== "object") return null;
  const title = typeof c.title === "string" ? c.title.trim() : "";
  if (!title) return null;
  return {
    id: typeof c.id === "string" && c.id ? c.id : "rv-" + Math.random().toString(36).slice(2, 10),
    title,
    detail: typeof c.detail === "string" ? c.detail : "",
    // pending | approved | rejected — LOCAL UI STATE ONLY. The real Human
    // Review protocol migrates in Phase 6.
    decision: ["pending", "approved", "rejected", "edited"].includes(c.decision) ? c.decision : "pending",
    createdAt: typeof c.createdAt === "string" ? c.createdAt : nowIso(),
  };
}

export function getReviewCards() {
  const v = read(K_REVIEW, []);
  if (!Array.isArray(v)) return [];
  return v.map(sanitizeReview).filter(Boolean);
}

export function setReviewCards(list) {
  if (!Array.isArray(list)) return;
  write(K_REVIEW, list.map(sanitizeReview).filter(Boolean));
}

/** First-run seed: one clearly-marked demo card so the shell has content. */
export function ensureReviewSeed() {
  const cur = getReviewCards();
  if (cur.length > 0) return cur;
  const seeded = [{
    id: "rv-demo-1",
    title: "建议创建任务：准备 Hackathon 报名材料",
    detail: "这是一张 DEMO / PREVIEW 演示卡片，用于展示审核中心的工作方式。未来 AI 或自动化操作在真正执行前会先进入这里等待确认。",
    decision: "pending",
    createdAt: nowIso(),
  }];
  setReviewCards(seeded);
  return seeded;
}

export function decideReviewCard(id, decision) {
  const next = getReviewCards().map((c) =>
    c.id === id ? Object.assign({}, c, { decision }) : c
  );
  setReviewCards(next);
  if (decision === "approved") logEvent("user_approve", "批准了一项待审核操作");
  if (decision === "rejected") logEvent("user_reject", "拒绝了一项待审核操作");
  return next;
}

// ---- Activity log (flat list, NO event sourcing) -----------------------

export function getLog() {
  const v = read(K_LOG, []);
  return Array.isArray(v) ? v.filter((e) => e && typeof e === "object" && e.type) : [];
}

export function logEvent(type, text) {
  const entry = { type, text: String(text || ""), at: nowIso() };
  const next = [entry].concat(getLog()).slice(0, 100); // newest first, cap 100
  write(K_LOG, next);
  return next;
}

// ---- Reset ------------------------------------------------------------

export function reset() {
  try {
    localStorage.removeItem(K_TASKS);
    localStorage.removeItem(K_REVIEW);
    localStorage.removeItem(K_LOG);
  } catch (e) { /* ignore */ }
}
