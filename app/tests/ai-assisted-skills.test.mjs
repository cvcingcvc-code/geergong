// Phase 5 Gate — AI-assisted Skills (Cases A–D from the brief).
//
// These tests pin the four competition-critical scenarios:
//   Case A  帮我找上海 AI 活动                     → search, AI calls = 0
//   Case B  帮我找上海 AI 活动并制定参加计划         → search once → plan
//   Case C  长文本摘要                              → eligibility/budget/usage/cache
//   Case D  Provider unavailable                   → fallback, no crash
import { test } from "node:test";
import assert from "node:assert/strict";

import searchSkill from "../src/workbench/skills/search-skill.js";
import extractSkill from "../src/workbench/skills/extract-skill.js";
import summarizeSkill from "../src/workbench/skills/summarize-skill.js";
import planSkill from "../src/workbench/skills/plan-skill.js";
import writeSkill from "../src/workbench/skills/write-skill.js";
import { createAIClient } from "../src/workbench/ai/index.js";
import { shouldUseAI } from "../src/workbench/ai/eligibility.js";

const DEMO_GOAL =
  "帮我找上海未来一周值得参加的 AI/创业活动，优先免费、适合认识开发者，并帮我制定参加计划。";

/** A client whose provider always fails the way a real outage does. */
function brokenClient(code) {
  let calls = 0;
  return {
    calls: () => calls,
    budget: { maxCalls: 3, usedCalls: 0, maxInputTokens: 8000 },
    generate: async () => {
      calls++;
      return { ok: false, error: { code, message: "provider unavailable" } };
    },
  };
}

/** A client that returns a clearly-fake "AI" answer, so we can spot leakage. */
function fakeAiClient(content = "AI 生成的总结") {
  let calls = 0;
  return {
    calls: () => calls,
    budget: { maxCalls: 3, usedCalls: 0, maxInputTokens: 8000 },
    generate: async () => {
      calls++;
      return {
        ok: true, content, provider: "hunyuan", model: "hunyuan-turbos-latest",
        usage: { inputTokens: 100, outputTokens: 20 }, cached: false,
      };
    },
  };
}

// ── Case A: search must never call a model ──────────────────────────────

test("Case A: search skill is deterministic and reports no AI usage", async () => {
  const r = await searchSkill.execute(
    { goal: "找上海 AI 活动" },
    { search: async () => ({ kind: "ok", data: { results: [], providerMode: "demo" } }) },
  );
  assert.equal(r.ok, true);
  // search is deliberately NOT wired to the AI bridge at all — it is the one
  // skill that can never be upgraded. Assert that structurally.
  assert.equal(r.metadata.aiAssisted, undefined, "search must not participate in AI metadata");
  assert.equal(r.metadata.method, "api");
  // And the gate refuses it outright, regardless of any client.
  const client = fakeAiClient();
  const g = shouldUseAI({ skill: "search", purpose: "generate", input: "找上海 AI 活动" });
  assert.equal(g.eligible, false);
  assert.equal(client.calls(), 0);
});

test("Case A: the gate denies search even for a huge input", () => {
  const g = shouldUseAI({ skill: "search", purpose: "generate", input: "找活动".repeat(5000) });
  assert.equal(g.eligible, false);
  assert.equal(g.reason, "SKILL_FORBIDDEN");
});

// ── offline default: no client ⇒ every skill stays local ────────────────

test("all AI-capable skills stay local (and synchronous) when no aiClient is passed", () => {
  const r1 = extractSkill.execute({ goal: "10月12日 15:00 截止，联系 a@b.com" });
  const r2 = summarizeSkill.execute({ goal: "短文本摘要。" });
  const r3 = planSkill.execute({ goal: "制定计划" });
  const r4 = writeSkill.execute({ goal: "写一份工作记录" }, { now: () => "2026-10-08T00:00:00Z" });
  for (const r of [r1, r2, r3, r4]) {
    assert.equal(r.ok, true);
    assert.equal(r.metadata.aiAssisted, false, "must be local without a client");
    assert.equal(r.metadata.aiProvider, null);
  }
  // Not promises → the sync contract is preserved.
  assert.equal(r1 instanceof Promise, false);
});

