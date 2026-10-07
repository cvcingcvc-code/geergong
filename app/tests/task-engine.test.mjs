// Gorgon Workbench — Phase 2 Task Engine unit tests.
//
// Covers §25: create schema, state machine (legal + illegal), timeline
// auto-recording, persistence round-trip, v1->v2 migration, steps,
// sources, result, corruption safety (§31), and the Phase-3 interface
// chain (§34).

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

// In-memory localStorage stub, installed BEFORE importing the modules.
function makeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    clear: () => m.clear(),
    get size() { return m.size; },
  };
}
globalThis.localStorage = makeStorage();

const M = await import("../src/workbench/task-model.js");
const Repo = await import("../src/store/task-repository.js");

beforeEach(() => { localStorage.clear(); Repo.resetTaskStorage(); });

/* ── §2/§25 createTask schema ────────────────────────────────────────── */

test("createTask produces the full v2 schema", () => {
  const t = M.createTask("帮我整理明天需要完成的工作");
  assert.ok(t);
  assert.equal(typeof t.id, "string");
  assert.ok(t.id.length >= 10, "id must be a real uuid, not an index");
  assert.equal(t.version, 2);
  assert.equal(t.goal, "帮我整理明天需要完成的工作");
  assert.equal(t.title.length <= 25, true, "title auto-derived from goal");
  assert.equal(t.status, "created");
  assert.equal(typeof t.createdAt, "string");
  assert.equal(t.updatedAt, t.createdAt);
  assert.equal(t.startedAt, null);
  assert.equal(t.completedAt, null);
  assert.deepEqual(t.steps, []);
  assert.equal(t.result, null);
  assert.deepEqual(t.sources, []);
  assert.deepEqual(t.metadata, {});
  assert.equal(t.timeline.length, 1);
  assert.equal(t.timeline[0].type, "task_created");
  assert.ok(t.timeline[0].id && t.timeline[0].timestamp);
});

test("createTask rejects empty goals", () => {
  assert.equal(M.createTask(""), null);
  assert.equal(M.createTask("   "), null);
  assert.equal(M.createTask(null), null);
});

test("ids are unique across creations", () => {
  const a = M.createTask("task one");
  const b = M.createTask("task two");
  assert.notEqual(a.id, b.id);
});

/* ── §5/§6 state machine: legal transitions ──────────────────────────── */

test("canTransition accepts the full legal chain", () => {
  assert.equal(M.canTransition("created", "planning"), true);
  assert.equal(M.canTransition("planning", "ready"), true);
  assert.equal(M.canTransition("ready", "running"), true);
  assert.equal(M.canTransition("running", "completed"), true);
  assert.equal(M.canTransition("running", "failed"), true);
  assert.equal(M.canTransition("running", "review_required"), true);
  assert.equal(M.canTransition("review_required", "running"), true);
  assert.equal(M.canTransition("created", "ready"), true, "Phase-2 local shortcut");
});

test("canTransition rejects illegal transitions", () => {
  assert.equal(M.canTransition("completed", "running"), false);
  assert.equal(M.canTransition("failed", "completed"), false);
  assert.equal(M.canTransition("review_required", "completed"), false);
  assert.equal(M.canTransition("completed", "planning"), false);
  assert.equal(M.canTransition("created", "completed"), false);
  assert.equal(M.canTransition("ready", "created"), false);
  assert.equal(M.canTransition("nonsense", "created"), false);
});

test("transitionTaskState is pure: input task is not mutated", () => {
  const t = M.createTask("purity check");
  const before = JSON.stringify(t);
  const t2 = M.transitionTaskState(t, "ready");
  assert.equal(JSON.stringify(t), before, "original untouched");
  assert.equal(t2.status, "ready");
  assert.notEqual(t2, t);
});

test("transitionTaskState throws on illegal transitions", () => {
  const t = M.createTask("illegal move");
  assert.throws(() => M.transitionTaskState(t, "completed"), M.InvalidTransitionError);
  const done = M.transitionTaskState(M.transitionTaskState(t, "ready"), "running");
  const finished = M.transitionTaskState(done, "completed");
  assert.throws(() => M.transitionTaskState(finished, "running"), M.InvalidTransitionError);
  assert.throws(() => M.transitionTaskState(finished, "failed"), M.InvalidTransitionError);
});

test("transitionTaskState sets startedAt / completedAt / failureReason", () => {
  let t = M.createTask("lifecycle fields");
  t = M.transitionTaskState(t, "ready");
  assert.equal(t.startedAt, null);
  t = M.transitionTaskState(t, "running");
  assert.ok(t.startedAt, "startedAt set on running");
  t = M.transitionTaskState(t, "completed");
  assert.ok(t.completedAt, "completedAt set on completed");

  let f = M.createTask("failure fields");
  f = M.transitionTaskState(f, "failed", { failureReason: "网络错误" });
  assert.equal(f.failureReason, "网络错误");
  assert.equal(f.completedAt, null);
});

