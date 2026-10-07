// Gorgon Workbench — Phase 2 formal Task Repository.
//
// The SINGLE persistence + mutation layer for Workbench tasks. React
// screens never touch localStorage JSON directly (§7) — they go through
// this module (or the compat re-exports in workbench-store.js).
//
// Storage layout (§8) — versioned envelope:
//   localStorage["gorgon_workbench_tasks_v2"] = {
//     "schemaVersion": 2,
//     "tasks": [ ...v2 task objects... ]
//   }
//
// Migration (§8/§30): the Phase-1 flat array under
// "gorgon_workbench_tasks" is imported once, mapped through
// migrateV1TasksToV2(), and the v1 key is left UNTOUCHED (never silently
// destroyed; we simply stop reading it for writes).
//
// Corruption safety (§31): invalid JSON / unknown schemaVersion / missing
// ids degrade to an empty in-session store with a console warning. We
// never auto-clear the raw payload — the broken key is preserved under
// "<key>.corrupt-<n>" for manual recovery.

import {
  TASK_STATUS, canTransition, InvalidTransitionError,
  createTask, transitionTaskState, makeTimelineEvent, makeStep, makeSource, makeResult,
  normalizeTask, migrateV1TasksToV2, MAX_TIMELINE_EVENTS,
} from "../workbench/task-model.js";
import { randomUUID } from "../workbench/uuid.js";

const K_V2 = "gorgon_workbench_tasks_v2";
const K_V1 = "gorgon_workbench_tasks"; // Phase-1 key — read once for migration, never written

export const SCHEMA_VERSION = 2;

const nowIso = () => new Date().toISOString();

function readRaw(key) {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    return null;
  }
}

function writeRaw(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    // private mode / quota — degrade to in-memory for the session
    return false;
  }
}

// In-memory fallback mirror (private mode / quota / corruption).
let memoryTasks = null;
let warnedCorrupt = false;

function warnOnce(msg) {
  if (warnedCorrupt) return;
  warnedCorrupt = true;
  // eslint-disable-next-line no-console
  console.warn("[task-repository] " + msg);
}

/** Archive a broken payload instead of destroying it (§31). */
function quarantine(key, raw, why) {
  try {
    let slot = 0;
    let archiveKey = `${key}.corrupt-${slot}`;
    while (localStorage.getItem(archiveKey) != null) {
      slot += 1;
      archiveKey = `${key}.corrupt-${slot}`;
    }
    localStorage.setItem(archiveKey, String(raw));
    warnOnce(`storage for "${key}" was unreadable (${why}); payload archived at "${archiveKey}"; starting empty. NOT auto-cleared.`);
  } catch {
    warnOnce(`storage for "${key}" was unreadable (${why}); could not archive; starting empty.`);
  }
}

/** Load the task envelope: v2 if valid, else migrate v1, else safe-empty. */
function loadEnvelope() {
  if (memoryTasks) return { schemaVersion: SCHEMA_VERSION, tasks: memoryTasks };

  const rawV2 = readRaw(K_V2);
  if (rawV2 != null) {
    let parsed = null;
    try {
      parsed = JSON.parse(rawV2);
    } catch (e) {
      quarantine(K_V2, rawV2, "invalid JSON");
      parsed = null;
    }
    if (parsed && typeof parsed === "object") {
      if (parsed.schemaVersion === SCHEMA_VERSION && Array.isArray(parsed.tasks)) {
        const tasks = parsed.tasks.map(normalizeTask).filter(Boolean);
        return { schemaVersion: SCHEMA_VERSION, tasks };
      }
      // Unknown future version: keep data readable if shape matches, else empty.
      if (Array.isArray(parsed.tasks)) {
        warnOnce(`unknown schemaVersion ${JSON.stringify(parsed.schemaVersion)}; attempting best-effort read.`);
        const tasks = parsed.tasks.map(normalizeTask).filter(Boolean);
        return { schemaVersion: SCHEMA_VERSION, tasks };
      }
      quarantine(K_V2, rawV2, "unknown envelope shape");
    }
    // parsed == null (JSON broke) or shape unusable -> fall through to empty,
    // but do NOT clear the payload; it is already archived above.
  }

  // Phase-1 data present? Migrate it once (§8/§30).
  const rawV1 = readRaw(K_V1);
  if (rawV1 != null) {
    let v1 = null;
    try {
      v1 = JSON.parse(rawV1);
    } catch (e) {
      quarantine(K_V1, rawV1, "invalid JSON");
    }
    if (Array.isArray(v1) && v1.length > 0) {
      const migrated = migrateV1TasksToV2(v1);
      const env = { schemaVersion: SCHEMA_VERSION, tasks: migrated };
      writeRaw(K_V2, env); // persist the migrated envelope immediately
      return env;
    }
    if (Array.isArray(v1) && v1.length === 0) {
      // Empty v1 array: nothing to migrate; still write the v2 envelope.
      const env = { schemaVersion: SCHEMA_VERSION, tasks: [] };
      writeRaw(K_V2, env);
      return env;
    }
  }

  return { schemaVersion: SCHEMA_VERSION, tasks: [] };
}

function persist(tasks) {
  memoryTasks = null;
  const env = { schemaVersion: SCHEMA_VERSION, tasks };
  const ok = writeRaw(K_V2, env);
  if (!ok) memoryTasks = tasks; // in-memory fallback for this session
  return env;
}

/** §31: a readable status for diagnostics surfaces (Settings). */
export function getStorageHealth() {
  const raw = readRaw(K_V2);
  if (raw == null) return { state: "empty" };
  try {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.schemaVersion === SCHEMA_VERSION && Array.isArray(parsed.tasks)) {
      return { state: "ok", count: parsed.tasks.length };
    }
    return { state: "unknown_schema", version: parsed ? parsed.schemaVersion : null };
  } catch {
    return { state: "corrupt" };
  }
}