test("each skill records WHY it stayed local", () => {
  const r = extractSkill.execute({ goal: "10月12日 15:00 截止" });
  assert.ok(r.metadata.aiReason, "aiReason must be recorded for the UI badge");
  assert.equal(typeof r.metadata.aiReason, "string");
  assert.equal(r.metadata.aiUsageTotal, 0);
});

// ── Case C: long text summarization through the gate ────────────────────

test("Case C: a long summarize is AI-eligible", () => {
  const g = shouldUseAI({
    skill: "summarize", purpose: "summarize",
    input: "上海人工智能生态发展观察与产业政策解读。".repeat(120),
  });
  assert.equal(g.eligible, true);
  assert.equal(g.reason, "ELIGIBLE_LONG_INPUT");
});

test("Case C: a long summarize with a real client returns AI-labelled output", async () => {
  const client = fakeAiClient("这是 AI 生成的摘要内容");
  const r = await summarizeSkill.execute(
    { goal: "总结一下这段材料", text: "上海人工智能生态发展观察。".repeat(150) },
    { aiClient: client },
  );
  assert.equal(r.ok, true);
  assert.equal(r.metadata.aiAssisted, true);
  assert.equal(r.metadata.aiProvider, "hunyuan");
  assert.equal(r.metadata.aiModel, "hunyuan-turbos-latest");
  assert.equal(r.metadata.aiUsage.inputTokens, 100);
  assert.equal(r.metadata.aiUsageTotal, 120);
  assert.equal(r.result.content, "这是 AI 生成的摘要内容");
  assert.equal(client.calls(), 1);
});

test("Case C: a SHORT summarize stays local even with a client available", () => {
  const client = fakeAiClient();
  const r = summarizeSkill.execute({ goal: "总结：今天天气不错。" }, { aiClient: client });
  assert.equal(r.metadata.aiAssisted, false);
  assert.equal(client.calls(), 0, "short text must not reach the model");
});

test("Case C: budget exhaustion is reported, not silently ignored", () => {
  const client = createAIClient({ provider: "mock", budget: { maxCalls: 0 } });
  const g = shouldUseAI({
    skill: "summarize", purpose: "summarize", input: "长文本".repeat(1000), budget: client.budget,
  });
  assert.equal(g.eligible, false);
  assert.equal(g.reason, "BUDGET_EXCEEDED");
});

test("Case C: cache prevents a duplicate model call for identical input", async () => {
  const client = createAIClient({ provider: "mock" });
  const text = "缓存验证材料。".repeat(200);
  await summarizeSkill.execute({ goal: "总结", text }, { aiClient: client });
  await summarizeSkill.execute({ goal: "总结", text }, { aiClient: client });
  const u = client.usage();
  // A cache hit is still recorded in the log, but flagged `cached:true`, and
  // only ONE real provider invocation happened.
  assert.equal(u.log.length, 2);
  assert.equal(u.log[0].cached, false, "first call must hit the provider");
  assert.equal(u.log[1].cached, true, "identical second call must be served from cache");
  assert.equal(u.cacheSize, 1);
});

test("Case C: a cache hit is reported as cached, not as a fresh AI call", async () => {
  // Caching lives in the real client, so this must go through createAIClient.
  // A raw/fake provider cannot demonstrate a hit by design.
  const client = createAIClient({ provider: "mock" });
  const text = "缓存命中验证。".repeat(200);
  const first = await summarizeSkill.execute({ goal: "总结", text }, { aiClient: client });
  const second = await summarizeSkill.execute({ goal: "总结", text }, { aiClient: client });
  assert.equal(first.metadata.aiCached, false, "first call is a real provider call");
  assert.equal(second.metadata.aiCached, true, "the repeat must be marked as cached");
  assert.equal(second.metadata.aiAssisted, false, "mock provider is never 'AI Assisted'");
  assert.equal(second.metadata.simulated, true);
});

// ── Case D: provider unavailable ────────────────────────────────────────

