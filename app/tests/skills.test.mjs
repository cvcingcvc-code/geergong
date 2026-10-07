// Gorgon Workbench — Phase 3 Skills unit tests (§38).
//
// Each skill is deterministic and self-contained. The search skill REUSES the
// injected `search` fn (the real API client in the browser); tests inject a
// mock so no network / localStorage / LLM is touched.

import { test } from "node:test";
import assert from "node:assert/strict";

const searchSkill = (await import("../src/workbench/skills/search-skill.js")).default;
const extractSkill = (await import("../src/workbench/skills/extract-skill.js")).default;
const { summarizeSkill, localSummarize } = await import("../src/workbench/skills/summarize-skill.js");
const { planSkill, buildPlan } = await import("../src/workbench/skills/plan-skill.js");
const writeSkill = (await import("../src/workbench/skills/write-skill.js")).default;

/* ── Search Skill ──────────────────────────────────────────────────────── */

test("search: API mock success normalizes sources", async () => {
  const search = async () => ({
    kind: "ok",
    data: {
      results: [
        { activity: { title: "AI Meetup", sourceUrl: "https://x.com/1", source: "meetup", date: "2026-10-12", district: "浦东" } },
        { title: "Hackathon", url: "https://h.com" },
      ],
    },
  });
  const r = await searchSkill.execute({ goal: "找上海 AI 活动" }, { search });
  assert.equal(r.ok, true);
  assert.equal(r.skillId, "search");
  assert.equal(r.sources.length, 2);
  assert.equal(r.sources[0].type, "search");
  assert.equal(r.sources[0].title, "AI Meetup");
  assert.equal(r.sources[0].url, "https://x.com/1");
  assert.equal(r.sources[0].provider, "meetup");
  assert.equal(r.result.type, "search_results");
  assert.equal(r.result.content.length, 2);
});

test("search: empty result is honest success (no fabrication)", async () => {
  const search = async () => ({ kind: "ok", data: { results: [] } });
  const r = await searchSkill.execute({ goal: "找火星上的活动" }, { search });
  assert.equal(r.ok, true);
  assert.equal(r.sources.length, 0);
  assert.equal(r.result.content.length, 0);
});

test("search: unavailable backend reports SEARCH_OFFLINE (§12)", async () => {
  const search = async () => ({ kind: "unavailable" });
  const r = await searchSkill.execute({ goal: "x" }, { search });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "SEARCH_OFFLINE");
});

test("search: API error reports SEARCH_API_ERROR", async () => {
  const search = async () => ({ kind: "error", status: 500, detail: "boom" });
  const r = await searchSkill.execute({ goal: "x" }, { search });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "SEARCH_API_ERROR");
});

test("search: thrown provider error is caught (§12)", async () => {
  const search = async () => { throw new Error("net down"); };
  const r = await searchSkill.execute({ goal: "x" }, { search });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "SEARCH_PROVIDER_ERROR");
});

test("search: missing backend reports SEARCH_NOT_CONFIGURED", async () => {
  const r = await searchSkill.execute({ goal: "x" }, { search: null });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "SEARCH_NOT_CONFIGURED");
});

test("search: empty goal is a clear error", async () => {
  const r = await searchSkill.execute({ goal: "   " }, { search: async () => ({ kind: "ok", data: {} }) });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "SEARCH_EMPTY_GOAL");
});

/* ── Extract Skill ───────────────────────────────────────────────────────── */

test("extract: pulls date/time/url/amount/email from text (§14)", () => {
  const r = extractSkill.execute({
    goal: "10 月 12 日报名截止，https://example.com，预算 500 元，联系 a@b.com，下午 3 点开会",
  });
  assert.equal(r.ok, true);
  assert.ok(r.result.content.dates.includes("10月12日"), JSON.stringify(r.result.content.dates));
  assert.ok(r.result.content.urls.includes("https://example.com"));
  assert.ok(r.result.content.amounts.includes("500元"), JSON.stringify(r.result.content.amounts));
  assert.ok(r.result.content.emails.includes("a@b.com"));
  assert.ok(r.result.content.times.includes("下午3点"), JSON.stringify(r.result.content.times));
  assert.equal(r.metadata.method, "regex");
});

