// Phase 4B Gate — the REAL competition demo chain (search + plan) executed
// through the real Runner and the real deterministic Skills, asserting the
// demo-critical invariants: AI_CALLS = 0, search runs exactly once, plan
// consumes the search result, and sources carry their DEMO flag.
import { runTask } from "../src/workbench/task-runner.js";
import { routeTask } from "../src/workbench/task-router.js";
import { shouldUseAI } from "../src/workbench/ai/eligibility.js";
import { createTask } from "../src/workbench/task-model.js";
import { createAIClient } from "../src/workbench/ai/index.js";

function memRepo() {
  const tasks = new Map();
  return {
    getTask: (id) => tasks.get(id) || null,
    createTask: (t) => { tasks.set(t.id, t); return t; },
    updateTask: (id, patch) => tasks.set(id, { ...tasks.get(id), ...patch }),
    transitionTask: (id, status, o = {}) => {
      const t = tasks.get(id);
      t.timeline = [...(t.timeline || []), { type: `to_${status}`, at: o.at }];
      t.status = status;
      if (o.failureReason) t.failureReason = o.failureReason;
      return t;
    },
    addTaskStep: (id, s) => { const t = tasks.get(id); t.steps = [...(t.steps || []), s]; return s; },
    updateTaskStep: (id, sid, patch) => {
      const t = tasks.get(id);
      t.steps = t.steps.map((s) => (s.id === sid ? { ...s, ...patch } : s));
    },
    setTaskResult: (id, r) => { tasks.get(id).result = r; },
    addTaskSource: (id, s) => { const t = tasks.get(id); t.sources = [...(t.sources || []), s]; },
    appendTimelineEvent: (id, type, message, meta) => {
      const t = tasks.get(id);
      t.timeline = [...(t.timeline || []), { type, message, at: meta?.at, meta }];
    },
  };
}


import { test } from "node:test";
import assert from "node:assert/strict";

const DEMO_GOAL =
  "帮我找上海未来一周值得参加的 AI/创业活动，优先免费、适合认识开发者，并帮我制定参加计划。";

const SEARCH_ONLY_GOAL = "帮我找上海未来一周值得参加的 AI/创业活动";

function demoSearch() {
  return async () => ({
    kind: "ok",
    data: {
      providerMode: "demo",
      results: [
        { activity: { title: "上海 AI 开发者 Meetup", sourceUrl: "https://example.com/a", source: "demo" }, dataOrigin: "demo" },
        { activity: { title: "上海创业开放日", sourceUrl: "https://example.com/b", source: "demo" }, dataOrigin: "demo" },
      ],
    },
  });
}

async function runDemo(goal) {
  const repo = memRepo();
  const t = createTask(goal);
  repo.createTask(t);
  let aiCalls = 0;
  const counting = createAIClient({ provider: "mock" });
  const orig = counting.generate;
  counting.generate = async (r) => { aiCalls++; return orig(r); };
  // Mirror real app usage: no aiClient is injected, so nothing can call a model.
  void counting;
  await runTask(t.id, { repository: repo, search: demoSearch() });
  return { task: repo.getTask(t.id), aiCalls };
}

test("gate: the demo goal routes to search + plan and search is denied AI", () => {
  const route = routeTask({ goal: DEMO_GOAL });
  assert.deepEqual(route.skillIds, ["search", "plan"]);
  const g = shouldUseAI({ skill: "search", purpose: "generate", input: DEMO_GOAL });
  assert.equal(g.eligible, false);
  assert.equal(g.reason, "SKILL_FORBIDDEN");
});

test("gate: a search-only goal routes to search alone and still calls no AI", async () => {
  const route = routeTask({ goal: SEARCH_ONLY_GOAL });
  assert.deepEqual(route.skillIds, ["search"]);
  const { task, aiCalls } = await runDemo(SEARCH_ONLY_GOAL);
  assert.equal(task.status, "completed");
  assert.equal(aiCalls, 0, "a plain search must make zero model calls");
});

test("gate: the full demo chain completes with AI_CALLS = 0", async () => {
  // No aiClient is passed, mirroring how the app actually runs: every skill
  // stays deterministic and no model is reachable.
  const { task, aiCalls } = await runDemo(DEMO_GOAL);
  assert.equal(task.status, "completed");
  assert.equal(aiCalls, 0, "Case A/B: search+plan demo must not call a model");
  assert.deepEqual(task.steps.map((s) => s.metadata.skillId), ["search", "plan"]);
  assert.deepEqual(task.steps.map((s) => s.status), ["completed", "completed"]);
});

test("gate: even WITH a client injected, the demo plan keeps its real content", async () => {
  // Regression guard: a mock/placeholder provider must never overwrite good
  // deterministic output with canned filler.
  const repo = memRepo();
  const t = createTask(DEMO_GOAL);
  repo.createTask(t);
  await runTask(t.id, {
    repository: repo,
    search: demoSearch(),
    aiClient: createAIClient({ provider: "mock" }),
  });
  const done = repo.getTask(t.id);
  assert.equal(done.status, "completed");
  const plan = done.result.content.find((x) => x.skillId === "plan");
  assert.equal(plan.result.content.length, 4, "the tailored 4-step plan must survive");
  assert.ok(/核对活动时间/.test(plan.result.content[1]), "must not be replaced by mock filler");
});

test("gate: search executes exactly once and its results are recorded as sources", async () => {
  const { task } = await runDemo(DEMO_GOAL);
  const searchDone = task.timeline.filter(
    (e) => e.type === "skill_completed" && /智能搜索/.test(e.message || ""),
  );
  assert.equal(searchDone.length, 1, "search must not run twice");
  assert.equal(task.sources.length, 2);
  assert.deepEqual(task.sources.map((s) => s.title), ["上海 AI 开发者 Meetup", "上海创业开放日"]);
});

test("gate: DEMO sources are flagged so the UI never passes them off as live", async () => {
  const { task } = await runDemo(DEMO_GOAL);
  assert.deepEqual(task.sources.map((s) => s.demo), [true, true]);
});

test("gate: plan consumes the search result instead of re-searching", async () => {
  const { task } = await runDemo(DEMO_GOAL);
  const plan = task.result.content.find((x) => x.skillId === "plan");
  assert.ok(plan, "plan result must exist");
  const steps = plan.result.content;
  assert.equal(steps.length, 4);
  assert.ok(/排名靠前的 2 个候选/.test(steps[0]), "plan must be tailored to the 2 search hits");
});

test("gate: the demo run produces a full timeline", async () => {
  const { task } = await runDemo(DEMO_GOAL);
  const types = task.timeline.map((e) => e.type);
  for (const t of ["routing_started", "routing_completed", "skill_started", "skill_completed", "task_execution_completed"]) {
    assert.ok(types.includes(t), `timeline must include ${t}`);
  }
});