test("transitionTaskState records task_failed event on failure", () => {
  let t = M.createTask("failure timeline");
  t = M.transitionTaskState(t, "failed", { failureReason: "超时" });
  const types = t.timeline.map((e) => e.type);
  assert.ok(types.includes("task_failed"));
  const last = t.timeline[t.timeline.length - 1];
  assert.equal(last.type, "task_failed");
  assert.ok(last.message.includes("超时"));
});

/* ── §10 timeline auto-recording ─────────────────────────────────────── */

test("status changes auto-append status_changed events", () => {
  let t = M.createTask("timeline check");
  const n0 = t.timeline.length;
  t = M.transitionTaskState(t, "planning");
  assert.equal(t.timeline.length, n0 + 1);
  const ev = t.timeline[t.timeline.length - 1];
  assert.equal(ev.type, "status_changed");
  assert.equal(ev.metadata.from, "created");
  assert.equal(ev.metadata.to, "planning");
  assert.ok(ev.id && ev.timestamp);
});

test("timeline is capped at 500 events keeping the newest (§32)", () => {
  let t = M.createTask("cap check");
  const base = t.timeline.length;
  for (let i = 0; i < 510; i++) {
    // Use direct pushes of valid-shaped events (simulating a long run).
    t = M.transitionTaskState(t, "planning"); // no-op when same? no: planning->planning returns same task
    break;
  }
  // Simpler: exercise pushTimeline through the exported cap constant.
  assert.equal(M.MAX_TIMELINE_EVENTS, 500);
  // Fill via repeated legal ping-pong is impossible; validate the cap logic
  // through repository appendTimelineEvent below instead.
  void base;
});

/* ── §25 persistence: repository round-trip ──────────────────────────── */

test("repository create -> reload -> data consistent", () => {
  Repo.createTaskEntry("round trip goal", { source: "测试" });
  const t = Repo.listTasks()[0];
  assert.equal(t.goal, "round trip goal");
  assert.equal(t.status, "created");
  assert.equal(t.version, 2);
  // raw envelope check
  const raw = JSON.parse(localStorage.getItem("gorgon_workbench_tasks_v2"));
  assert.equal(raw.schemaVersion, 2);
  assert.equal(Array.isArray(raw.tasks), true);
  assert.equal(raw.tasks.length, 1);
  // a fresh repository read (same storage) must see it
  assert.equal(Repo.getTask(t.id).goal, "round trip goal");
});

test("transitionTask persists and records timeline", () => {
  Repo.createTaskEntry("persist transitions");
  const t = Repo.listTasks()[0];
  Repo.transitionTask(t.id, "ready");
  const after = Repo.getTask(t.id);
  assert.equal(after.status, "ready");
  const raw = JSON.parse(localStorage.getItem("gorgon_workbench_tasks_v2"));
  assert.equal(raw.tasks[0].status, "ready");
  assert.ok(raw.tasks[0].timeline.some((e) => e.type === "status_changed"));
});

test("repository transitionTask throws on illegal; tryTransition returns null", () => {
  Repo.createTaskEntry("illegal via repo");
  const t = Repo.listTasks()[0];
  assert.throws(() => Repo.transitionTask(t.id, "completed"), Repo.InvalidTransitionError);
  assert.equal(Repo.tryTransitionTask(t.id, "completed"), null);
  assert.equal(Repo.getTask(t.id).status, "created");
});

test("updateTask cannot smuggle a status change past the state machine", () => {
  Repo.createTaskEntry("no status smuggle");
  const t = Repo.listTasks()[0];
  Repo.updateTask(t.id, { status: "completed" });
  assert.equal(Repo.getTask(t.id).status, "created");
});

test("appendTimelineEvent persists a custom event", () => {
  Repo.createTaskEntry("custom events");
  const t = Repo.listTasks()[0];
  Repo.appendTimelineEvent(t.id, "source_added", "手动备注一条", { custom: true });
  const after = Repo.getTask(t.id);
  const ev = after.timeline[after.timeline.length - 1];
  assert.equal(ev.type, "source_added");
  assert.equal(ev.message, "手动备注一条");
  assert.deepEqual(ev.metadata, { custom: true });
});

test("timeline cap enforced in repository (500 newest kept)", () => {
  Repo.createTaskEntry("cap repo");
  const t = Repo.listTasks()[0];
  for (let i = 0; i < 520; i++) {
    Repo.appendTimelineEvent(t.id, "step_updated", "spam " + i);
  }
  const after = Repo.getTask(t.id);
  assert.equal(after.timeline.length, 500);
  assert.equal(after.timeline[after.timeline.length - 1].message, "spam 519");
});

