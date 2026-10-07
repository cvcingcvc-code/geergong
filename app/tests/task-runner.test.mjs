// Gorgon Workbench — Phase 3 Task Runner unit tests (§39).
//
// The Runner is dependency-injected, so we drive it with an in-memory mock
// repository (faithful to the real one via task-model) — no localStorage,
// no network, no LLM. We verify the full lifecycle: state transitions, step
// creation, skill ordering, sources/result/timeline writes, and the failure
// path.

import { test } from "node:test";
import assert from "node:assert/strict";

const M = await import("../src/workbench/task-model.js");
const Runner = await import("../src/workbench/task-runner.js");
const { runTask } = Runner;
const Registry = await import("../src/workbench/skills/registry.js");
const realRouter = (await import("../src/workbench/task-router.js")).routeTask;
const { MAX_SKILLS_PER_TASK } = await import("../src/workbench/task-router.js");

const TS = "2026-10-08T00:00:00.000Z";

// ── In-memory repository faithful to the real API surface ──────────────────
class MockRepository {
  constructor() { this.tasks = new Map(); }
  seed(task) { this.tasks.set(task.id, task); return task; }
  getTask(id) { return this.tasks.get(id) || null; }
  listTasks() { return [...this.tasks.values()]; }
  transitionTask(id, status, opts = {}) {
    const cur = this.getTask(id);
    if (!cur) throw new Error("missing:" + id);
    const next = M.transitionTaskState(cur, status, opts);
    this.tasks.set(id, next);
    return next;
  }
  addTaskStep(id, input) {
    const cur = this.getTask(id);
    const step = M.makeStep(typeof input === "string" ? input : input.title,
      input && typeof input === "object" ? input : {});
    const next = {
      ...cur,
      steps: [...cur.steps, step],
      updatedAt: TS,
      timeline: [...cur.timeline, M.makeTimelineEvent("step_added", `添加步骤「${step.title}」`, { stepId: step.id })],
    };
    this.tasks.set(id, next);
    return next;
  }
  updateTaskStep(id, stepId, patch) {
    const cur = this.getTask(id);
    const steps = cur.steps.map((s) => (s.id === stepId ? { ...s, ...patch, updatedAt: TS } : s));
    const next = { ...cur, steps, updatedAt: TS };
    this.tasks.set(id, next);
    return next;
  }
  setTaskResult(id, resultInput) {
    const result = M.makeResult(resultInput);
    const cur = this.getTask(id);
    const next = {
      ...cur, result,
      timeline: [...cur.timeline, M.makeTimelineEvent("result_saved", "保存任务结果", { type: result && result.type })],
    };
    this.tasks.set(id, next);
    return next;
  }
  addTaskSource(id, sourceInput) {
    const source = M.makeSource(sourceInput);
    const cur = this.getTask(id);
    const next = {
      ...cur, sources: [...cur.sources, source],
      timeline: [...cur.timeline, M.makeTimelineEvent("source_added", `添加来源「${source.title}」`, { sourceId: source.id, type: source.type })],
    };
    this.tasks.set(id, next);
    return next;
  }
  appendTimelineEvent(id, type, message, metadata) {
    const cur = this.getTask(id);
    const next = { ...cur, timeline: [...cur.timeline, M.makeTimelineEvent(type, message || "", metadata || {})] };
    this.tasks.set(id, next);
    return next;
  }
  updateTask(id, patch) {
    const cur = this.getTask(id);
    const next = { ...cur, ...patch, id: cur.id, status: cur.status, updatedAt: TS };
    this.tasks.set(id, next);
    return next;
  }
}

function seedCreated(goal) {
  const repo = new MockRepository();
  repo.seed(M.createTask(goal));
  return repo;
}

/* ── Happy path: search + plan workflow (§41) ─────────────────────────── */

test("runner: created → planning → ready → running → completed (search+plan)", async () => {
  const repo = seedCreated("帮我找上海的 AI 活动并制定参加计划");
  const id = repo.listTasks()[0].id;
  let routerCalls = 0;
  const spyRouter = (input) => { routerCalls += 1; return realRouter(input); };
  const mockSearch = async () => ({
    kind: "ok",
    data: { results: [{ activity: { title: "A", sourceUrl: "https://a.com" } }, { activity: { title: "B", sourceUrl: "https://b.com" } }] },
  });

  const res = await runTask(id, { repository: repo, router: spyRouter, registry: Registry, search: mockSearch, now: () => TS });

  assert.equal(res.ok, true);
  assert.equal(res.executed, true);
  assert.equal(routerCalls, 1, "router runs exactly once (§48)");

  const t = repo.getTask(id);
  assert.equal(t.status, "completed");
  assert.equal(t.steps.length, 2);
  assert.deepEqual(t.steps.map((s) => s.metadata.skillId), ["search", "plan"]);
  assert.equal(t.steps[0].status, "completed");
  assert.equal(t.steps[1].status, "completed");
  assert.equal(t.sources.length, 2, "search sources written");
  assert.equal(t.result.type, "workflow_result", "multi-skill → workflow_result envelope (§22)");
  assert.equal(t.result.content.length, 2);

  const types = t.timeline.map((e) => e.type);
  for (const ev of ["routing_started", "routing_completed", "skill_started", "skill_completed", "task_execution_completed"]) {
    assert.ok(types.includes(ev), `timeline missing ${ev}`);
  }
  assert.ok(t.metadata.router && Array.isArray(t.metadata.router.skillIds));
});