test("Case D: a failing provider falls back to the local result without crashing", async () => {
  const client = brokenClient("AI_RATE_LIMITED");
  const r = await summarizeSkill.execute(
    { goal: "总结一下", text: "很长的材料内容。".repeat(200) },
    { aiClient: client },
  );
  assert.equal(r.ok, true, "must still produce a usable result");
  assert.equal(r.metadata.aiAssisted, false, "must NOT claim AI assistance");
  assert.equal(r.metadata.aiFallbackReason, "AI_RATE_LIMITED");
  assert.equal(r.result.content.length > 0, true, "deterministic content preserved");
  assert.equal(client.calls(), 1);
});

test("Case D: a throwing provider is contained, not propagated", async () => {
  const client = {
    budget: { maxCalls: 3, usedCalls: 0, maxInputTokens: 8000 },
    generate: async () => { throw new Error("socket hang up"); },
  };
  const r = await summarizeSkill.execute(
    { goal: "总结一下", text: "很长的材料内容。".repeat(200) },
    { aiClient: client },
  );
  assert.equal(r.ok, true);
  assert.equal(r.metadata.aiAssisted, false);
  assert.equal(r.metadata.aiFallbackReason, "AI_NETWORK_ERROR");
});

// ── honesty: a mock provider must never be labelled "AI Assisted" ───────

test("a MockProvider result is reported as simulated, not as AI Assisted", async () => {
  const client = createAIClient({ provider: "mock" });
  const r = await summarizeSkill.execute(
    { goal: "总结一下", text: "很长的材料内容。".repeat(200) },
    { aiClient: client },
  );
  assert.equal(r.metadata.aiAssisted, false, "mock output must not be sold as AI");
  assert.equal(r.metadata.simulated, true, "but it must be disclosed");
  assert.equal(r.metadata.aiProvider, null);
});

// ── plan must still consume search results, never re-search ────────────

test("plan consumes previousResults and does not re-run search", () => {
  const r = planSkill.execute({
    goal: DEMO_GOAL,
    previousResults: [{
      skillId: "search",
      result: { type: "search_results", content: [{ title: "A" }, { title: "B" }, { title: "C" }] },
    }],
  });
  assert.equal(r.ok, true);
  assert.equal(r.metadata.source, "search_results");
  assert.ok(/排名靠前的 3 个候选/.test(r.result.content[0]));
  assert.equal(r.metadata.aiAssisted, false);
});

test("write skill never records an external write, even with AI available", () => {
  const client = fakeAiClient("AI 写的正文");
  const r = writeSkill.execute({ goal: "写一份比赛工作记录" }, { aiClient: client, now: () => "2026-10-08T00:00:00Z" });
  assert.equal(r.ok, true);
  assert.equal(r.metadata.externalWrite, false, "write must stay text-only");
});

// ── extract: local rules win when they find something ──────────────────

test("extract stays local when the regex finds structured data", () => {
  const client = fakeAiClient();
  const r = extractSkill.execute({ goal: "10月12日 15:00 截止，联系 a@b.com" }, { aiClient: client });
  assert.equal(r.metadata.aiAssisted, false);
  assert.equal(client.calls(), 0, "regex already solved it — no model call");
  assert.ok(r.result.content.dates.includes("10月12日"));
});

test("extract consults AI when local rules find nothing in a complex, long input", async () => {
  const client = fakeAiClient('{"dates":[],"urls":[]}');
  // Long + explicitly comparative/complex → the gate allows an AI extract.
  const goal =
    "请分析并比较这段描述里提到的时间安排与参与条件，同时评估其中的风险和优缺点，说明为什么这样安排更合适，以及参与者需要注意哪些细节。" +
    "另外对比一下不同方案之间的差异。".repeat(8);
  const r = await extractSkill.execute({ goal }, { aiClient: client });
  assert.equal(r.ok, true);
  assert.equal(client.calls(), 1, "low deterministic confidence on complex input may allow AI");
  assert.equal(r.metadata.aiAssisted, true);
  assert.equal(r.metadata.aiProvider, "hunyuan");
});

test("extract stays local on short unrecognized text (too short to be worth a model)", () => {
  const client = fakeAiClient();
  const r = extractSkill.execute({ goal: "这段文字没有任何可被正则识别的结构化信息" }, { aiClient: client });
  assert.equal(r.metadata.aiAssisted, false);
  assert.equal(r.metadata.aiReason, "INPUT_TOO_SHORT");
  assert.equal(client.calls(), 0);
});
