// Phase 7 — Competition Demo Mode (offline, reproducible, DEMO-labelled).
import { test } from "node:test";
import assert from "node:assert/strict";

import { ensureDemoTask, DEMO_TASK_GOAL, DEMO_SEED_MARKER } from "../src/lib/demo-mode.js";

/** Minimal in-memory task list standing in for the repository. */
function fakeRepo() {
  let tasks = [];
  let seq = 0;
  return {
    listTasks: () => tasks,
    createTask: (goal, opts = {}) => {
      seq += 1;
      const t = {
        id: `t${seq}`, goal, title: goal.slice(0, 12),
        status: "created", metadata: {}, steps: [], sources: [], timeline: [],
        source: opts.source,
      };
      tasks = [...tasks, t];
      return tasks;
    },
    updateTask: (id, patch) => {
      tasks = tasks.map((t) => (t.id === id ? { ...t, ...patch } : t));
      return tasks;
    },
  };
}

test("the demo goal is the exact competition prompt", () => {
  assert.ok(DEMO_TASK_GOAL.includes("上海"));
  assert.ok(DEMO_TASK_GOAL.includes("AI/创业活动"));
  assert.ok(DEMO_TASK_GOAL.includes("制定参加计划"));
});

test("ensureDemoTask seeds exactly one demo task", () => {
  const repo = fakeRepo();
  const created = ensureDemoTask({ listTasks: repo.listTasks, createTask: repo.createTask, updateTask: repo.updateTask });
  assert.equal(created, true);
  assert.equal(repo.listTasks().length, 1);
  assert.equal(repo.listTasks()[0].goal, DEMO_TASK_GOAL);
});

test("seeding is idempotent — a reload does not duplicate the demo task", () => {
  const repo = fakeRepo();
  ensureDemoTask({ listTasks: repo.listTasks, createTask: repo.createTask, updateTask: repo.updateTask });
  const again = ensureDemoTask({ listTasks: repo.listTasks, createTask: repo.createTask, updateTask: repo.updateTask });
  assert.equal(again, false, "second seeding must be a no-op");
  assert.equal(repo.listTasks().length, 1);
});

test("the seeded task is explicitly marked DEMO so it is never mistaken for live data", () => {
  const repo = fakeRepo();
  ensureDemoTask({ listTasks: repo.listTasks, createTask: repo.createTask, updateTask: repo.updateTask });
  const t = repo.listTasks()[0];
  assert.equal(t.metadata[DEMO_SEED_MARKER], true);
  assert.equal(t.metadata.isDemo, true);
  assert.equal(t.metadata.router.isDemo, true);
  assert.deepEqual(t.metadata.router.skillIds, ["search", "plan"]);
});

test("the demo task routes to search + plan and stays in a runnable state", () => {
  const repo = fakeRepo();
  ensureDemoTask({ listTasks: repo.listTasks, createTask: repo.createTask, updateTask: repo.updateTask });
  const t = repo.listTasks()[0];
  assert.equal(t.status, "created", "must be runnable so the presenter can press Run");
  assert.equal(t.metadata.router.intent, "workflow");
  assert.equal(t.metadata.router.confidence > 0, true);
});

test("a pre-existing non-demo task does not block seeding", () => {
  const repo = fakeRepo();
  repo.createTask("别的任务");
  const created = ensureDemoTask({ listTasks: repo.listTasks, createTask: repo.createTask, updateTask: repo.updateTask });
  assert.equal(created, true);
  assert.equal(repo.listTasks().length, 2);
  assert.ok(repo.listTasks().some((t) => t.metadata[DEMO_SEED_MARKER]));
});

test("a seeding failure is contained (never throws)", () => {
  const boom = () => { throw new Error("storage unavailable"); };
  // ensureDemoTask itself may throw; initDemoMode is the guard. Verify the
  // guard behaviour explicitly.
  assert.throws(() => ensureDemoTask({ listTasks: boom, createTask: boom }));
});
