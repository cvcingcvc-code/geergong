// Gorgon Workbench — Phase 2 shell tests (store facade + navigation).
//
// UPDATED FOR PHASE 2 (TASK_ENGINE_FOUNDATION): the store facade now
// persists the formal v2 Task schema through task-repository.js and the
// status vocabulary is the formal state machine's (created/.../failed).
// The Phase-1 test intents are preserved 1:1 — same behaviours asserted,
// only the expected vocabulary and field names changed where Phase 2
// formally redefined them. Deeper engine coverage lives in
// tests/task-engine.test.mjs.
//
// Run: node --test tests/workbench-shell.test.mjs   (from app/)

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

// In-memory localStorage stub, installed BEFORE importing the store.
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

const WB = await import("../src/store/workbench-store.js");
const Nav = await import("../src/workbench/navigation.js");

beforeEach(() => { localStorage.clear(); });

/* ── store facade: tasks (formal engine) ─────────────────────────────── */

test("addTask creates a formal v2 task and logs the creation", () => {
  const list = WB.addTask("帮我寻找本周值得参加的 AI 活动");
  assert.equal(list.length, 1);
  assert.equal(list[0].title, "帮我寻找本周值得参加的 AI 活动");
  assert.equal(list[0].goal, "帮我寻找本周值得参加的 AI 活动");
  assert.equal(list[0].status, "created"); // formal vocabulary (was Phase-1 "draft")
  assert.equal(list[0].version, 2);
  assert.ok(list[0].timeline.some((e) => e.type === "task_created"));
  // creation is recorded in the activity log
  const log = WB.getLog();
  assert.ok(log.length >= 1);
  assert.equal(log[0].type, "task_create");
});

test("newest task comes first; whitespace-only titles are rejected", () => {
  WB.addTask("first");
  WB.addTask("second");
  const list = WB.getTasks();
  assert.equal(list[0].goal, "second");
  assert.equal(list.length, 2);
  const before = WB.getTasks().length;
  const after = WB.addTask("   ").length;
  assert.equal(after, before, "blank title must not create a task");
});

test("setTaskStatus transitions through the state machine only", () => {
  const [t] = WB.addTask("整理资料");
  // legal: created -> ready -> running -> completed
  WB.setTaskStatus(t.id, "ready");
  assert.equal(WB.getTasks()[0].status, "ready");
  WB.setTaskStatus(t.id, "running");
  WB.setTaskStatus(t.id, "completed");
  assert.equal(WB.getTasks()[0].status, "completed");
});

test("setTaskStatus ignores unknown AND illegal status values", () => {
  const [t] = WB.addTask("stable task");
  WB.setTaskStatus(t.id, "exploded"); // unknown -> no-op
  assert.equal(WB.getTasks()[0].status, "created");
  WB.setTaskStatus(t.id, "completed"); // illegal (created->completed) -> no-op
  assert.equal(WB.getTasks()[0].status, "created");
});

test("corrupt storage degrades to empty lists, never throws", () => {
  localStorage.setItem(WB.KEYS.tasks, "{not json");
  localStorage.setItem(WB.KEYS.review, "[{broken");
  localStorage.setItem(WB.KEYS.log, "42");
  assert.deepEqual(WB.getTasks(), []);
  assert.deepEqual(WB.getReviewCards(), []);
  assert.deepEqual(WB.getLog(), []);
});

test("tasks survive a store round-trip (persistence)", () => {
  WB.addTask("round trip task");
  // a fresh read from storage must see it with full v2 fields
  const t = WB.getTasks()[0];
  assert.equal(t.goal, "round trip task");
  assert.equal(t.version, 2);
  assert.ok(t.id);
});

test("Phase-1 v1 data is migrated on first read, not lost", () => {
  localStorage.setItem(WB.KEYS.tasksV1, JSON.stringify([
    { id: "old-9", title: "Phase 1 遗留任务", status: "ready",
      createdAt: "2026-10-01T08:00:00.000Z", updatedAt: "2026-10-01T08:10:00.000Z" },
  ]));
  const tasks = WB.getTasks();
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].id, "old-9");
  assert.equal(tasks[0].status, "ready");
  assert.equal(tasks[0].version, 2);
  // original v1 key untouched (never silently destroyed)
  assert.ok(localStorage.getItem(WB.KEYS.tasksV1));
});

/* ── store facade: review cards ──────────────────────────────────────── */

test("ensureReviewSeed seeds exactly one clearly-marked demo card once", () => {
  const first = WB.ensureReviewSeed();
  assert.equal(first.length, 1);
  assert.equal(first[0].decision, "pending");
  assert.ok(first[0].title.includes("建议创建任务"));
  const second = WB.ensureReviewSeed();
  assert.equal(second.length, 1, "seeding must not duplicate");
  assert.equal(second[0].id, first[0].id);
});

test("decideReviewCard flips decision locally; approval is logged", () => {
  const [c] = WB.ensureReviewSeed();
  WB.decideReviewCard(c.id, "approved");
  const cards = WB.getReviewCards();
  assert.equal(cards[0].decision, "approved");
  const log = WB.getLog();
  assert.ok(log.some((e) => e.type === "user_approve"));
});

test("decideReviewCard on unknown id is a safe no-op", () => {
  WB.ensureReviewSeed();
  WB.decideReviewCard("nope", "approved");
  assert.equal(WB.getReviewCards()[0].decision, "pending");
});

/* ── navigation contract ────────────────────────────────────────────── */

test("legacy nav keys are intact: all five data-gg-nav keys present", () => {
  const keys = Nav.LEGACY_TABS.map((t) => t.key);
  for (const k of ["discover", "search", "smart", "weekend", "map"]) {
    assert.ok(keys.includes(k), `legacy key ${k} must exist`);
  }
});

test("workbench nav maps 智能搜索 onto the legacy smart screen", () => {
  assert.equal(Nav.WORKBENCH_TO_LEGACY.search, "smart");
});

test("workbench tabs cover the shell surfaces", () => {
  const keys = Nav.WORKBENCH_TABS.map((t) => t.key);
  assert.deepEqual(keys, ["home", "tasks", "search", "review", "history"]);
  assert.equal(Nav.WORKBENCH_SETTINGS.key, "settings");
});

test("sidebar keeps the legacy capability entries reachable", () => {
  for (const k of Nav.LEGACY_SIDEBAR_KEYS) {
    assert.ok(Nav.LEGACY_BY_KEY_LOCAL || Nav.LEGACY_TABS.some((t) => t.key === k),
      `sidebar key ${k} must map to a legacy tab`);
  }
});

test("mobile tabbar keeps a tab whose label is 搜索 (E2E contract)", () => {
  const searchTab = Nav.MOBILE_TABS.find((t) => t.label === "搜索");
  assert.ok(searchTab, "mobile tabbar must keep a 搜索 tab");
  assert.equal(searchTab.key, "search");
});

test("mobile 更多 drawer exposes the remaining legacy tabs", () => {
  const keys = Nav.MOBILE_MORE_TABS.map((t) => t.key);
  for (const k of ["smart", "weekend", "map"]) {
    assert.ok(keys.includes(k), `more drawer must expose ${k}`);
  }
});

/* ── activity log ───────────────────────────────────────────────────── */

test("log is capped at 100 entries, newest first", () => {
  for (let i = 0; i < 120; i++) WB.logEvent("task_create", "t" + i);
  const log = WB.getLog();
  assert.equal(log.length, 100);
  assert.equal(log[0].text, "t119");
});
