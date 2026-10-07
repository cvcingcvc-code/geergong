// Gorgon Workbench — Phase 1 shell tests.
//
// Behaviour-first: asserts what the store and the navigation mapping DO,
// not that files or strings exist. The React screens are covered by the
// E2E shell (tests/e2e_workbench_shell.mjs); this file covers the local
// state layer and the nav contract in plain Node.
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

/* ── workbench store: tasks ─────────────────────────────────────────── */

test("addTask persists a draft task and logs the creation", () => {
  const list = WB.addTask("帮我寻找本周值得参加的 AI 活动");
  assert.equal(list.length, 1);
  assert.equal(list[0].title, "帮我寻找本周值得参加的 AI 活动");
  assert.equal(list[0].status, "draft");
  assert.equal(list[0].source, "手动输入");
  // creation is recorded in the activity log
  const log = WB.getLog();
  assert.ok(log.length >= 1);
  assert.equal(log[0].type, "task_create");
});

test("newest task comes first; whitespace-only titles are rejected", () => {
  WB.addTask("first");
  WB.addTask("second");
  const list = WB.getTasks();
  assert.equal(list[0].title, "second");
  assert.equal(list.length, 2);
  const before = WB.getTasks().length;
  const after = WB.addTask("   ").length;
  assert.equal(after, before, "blank title must not create a task");
});

test("setTaskStatus transitions draft -> ready -> completed", () => {
  const [t] = WB.addTask("整理资料");
  WB.setTaskStatus(t.id, WB.TASK_STATUS.READY);
  assert.equal(WB.getTasks()[0].status, "ready");
  WB.setTaskStatus(t.id, WB.TASK_STATUS.COMPLETED);
  assert.equal(WB.getTasks()[0].status, "completed");
});

test("setTaskStatus ignores unknown status values", () => {
  const [t] = WB.addTask("stable task");
  WB.setTaskStatus(t.id, "exploded");
  assert.equal(WB.getTasks()[0].status, "draft");
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
  WB.addTask("round trip task", { source: "任务页输入" });
  // a fresh read from storage must see it
  assert.equal(WB.getTasks()[0].title, "round trip task");
  assert.equal(WB.getTasks()[0].source, "任务页输入");
});

/* ── workbench store: review cards ──────────────────────────────────── */

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

test("workbench tabs cover the Phase-1 shell surfaces", () => {
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