test("deleteTask removes exactly one task", () => {
  Repo.createTaskEntry("keep me");
  Repo.createTaskEntry("delete me");
  const list = Repo.listTasks();
  assert.equal(list.length, 2);
  Repo.deleteTask(list[0].id);
  const after = Repo.listTasks();
  assert.equal(after.length, 1);
  assert.equal(after[0].goal, "keep me");
});

/* ── §11 steps ───────────────────────────────────────────────────────── */

test("addTaskStep + updateTaskStep round-trip with timeline events", () => {
  Repo.createTaskEntry("steps task");
  const t = Repo.listTasks()[0];
  Repo.addTaskStep(t.id, { title: "收集活动列表" });
  let after = Repo.getTask(t.id);
  assert.equal(after.steps.length, 1);
  assert.equal(after.steps[0].status, "pending");
  assert.ok(after.steps[0].id);
  assert.ok(after.timeline.some((e) => e.type === "step_added"));

  Repo.updateTaskStep(t.id, after.steps[0].id, { status: "completed" });
  after = Repo.getTask(t.id);
  assert.equal(after.steps[0].status, "completed");
  assert.ok(after.timeline.some((e) => e.type === "step_updated"));

  // blank titles are rejected
  const before = after.steps.length;
  Repo.addTaskStep(t.id, { title: "   " });
  assert.equal(Repo.getTask(t.id).steps.length, before);
});

/* ── §12 sources ─────────────────────────────────────────────────────── */

test("addTaskSource accepts valid types, rejects unknown", () => {
  Repo.createTaskEntry("sources task");
  const t = Repo.listTasks()[0];
  Repo.addTaskSource(t.id, { type: "web", title: "活动官网", url: "https://example.com" });
  Repo.addTaskSource(t.id, { type: "user", title: "口头说明" }); // url optional
  Repo.addTaskSource(t.id, { type: "facebook", title: "非法类型" });
  const after = Repo.getTask(t.id);
  assert.equal(after.sources.length, 2);
  assert.equal(after.sources[0].type, "web");
  assert.equal(after.sources[0].url, "https://example.com");
  assert.equal(after.sources[1].url, null);
  assert.ok(after.timeline.some((e) => e.type === "source_added"));
});

/* ── §13 result ──────────────────────────────────────────────────────── */

test("setTaskResult stores text/json and logs result_saved", () => {
  Repo.createTaskEntry("result task");
  const t = Repo.listTasks()[0];
  Repo.setTaskResult(t.id, { type: "text", content: "找到了 3 场活动" });
  Repo.setTaskResult(t.id, { type: "json", content: { ok: true } });
  Repo.setTaskResult(t.id, { type: "ppt", content: "x" }); // illegal type
  const after = Repo.getTask(t.id);
  assert.equal(after.result.type, "json");
  assert.deepEqual(after.result.content, { ok: true });
  assert.ok(after.timeline.some((e) => e.type === "result_saved"));
});

/* ── §8/§30 migration: Phase-1 v1 -> v2 ─────────────────────────────── */

test("migrateV1TasksToV2 maps draft/ready/completed correctly", () => {
  const v1 = [
    { id: "old-1", title: "草稿任务", status: "draft", source: "手动输入", createdAt: "2026-10-01T08:00:00.000Z", updatedAt: "2026-10-01T08:00:00.000Z" },
    { id: "old-2", title: "就绪任务", status: "ready", source: "手动输入", createdAt: "2026-10-01T09:00:00.000Z", updatedAt: "2026-10-01T09:30:00.000Z" },
    { id: "old-3", title: "完成任务", status: "completed", source: "手动输入", createdAt: "2026-10-01T10:00:00.000Z", updatedAt: "2026-10-01T11:00:00.000Z" },
    { title: "无 id 的旧任务", status: "draft" },
  ];
  const out = M.migrateV1TasksToV2(v1);
  assert.equal(out.length, 4, "every valid v1 task survives");
  const [a, b, c, d] = out;
  assert.equal(a.id, "old-1");
  assert.equal(a.status, "created");
  assert.equal(a.goal, "草稿任务");
  assert.equal(a.version, 2);
  assert.ok(a.timeline.some((e) => e.type === "task_created"));
  assert.equal(a.metadata.migratedFrom, "v1");
  assert.equal(b.status, "ready");
  assert.equal(c.status, "completed");
  assert.ok(c.completedAt, "completed task keeps its completion time");
  assert.ok(d.id, "missing id is filled");
  assert.equal(d.status, "created");
});