test("extract: unrecognized text returns empty, never guesses", () => {
  const r = extractSkill.execute({ goal: "今天天气真不错，我们聊聊天" });
  const c = r.result.content;
  assert.deepEqual(c.dates, []);
  assert.deepEqual(c.urls, []);
  assert.deepEqual(c.emails, []);
  assert.ok(/未识别|没有/.test(r.summary));
});

/* ── Summarize Skill ─────────────────────────────────────────────────────── */

test("summarize: short text returned unchanged", () => {
  const out = localSummarize("一句话就说完的事。");
  assert.equal(out.method, "local_extractive");
  assert.equal(out.truncated, false);
  assert.ok(out.summary.includes("一句话"));
});

test("summarize: long text is extractive and order-preserving", () => {
  const text = [
    "项目目标是提升用户留存率。",
    "我们通过推送通知来召回用户。",
    "留存率在过去三个月稳步上升。",
    "通知打开率反映了用户活跃度。",
    "最终目标是把月活提升百分之二十。",
    "团队需要每周复盘关键指标。",
    "基础设施的稳定性是前提。",
    "客服满意度也需要同步跟踪。",
  ].join("");
  const out = localSummarize(text, { maxSentences: 3 });
  assert.equal(out.method, "local_extractive");
  assert.ok(out.kept < out.totalSentences);
  // original sentence order preserved
  const idx = out.sentences.map((s) => text.indexOf(s));
  for (let i = 1; i < idx.length; i++) assert.ok(idx[i] > idx[i - 1]);
});

test("summarize: deterministic across calls", () => {
  const text = "目标是增长。手段是投放。结果是转化。复盘很重要。稳定是基础。";
  const a = localSummarize(text);
  const b = localSummarize(text);
  assert.deepEqual(a, b);
});

/* ── Plan Skill ──────────────────────────────────────────────────────────── */

test("plan: generic goal yields the generic 5-step template", () => {
  const r = planSkill.execute({ goal: "准备黑客松比赛" });
  assert.equal(r.ok, true);
  assert.equal(r.result.type, "plan");
  assert.equal(r.result.content.length, 5);
  assert.equal(r.metadata.method, "rule_based");
  assert.equal(r.metadata.source, "generic");
});

test("plan: search result tailors the plan (§21)", () => {
  const r = planSkill.execute({
    goal: "为活动做计划",
    previousResults: [{ skillId: "search", result: { type: "search_results", content: [{}, {}, {}] } }],
  });
  assert.equal(r.result.content.length, 4);
  assert.ok(r.result.content[0].includes("3 个候选"), r.result.content[0]);
  assert.equal(r.metadata.source, "search_results");
});

test("buildPlan pure helper is deterministic", () => {
  const a = buildPlan({});
  const b = buildPlan({});
  assert.deepEqual(a, b);
});

/* ── Write Skill ─────────────────────────────────────────────────────────── */

test("write: produces a template work-log, labels Template/Local (§17)", () => {
  const r = writeSkill.execute(
    { goal: "写本周工作周报", task: { title: "周报" }, previousSources: [{ title: "活动A", url: "https://a.com" }] },
    { now: () => "2026-01-01T00:00:00.000Z" },
  );
  assert.equal(r.ok, true);
  assert.equal(r.result.type, "text");
  assert.ok(r.result.content.includes("模板"), r.result.content);
  assert.ok(r.result.content.includes("周报"));
  assert.ok(r.result.content.includes("2026-01-01"));
  assert.equal(r.metadata.method, "template");
  assert.equal(r.metadata.externalWrite, false);
});

test("write: never performs an external write (§32)", () => {
  // No side-channel: the skill returns text only. We assert determinism too.
  const ctx = { goal: "写总结稿", previousSources: [] };
  const a = writeSkill.execute(ctx, { now: () => "2026-01-01T00:00:00.000Z" });
  const b = writeSkill.execute(ctx, { now: () => "2026-01-01T00:00:00.000Z" });
  assert.deepEqual(a.result.content, b.result.content);
});
