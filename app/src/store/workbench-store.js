// Gorgon Workbench — store facade (PHASE 2: unified Task Engine).
//
// PHASE 2 UPGRADE (TASK_ENGINE_FOUNDATION):
//   * Task persistence + mutation now lives in task-repository.js on the
//     versioned v2 schema ("gorgon_workbench_tasks_v2", envelope with
//     schemaVersion: 2). The Phase-1 flat demo store is GONE as a write
//     target; Phase-1 data under "gorgon_workbench_tasks" is migrated once
//     via migrateV1TasksToV2() and the original key is never destroyed.
//   * Status changes MUST go through the formal State Machine
//     (task-model.js TRANSITIONS) — arbitrary status writes are rejected.
//   * Review cards + the flat activity log remain local UI surfaces, as in
//     Phase 1. History now merges Task timelines with this log.
//   * Still NO backend, NO AI, NO LLM. Deliberately separate from the
//     legacy GorgonStore (store.js) contract.

import * as Repo from "./task-repository.js";
import { TASK_STATUS, canTransition, InvalidTransitionError } from "../workbench/task-model.js";

const K_TASKS_V2 = Repo.SCHEMA_VERSION ? "gorgon_workbench_tasks_v2" : "gorgon_workbench_tasks_v2";
const K_V1_TASKS = "gorgon_workbench_tasks";
const K_REVIEW = "gorgon_workbench_review";
const K_LOG = "gorgon_workbench_log";

export const KEYS = { tasks: K_TASKS_V2, tasksV1: K_V1_TASKS, review: K_REVIEW, log: K_LOG };

// Formal Phase-2 vocabulary. NOTE: the Phase-1 "draft" label is retired —
// migrated tasks surface as "created" (see migrateV1TasksToV2).
export { TASK_STATUS, canTransition, InvalidTransitionError };

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

// ---- Tasks (formal engine via repository) ----------------------------

/** All tasks, v2 schema. First read auto-migrates Phase-1 data (§30). */
export function getTasks() {
  return Repo.listTasks();
}

export function getTask(id) {
  return Repo.getTask(id);
}

/**
 * Create a task. The user text is the GOAL; the title is auto-derived from
 * it (§16). Kept for Phase-1 call sites — returns the stored list.
 */
export function addTask(goal, { source = "手动输入" } = {}) {
  const text = String(goal || "").trim();
  if (!text) return Repo.listTasks();
  const next = Repo.createTaskEntry(text, { source });
  logEvent("task_create", `创建任务「${next[0] ? next[0].title : text}」`);
  return next;
}

/**
 * Status changes through the State Machine ONLY. Illegal / unknown target
 * statuses are a safe no-op (returns current list unchanged).
 */
export function setTaskStatus(id, status) {
  const before = Repo.getTask(id);
  const next = Repo.tryTransitionTask(id, status);
  if (!next) return Repo.listTasks(); // illegal or missing — no-op
  const t = Repo.getTask(id);
  logEvent("task_status", `「${t ? t.title : id}」→ ${status}`);
  void before;
  return next;
}

export function transitionTask(id, status, opts = {}) {
  const next = Repo.transitionTask(id, status, opts); // throws on illegal
  const t = Repo.getTask(id);
  logEvent("task_status", `「${t ? t.title : id}」→ ${status}`);
  return next;
}

export function tryTransitionTask(id, status, opts = {}) {
  return Repo.tryTransitionTask(id, status, opts);
}

export function deleteTask(id) {
  return Repo.deleteTask(id);
}

export function addTaskStep(id, stepInput) {
  return Repo.addTaskStep(id, stepInput);
}

export function updateTaskStep(taskId, stepId, patch) {
  return Repo.updateTaskStep(taskId, stepId, patch);
}

export function setTaskResult(id, result) {
  return Repo.setTaskResult(id, result);
}

export function addTaskSource(id, source) {
  return Repo.addTaskSource(id, source);
}

export function getStorageHealth() {
  return Repo.getStorageHealth();
}

export function getSchemaVersion() {
  return Repo.SCHEMA_VERSION;
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

// ---- Activity log (flat list, kept for cross-surface events) ----------

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
    localStorage.removeItem(K_TASKS_V2);
    localStorage.removeItem(K_REVIEW);
    localStorage.removeItem(K_LOG);
    // NOTE: the Phase-1 v1 key ("gorgon_workbench_tasks") is intentionally
    // NOT removed here — §31: never silently destroy old data.
  } catch (e) { /* ignore */ }
}