test("first repository read auto-migrates existing Phase-1 data (§30)", () => {
  // Simulate a Phase-1 browser state.
  localStorage.setItem("gorgon_workbench_tasks", JSON.stringify([
    { id: "legacy-a", title: "Phase 1 的旧任务", status: "ready", source: "手动输入",
      createdAt: "2026-10-01T08:00:00.000Z", updatedAt: "2026-10-01T08:10:00.000Z" },
  ]));
  // No v2 key yet — first read must migrate without losing the task.
  const tasks = Repo.listTasks();
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].id, "legacy-a");
  assert.equal(tasks[0].status, "ready");
  assert.equal(tasks[0].version, 2);
  // v1 key must NOT be destroyed
  assert.ok(localStorage.getItem("gorgon_workbench_tasks"), "v1 key preserved");
  // and the v2 envelope now exists
  const env = JSON.parse(localStorage.getItem("gorgon_workbench_tasks_v2"));
  assert.equal(env.schemaVersion, 2);
  assert.equal(env.tasks.length, 1);
});

test("migration keeps old tasks visible after upgrade — nothing silently vanishes", () => {
  localStorage.setItem("gorgon_workbench_tasks", JSON.stringify([
    { id: "k1", title: "任务一", status: "draft", createdAt: "2026-10-01T08:00:00.000Z", updatedAt: "2026-10-01T08:00:00.000Z" },
    { id: "k2", title: "任务二", status: "completed", createdAt: "2026-10-01T08:00:00.000Z", updatedAt: "2026-10-01T08:00:00.000Z" },
    { id: "k3", title: "任务三", status: "ready", createdAt: "2026-10-01T08:00:00.000Z", updatedAt: "2026-10-01T08:00:00.000Z" },
  ]));
  const tasks = Repo.listTasks();
  assert.equal(tasks.length, 3);
  assert.deepEqual(tasks.map((t) => t.id).sort(), ["k1", "k2", "k3"]);
  assert.equal(tasks.find((t) => t.id === "k2").status, "completed");
  // migrated tasks still flow through the state machine
  Repo.transitionTask("k1", "ready");
  assert.equal(Repo.getTask("k1").status, "ready");
});

/* ── §31 corruption safety ───────────────────────────────────────────── */

test("corrupt v2 JSON degrades to empty store, archives payload, never throws", () => {
  localStorage.setItem("gorgon_workbench_tasks_v2", "{not valid json");
  const tasks = Repo.listTasks();
  assert.deepEqual(tasks, []);
  // payload archived, not destroyed (probed at the deterministic slot 0)
  const archived = localStorage.getItem("gorgon_workbench_tasks_v2.corrupt-0");
  assert.ok(archived && archived.includes("not valid json"), "corrupt payload archived");
});

test("unknown schemaVersion with valid task array is read best-effort", () => {
  localStorage.setItem("gorgon_workbench_tasks_v2", JSON.stringify({
    schemaVersion: 99,
    tasks: [{ id: "future-1", title: "未来任务", goal: "未来任务", status: "created", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" }],
  }));
  const tasks = Repo.listTasks();
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].id, "future-1");
});

test("tasks missing id are dropped safely, not crashing", () => {
  localStorage.setItem("gorgon_workbench_tasks_v2", JSON.stringify({
    schemaVersion: 2,
    tasks: [{ title: "no id", goal: "no id", status: "created" }, { id: "ok-1", title: "有 id", goal: "有 id", status: "created", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" }],
  }));
  const tasks = Repo.listTasks();
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].id, "ok-1");
});

/* ── §34 Phase-3 interface chain ─────────────────────────────────────── */

test("Phase-3 interface: the exact §34 chain works end to end", () => {
  Repo.createTaskEntry("帮我整理明天需要完成的工作");
  const id = Repo.listTasks()[0].id;
  Repo.transitionTask(id, "planning");
  Repo.addTaskStep(id, { title: "第一步" });
  Repo.addTaskSource(id, { type: "user", title: "用户补充" });
  Repo.setTaskResult(id, { type: "text", content: "完成" });
  Repo.transitionTask(id, "ready");
  Repo.transitionTask(id, "running");
  Repo.transitionTask(id, "completed");
  const t = Repo.getTask(id);
  assert.equal(t.status, "completed");
  assert.equal(t.steps.length, 1);
  assert.equal(t.sources.length, 1);
  assert.equal(t.result.content, "完成");
  const types = t.timeline.map((e) => e.type);
  for (const expected of ["task_created", "status_changed", "step_added", "source_added", "result_saved"]) {
    assert.ok(types.includes(expected), `timeline must contain ${expected}`);
  }
  assert.ok(t.completedAt);
});
