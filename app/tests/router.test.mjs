// Gorgon Workbench — Phase 3 Task Router unit tests (§37).
//
// The router is a PURE, deterministic function: same input → same output,
// every time. These tests pin that contract and the keyword rules (§6).

import { test } from "node:test";
import assert from "node:assert/strict";

const R = await import("../src/workbench/task-router.js");
const { routeTask, validateSkillIds, MAX_SKILLS_PER_TASK } = R;

test("router routes a search intent", () => {
  const r = routeTask({ goal: "帮我找上海本周免费的 AI 活动" });
  assert.equal(r.intent, "search");
  assert.deepEqual(r.skillIds, ["search"]);
  assert.ok(r.confidence > 0);
  assert.ok(r.reasons.length >= 1);
});

test("router routes a summarize intent", () => {
  const r = routeTask({ goal: "帮我总结一下这次会议纪要" });
  assert.equal(r.intent, "summarize");
  assert.deepEqual(r.skillIds, ["summarize"]);
});

test("router routes an extract intent", () => {
  const r = routeTask({ goal: "提取这段内容里的日期和链接" });
  assert.equal(r.intent, "extract");
  assert.deepEqual(r.skillIds, ["extract"]);
});

test("router routes a plan intent", () => {
  const r = routeTask({ goal: "帮我规划一下参赛的步骤" });
  assert.equal(r.intent, "plan");
  assert.deepEqual(r.skillIds, ["plan"]);
});

test("router routes a write intent", () => {
  const r = routeTask({ goal: "帮我写一封邀请邮件" });
  assert.equal(r.intent, "write");
  assert.deepEqual(r.skillIds, ["write"]);
});

test("router unions search + plan into a workflow", () => {
  const r = routeTask({ goal: "帮我找上海的 AI 活动并制定参加计划" });
  assert.equal(r.intent, "workflow");
  assert.deepEqual(r.skillIds, ["search", "plan"]);
  assert.ok(r.reasons.some((x) => x.includes("找") || x.includes("计划")));
});

test("router unions extract + summarize", () => {
  const r = routeTask({ goal: "提取里面的日期，并总结要点" });
  assert.deepEqual(r.skillIds, ["extract", "summarize"]);
});

test("router returns unknown + empty for unrecognized goals", () => {
  const r = routeTask({ goal: "今天天气真不错" });
  assert.equal(r.intent, "unknown");
  assert.deepEqual(r.skillIds, []);
  assert.equal(r.confidence, 0);
});

test("router caps skills at MAX_SKILLS_PER_TASK (§7/§48)", () => {
  const goal = "帮我找活动，提取日期，总结要点，规划步骤，写邮件";
  const r = routeTask({ goal });
  assert.equal(r.skillIds.length, MAX_SKILLS_PER_TASK);
  // priority order keeps search/extract/plan; reasons note the cap
  assert.deepEqual(r.skillIds, ["search", "extract", "plan"]);
  assert.ok(r.reasons.some((x) => x.includes(String(MAX_SKILLS_PER_TASK)) || x.includes("上限")));
});

test("router output order is stable (RULES order, not insertion)", () => {
  const goal = "规划步骤并找活动"; // plan keyword first, search second
  const r = routeTask({ goal });
  // canonical RULES order is search before plan
  assert.deepEqual(r.skillIds, ["search", "plan"]);
});

test("router is reproducible: identical input → identical output", () => {
  const goal = "帮我找活动并制定参加计划";
  const a = routeTask({ goal });
  const b = routeTask({ goal });
  assert.deepEqual(a, b);
});

test("validateSkillIds drops unknown ids and keeps known ones", () => {
  const out = validateSkillIds(["search", "bogus", "plan", 123]);
  assert.deepEqual(out, ["search", "plan"]);
});