/* ── Single-skill result shape (§22) ───────────────────────────────────── */

test("runner: single skill writes its own result directly", async () => {
  const repo = seedCreated("帮我提取日期：10月12日截止 https://x.com");
  const id = repo.listTasks()[0].id;
  const res = await runTask(id, { repository: repo, registry: Registry, now: () => TS });
  assert.equal(res.ok, true);
  const t = repo.getTask(id);
  assert.equal(t.status, "completed");
  assert.equal(t.steps.length, 1);
  assert.equal(t.steps[0].metadata.skillId, "extract");
  assert.equal(t.result.type, "json");
  assert.ok(t.result.content.dates.includes("10月12日"));
});

/* ── Unknown intent stays ready, no run (§8) ───────────────────────────── */

test("runner: unknown intent leaves task ready without steps", async () => {
  const repo = seedCreated("今天心情不错"); // no router keyword
  const id = repo.listTasks()[0].id;
  const res = await runTask(id, { repository: repo, registry: Registry, now: () => TS });
  assert.equal(res.ok, true);
  assert.equal(res.executed, false);
  assert.equal(res.routed.intent, "unknown");
  const t = repo.getTask(id);
  assert.equal(t.status, "ready");
  assert.equal(t.steps.length, 0);
});

/* ── Failure path (§39) ────────────────────────────────────────────────── */

test("runner: skill throw → step failed → task failed + failureReason", async () => {
  const repo = seedCreated("帮我找活动");
  const id = repo.listTasks()[0].id;
  const throwingRegistry = {
    getSkill: (sid) => ({
      id: sid, name: "X",
      execute: async () => { throw new Error("boom"); },
    }),
  };
  const res = await runTask(id, { repository: repo, registry: throwingRegistry, now: () => TS });
  assert.equal(res.ok, true);
  assert.equal(res.failed, true);
  const t = repo.getTask(id);
  assert.equal(t.status, "failed");
  assert.equal(t.failureReason, "boom");
  assert.equal(t.steps[0].status, "failed");
  assert.ok(t.timeline.map((e) => e.type).includes("skill_failed"));
});

test("runner: skill returns ok:false → task failed", async () => {
  const repo = seedCreated("帮我找活动");
  const id = repo.listTasks()[0].id;
  let called = false;
  const failingRegistry = {
    getSkill: (sid) => ({
      id: sid, name: "X",
      execute: async () => { called = true; return { ok: false, skillId: sid, error: { code: "SEARCH_OFFLINE", message: "离线" } }; },
    }),
  };
  const res = await runTask(id, { repository: repo, registry: failingRegistry, now: () => TS });
  assert.equal(called, true);
  const t = repo.getTask(id);
  assert.equal(t.status, "failed");
  assert.equal(t.failureReason, "离线");
});

/* ── Concurrency guard (§49) ───────────────────────────────────────────── */

test("runner: refuses a task already running", async () => {
  const repo = new MockRepository();
  let running = M.createTask("x");
  running = M.transitionTaskState(running, "planning");
  running = M.transitionTaskState(running, "ready");
  running = M.transitionTaskState(running, "running");
  repo.seed(running);
  const id = repo.listTasks()[0].id;
  const res = await runTask(id, { repository: repo, registry: Registry, now: () => TS });
  assert.equal(res.ok, false);
  assert.equal(res.code, "TASK_ALREADY_RUNNING");
});

test("runner: refuses a completed task", async () => {
  const repo = new MockRepository();
  let task = M.createTask("done");
  task = M.transitionTaskState(task, "ready");
  task = M.transitionTaskState(task, "running");
  task = M.transitionTaskState(task, "completed");
  repo.seed(task);
  const id = repo.listTasks()[0].id;
  const res = await runTask(id, { repository: repo, registry: Registry, now: () => TS });
  assert.equal(res.ok, false);
  assert.equal(res.code, "TASK_NOT_RUNNABLE");
});

/* ── Manual selection (§27) ────────────────────────────────────────────── */

test("runner: manual skill selection runs from ready state", async () => {
  const repo = new MockRepository();
  let task = M.createTask("提取这段内容：10月12日截止 https://x.com");
  task = M.transitionTaskState(task, "ready");
  repo.seed(task);
  const id = repo.listTasks()[0].id;
  const res = await runTask(id, { repository: repo, registry: Registry, skillIds: ["extract"], now: () => TS });
  assert.equal(res.ok, true);
  const t = repo.getTask(id);
  assert.equal(t.status, "completed");
  assert.equal(t.steps.length, 1);
  assert.equal(t.steps[0].metadata.skillId, "extract");
  assert.equal(t.result.type, "json");
  assert.ok(t.result.content.dates.includes("10月12日"));
  assert.equal(t.metadata.router.intent, "manual");
});

test("runner: manual selection is clipped to MAX_SKILLS_PER_TASK", async () => {
  const repo = new MockRepository();
  let task = M.createTask("空白目标");
  task = M.transitionTaskState(task, "ready");
  repo.seed(task);
  const id = repo.listTasks()[0].id;
  const res = await runTask(id, {
    repository: repo, registry: Registry,
    skillIds: ["search", "extract", "summarize", "plan", "write"], now: () => TS,
  });
  assert.equal(res.ok, true);
  const t = repo.getTask(id);
  assert.equal(t.steps.length, MAX_SKILLS_PER_TASK, "manual selection clipped to the cap (§48)");
});