// ── Repository API (§7) ───────────────────────────────────────────────

export function listTasks() {
  return loadEnvelope().tasks;
}

export function getTask(id) {
  return listTasks().find((t) => t.id === id) || null;
}

export function createTaskEntry(goal, opts = {}) {
  const task = createTask(goal, opts);
  if (!task) return listTasks();
  const next = [task].concat(loadEnvelope().tasks);
  persist(next);
  return next;
}

export function updateTask(id, patch, { eventType, eventMessage, eventMetadata } = {}) {
  const tasks = listTasks();
  const idx = tasks.findIndex((t) => t.id === id);
  if (idx < 0) return tasks;
  const cur = tasks[idx];
  const merged = Object.assign({}, cur, patch && typeof patch === "object" ? patch : {}, {
    id: cur.id,
    status: cur.status, // status changes MUST go through transitionTask()
    updatedAt: nowIso(),
  });
  if (eventType) {
    merged.timeline = (merged.timeline || []).concat([
      makeTimelineEvent(eventType, eventMessage || "", eventMetadata),
    ]).slice(-MAX_TIMELINE_EVENTS);
  }
  const next = tasks.slice();
  next[idx] = normalizeTask(merged) || cur;
  persist(next);
  return next;
}

/** The ONLY legal path for status changes (§5/§7). Throws on illegal moves. */
export function transitionTask(id, nextStatus, opts = {}) {
  const tasks = listTasks();
  const idx = tasks.findIndex((t) => t.id === id);
  if (idx < 0) throw new InvalidTransitionError("(missing)", String(nextStatus));
  const updated = transitionTaskState(tasks[idx], nextStatus, opts);
  const next = tasks.slice();
  next[idx] = updated;
  persist(next);
  return next;
}

/** Non-throwing variant for UI convenience; returns the new list or null. */
export function tryTransitionTask(id, nextStatus, opts = {}) {
  try {
    return transitionTask(id, nextStatus, opts);
  } catch (e) {
    if (e instanceof InvalidTransitionError) return null;
    throw e;
  }
}

export function deleteTask(id) {
  const tasks = listTasks();
  const next = tasks.filter((t) => t.id !== id);
  if (next.length === tasks.length) return tasks;
  persist(next);
  return next;
}

export function appendTimelineEvent(id, type, message, metadata) {
  return updateTask(id, {}, { eventType: type, eventMessage: message, eventMetadata: metadata });
}

export function addTaskStep(id, stepInput, opts = {}) {
  const step = makeStep(typeof stepInput === "string" ? stepInput : stepInput && stepInput.title, stepInput && typeof stepInput === "object" ? stepInput : {});
  if (!step) return listTasks();
  const tasks = listTasks();
  const idx = tasks.findIndex((t) => t.id === id);
  if (idx < 0) return tasks;
  const cur = tasks[idx];
  const nextTask = Object.assign({}, cur, {
    steps: cur.steps.concat([step]),
    updatedAt: nowIso(),
    timeline: cur.timeline.concat([
      makeTimelineEvent("step_added", `添加步骤「${step.title}」`, { stepId: step.id }, opts.at),
    ]).slice(-MAX_TIMELINE_EVENTS),
  });
  const next = tasks.slice();
  next[idx] = nextTask;
  persist(next);
  return next;
}

export function updateTaskStep(taskId, stepId, patch, opts = {}) {
  const tasks = listTasks();
  const idx = tasks.findIndex((t) => t.id === taskId);
  if (idx < 0) return tasks;
  const cur = tasks[idx];
  let changed = null;
  const steps = cur.steps.map((s) => {
    if (s.id !== stepId) return s;
    changed = Object.assign({}, s, patch && typeof patch === "object" ? patch : {}, {
      id: s.id,
      createdAt: s.createdAt,
      updatedAt: nowIso(),
    });
    return changed;
  });
  if (!changed) return tasks;
  const nextTask = Object.assign({}, cur, {
    steps,
    updatedAt: nowIso(),
    timeline: cur.timeline.concat([
      makeTimelineEvent("step_updated", `更新步骤「${changed.title}」`, { stepId, patch: Object.keys(patch || {}) }, opts.at),
    ]).slice(-MAX_TIMELINE_EVENTS),
  });
  const next = tasks.slice();
  next[idx] = nextTask;
  persist(next);
  return next;
}

export function setTaskResult(id, resultInput) {
  const result = makeResult(resultInput);
  if (!result) return listTasks();
  return updateTask(id, { result }, {
    eventType: "result_saved",
    eventMessage: "保存任务结果",
    eventMetadata: { type: result.type },
  });
}

export function addTaskSource(id, sourceInput) {
  const source = makeSource(sourceInput);
  if (!source) return listTasks();
  const tasks = listTasks();
  const idx = tasks.findIndex((t) => t.id === id);
  if (idx < 0) return tasks;
  const cur = tasks[idx];
  const nextTask = Object.assign({}, cur, {
    sources: cur.sources.concat([source]),
    updatedAt: nowIso(),
    timeline: cur.timeline.concat([
      makeTimelineEvent("source_added", `添加来源「${source.title}」`, { sourceId: source.id, type: source.type }),
    ]).slice(-MAX_TIMELINE_EVENTS),
  });
  const next = tasks.slice();
  next[idx] = nextTask;
  persist(next);
  return next;
}

/** §31: never auto-clear. Exposed for explicit user-driven reset flows. */
export function resetTaskStorage() {
  try {
    localStorage.removeItem(K_V2);
  } catch { /* ignore */ }
  memoryTasks = null;
}

export { TASK_STATUS, canTransition, InvalidTransitionError };
