// Gorgon Workbench — Competition Demo Mode (Phase 7).
//
// `?demo=1` turns on a REPRODUCIBLE, OFFLINE demo:
//   * a fixed competition task is seeded (once) so the screen is never empty
//   * the reset chip (demo-reset.js) is still mounted alongside it
//
// Honesty rules:
//   * Everything seeded is marked DEMO. Nothing pretends to be live data.
//   * Seeding is idempotent — reloading does not pile up duplicates.
//   * The demo does not require a network: the search step falls back to the
//     bundled demo dataset via the existing API layer's demo mode.

import * as Repo from "../store/task-repository.js";
import { TASK_STATUS } from "../workbench/task-model.js";

export const DEMO_FLAG = "demo=1";
export const DEMO_TASK_GOAL =
  "帮我找上海未来一周值得参加的 AI/创业活动，优先免费、适合认识开发者，并帮我制定参加计划。";
export const DEMO_SEED_MARKER = "demo_seed_v1";

export function isDemoMode() {
  try {
    return /[?&]demo=1\b/.test(window.location.search);
  } catch {
    return false;
  }
}

/**
 * Seed the competition demo task exactly once.
 * All three repository calls are injectable so this is unit-testable without
 * localStorage (a partially-injected repo would silently write the DEMO marker
 * to the wrong place).
 * @returns {boolean} true if a seed was created, false if it already existed
 */
export function ensureDemoTask(deps = {}) {
  const listTasks = deps.listTasks || Repo.listTasks;
  const createTask = deps.createTask || ((goal, opts) => Repo.createTaskEntry(goal, opts));
  const updateTask = deps.updateTask || Repo.updateTask;

  const existing = listTasks() || [];
  const already = existing.some(
    (t) => t && t.metadata && t.metadata[DEMO_SEED_MARKER],
  );
  if (already) return false;

  const list = createTask(DEMO_TASK_GOAL, { source: "DEMO 演示" });
  const created = Array.isArray(list) ? list.find((t) => t.goal === DEMO_TASK_GOAL) : null;
  if (created) {
    // Mark it so the DEMO badge shows and re-seeding is idempotent.
    updateTask(created.id, {
      metadata: Object.assign({}, created.metadata, {
        [DEMO_SEED_MARKER]: true,
        isDemo: true,
        router: {
          intent: "workflow",
          skillIds: ["search", "plan"],
          confidence: 0.86,
          reasons: ["检测到「找、活动」→ search", "检测到「计划」→ plan"],
          isDemo: true,
        },
      }),
      status: TASK_STATUS.CREATED,
    });
  }
  return true;
}

/** Boot demo mode if the flag is present. Safe to call unconditionally. */
export function initDemoMode() {
  if (!isDemoMode()) return false;
  try {
    ensureDemoTask();
    return true;
  } catch {
    // A seeding failure must never white-screen the app.
    return false;
  }
}
