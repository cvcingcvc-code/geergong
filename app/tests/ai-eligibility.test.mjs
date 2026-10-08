// Phase 4B — AI Eligibility Gate + Hunyuan Provider + Fallback chain.
//
// Fully offline: the Hunyuan provider is driven through an INJECTED fetch, so
// no test in this file touches the network or needs a real API key.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  shouldUseAI, estimateCost, AI_REASONS,
  AI_ALLOWED_PURPOSES, AI_FORBIDDEN_SKILLS,
  LONG_INPUT_CHARS, HIGH_CONFIDENCE,
} from "../src/workbench/ai/eligibility.js";
import { HunyuanProvider, HUNYUAN_DEFAULT_BASE_URL } from "../src/workbench/ai/providers/hunyuan.js";
import { MockProvider } from "../src/workbench/ai/providers/mock.js";
import { createProvider, createAIClient, resolveProviderConfig } from "../src/workbench/ai/index.js";
import { runWithFallback, isRecoverable, RECOVERABLE_AI_ERRORS } from "../src/workbench/ai/fallback.js";

// ── 4B.1 gate basics ──────────────────────────────────────────────────────

test("estimateCost counts CJK heavier than ASCII and stays finite", () => {
  const cjk = estimateCost("中文内容测试文本");
  const ascii = estimateCost("abcdefgh");
  assert.ok(cjk.inputTokens >= 8);
  assert.ok(ascii.inputTokens <= 3);
  assert.ok(Number.isFinite(cjk.outputTokens));
});

test("shouldUseAI denies everything when AI is disabled", () => {
  const d = shouldUseAI({ skill: "summarize", purpose: "summarize", input: "x".repeat(5000), aiEnabled: false });
  assert.equal(d.eligible, false);
  assert.equal(d.reason, AI_REASONS.AI_DISABLED);
});

test("shouldUseAI denies skills on the forbidden list — search never calls AI", () => {
  for (const skill of AI_FORBIDDEN_SKILLS) {
    const d = shouldUseAI({ skill, purpose: "generate", input: "找上海未来一周的 AI 活动".repeat(50) });
    assert.equal(d.eligible, false, `${skill} must be denied`);
    assert.equal(d.reason, AI_REASONS.SKILL_FORBIDDEN);
  }
});

test("shouldUseAI allows only the four blessed purposes", () => {
  assert.deepEqual([...AI_ALLOWED_PURPOSES], ["summarize", "extract", "plan", "generate"]);
  // A non-forbidden skill asking for a non-blessed purpose is still denied.
  const d = shouldUseAI({ skill: "summarize", purpose: "route", input: "一些内容".repeat(400) });
  assert.equal(d.eligible, false);
  assert.equal(d.reason, AI_REASONS.SKILL_NOT_ALLOWED);
  // "route" as a SKILL is rejected earlier, by the forbidden-skill rule.
  const asSkill = shouldUseAI({ skill: "route", purpose: "route", input: "一些内容".repeat(400) });
  assert.equal(asSkill.reason, AI_REASONS.SKILL_FORBIDDEN);
});

test("shouldUseAI denies empty input", () => {
  const d = shouldUseAI({ skill: "summarize", purpose: "summarize", input: "   " });
  assert.equal(d.eligible, false);
  assert.equal(d.reason, AI_REASONS.EMPTY_INPUT);
});

test("shouldUseAI denies when deterministic rules were already confident", () => {
  const d = shouldUseAI({
    skill: "extract", purpose: "extract", input: "10月12日 15:00 截止，联系 a@b.com",
    deterministicConfidence: 0.95,
  });
  assert.equal(d.eligible, false);
  assert.equal(d.reason, AI_REASONS.DETERMINISTIC_SUFFICIENT);
});

test("shouldUseAI denies a short, simple input", () => {
  const d = shouldUseAI({ skill: "summarize", purpose: "summarize", input: "今天天气不错。" });
  assert.equal(d.eligible, false);
  assert.equal(d.reason, AI_REASONS.INPUT_TOO_SHORT);
});

test("shouldUseAI allows a long input (too much for extractive summarization)", () => {
  const d = shouldUseAI({
    skill: "summarize", purpose: "summarize",
    input: "上海人工智能生态发展观察。".repeat(Math.ceil(LONG_INPUT_CHARS / 12)),
  });
  assert.equal(d.eligible, true);
  assert.equal(d.reason, AI_REASONS.ELIGIBLE_LONG_INPUT);
  assert.equal(d.purpose, "summarize");
  assert.ok(d.estimatedCost.inputTokens > 0);
});

test("shouldUseAI allows unknown-intent fallback", () => {
  const d = shouldUseAI({ skill: "plan", purpose: "plan", input: "帮我看看这个", intent: "unknown" });
  assert.equal(d.eligible, true);
  assert.equal(d.reason, AI_REASONS.ELIGIBLE_UNKNOWN_INTENT);
});

test("shouldUseAI allows a complex short input the rules could not handle", () => {
  const d = shouldUseAI({
    skill: "write", purpose: "generate", input: "帮我写一段介绍，比较一下三种方案的优缺点",
    deterministicConfidence: 0.2,
  });
  assert.equal(d.eligible, true);
  assert.equal(d.reason, AI_REASONS.ELIGIBLE_COMPLEX);
});

test("shouldUseAI allows a retry after a previous deterministic failure", () => {
  const d = shouldUseAI({
    skill: "extract", purpose: "extract", input: "一些无法用正则解析的复杂描述内容",
    previousFailure: true,
  });
  assert.equal(d.eligible, true);
  assert.equal(d.reason, AI_REASONS.ELIGIBLE_COMPLEX);
});

test("shouldUseAI denies once the call budget is exhausted", () => {
  const d = shouldUseAI({
    skill: "summarize", purpose: "summarize", input: "长文本".repeat(2000),
    budget: { maxCalls: 3, usedCalls: 3 },
  });
  assert.equal(d.eligible, false);
  assert.equal(d.reason, AI_REASONS.BUDGET_EXCEEDED);
});

test("shouldUseAI denies when the input alone exceeds the token ceiling", () => {
  const d = shouldUseAI({
    skill: "summarize", purpose: "summarize", input: "字".repeat(9000),
    budget: { maxCalls: 5, usedCalls: 0, maxInputTokens: 8000 },
  });
  assert.equal(d.eligible, false);
  assert.equal(d.reason, AI_REASONS.BUDGET_EXCEEDED);
});

test("shouldUseAI is a pure function — same input, same verdict", () => {
  const ctx = { skill: "summarize", purpose: "summarize", input: "上海人工智能生态观察".repeat(300) };
  assert.deepEqual(shouldUseAI(ctx), shouldUseAI(ctx));
});

// ── 4B.4 Hunyuan provider (injected transport, zero network) ─────────────

function fakeFetch(responder) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    return responder(url, init);
  };
  fn.calls = calls;
  return fn;
}

const OK_BODY = {
  model: "hunyuan-turbos-latest",
  choices: [{ message: { content: "这是混元返回的摘要内容。" } }],
  usage: { prompt_tokens: 120, completion_tokens: 30 },
};

test("HunyuanProvider is not usable without a key — never guesses one", () => {
  const p = new HunyuanProvider({ apiKey: "" });
  assert.equal(p.usable, false);
});

test("HunyuanProvider returns AI_NOT_CONFIGURED instead of throwing when unusable", async () => {
  const p = new HunyuanProvider({ apiKey: "" });
  const r = await p.generate({ purpose: "summarize", input: "文本" });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "AI_NOT_CONFIGURED");
});

test("HunyuanProvider maps a successful completion into the shared shape", async () => {
  const f = fakeFetch(async () => ({ ok: true, status: 200, json: async () => OK_BODY }));
  const p = new HunyuanProvider({ apiKey: "test-key", fetch: f });
  const r = await p.generate({ purpose: "summarize", input: "上海 AI 活动总结" });
  assert.equal(r.ok, true);
  assert.equal(r.provider, "hunyuan");
  assert.equal(r.content, "这是混元返回的摘要内容。");
  assert.deepEqual(r.usage, { inputTokens: 120, outputTokens: 30 });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, `${HUNYUAN_DEFAULT_BASE_URL}/chat/completions`);
  assert.equal(f.calls[0].init.headers.Authorization, "Bearer test-key");
});

test("HunyuanProvider maps 429 to AI_RATE_LIMITED (recoverable)", async () => {
  const f = fakeFetch(async () => ({ ok: false, status: 429, json: async () => ({}) }));
  const p = new HunyuanProvider({ apiKey: "k", fetch: f });
  const r = await p.generate({ purpose: "plan", input: "制定计划" });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "AI_RATE_LIMITED");
  assert.equal(isRecoverable(r.error.code), true);
});

test("HunyuanProvider maps a thrown network error to AI_NETWORK_ERROR", async () => {
  const f = fakeFetch(async () => { throw new Error("ECONNREFUSED"); });
  const p = new HunyuanProvider({ apiKey: "k", fetch: f });
  const r = await p.generate({ purpose: "summarize", input: "文本" });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "AI_NETWORK_ERROR");
});

test("HunyuanProvider never fabricates content from an empty body", async () => {
  const f = fakeFetch(async () => ({ ok: true, status: 200, json: async () => ({ choices: [] }) }));
  const p = new HunyuanProvider({ apiKey: "k", fetch: f });
  const r = await p.generate({ purpose: "summarize", input: "文本" });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "AI_EMPTY_RESPONSE");
});

test("createProvider selects Hunyuan ONLY when explicitly named AND keyed", () => {
  const hunyuan = createProvider({ provider: "hunyuan", mode: "real", apiKey: "k" });
  assert.ok(hunyuan instanceof HunyuanProvider);
  assert.equal(hunyuan.config.provider, "hunyuan");
  // No key → degrade to mock, app stays runnable.
  const noKey = createProvider({ provider: "hunyuan", mode: "mock", apiKey: "" });
  assert.ok(noKey instanceof MockProvider);
  // Unknown provider name never becomes a blind network call.
  const unknown = createProvider({ provider: "some-unknown", mode: "real", apiKey: "k" });
  assert.ok(unknown instanceof MockProvider);
});

test("resolveProviderConfig keeps mock mode when the host has no key", () => {
  const cfg = resolveProviderConfig({ provider: "mock" });
  assert.equal(cfg.mode, "mock");
  assert.equal(cfg.apiKey, "");
});

// ── 4B.5 fallback chain ──────────────────────────────────────────────────

const detResult = { ok: true, skillId: "summarize", summary: "本地摘要", result: { type: "text", content: "本地" } };

test("runWithFallback makes ZERO model calls when the gate denies", async () => {
  let called = 0;
  const client = { generate: async () => { called++; return { ok: true, content: "AI" }; } };
  const out = await runWithFallback({
    gate: { skill: "search", purpose: "generate", input: "找上海 AI 活动" },
    client, deterministic: () => detResult, input: "找上海 AI 活动",
  });
  assert.equal(called, 0, "gate denial must not call the model");
  assert.equal(out.aiAssisted, false);
  assert.equal(out.ok, true);
  assert.equal(out.aiReason, AI_REASONS.SKILL_FORBIDDEN);
});

test("runWithFallback falls back deterministically when the provider throws", async () => {
  const client = { generate: async () => { throw new Error("socket hang up"); } };
  const out = await runWithFallback({
    gate: { skill: "summarize", purpose: "summarize", input: "长文本".repeat(1000) },
    client, deterministic: () => detResult, input: "长文本".repeat(1000),
  });
  assert.equal(out.ok, true);
  assert.equal(out.aiAssisted, false);
  assert.equal(out.fallbackReason, "AI_NETWORK_ERROR");
});

test("runWithFallback survives a provider error without a deterministic path", async () => {
  const client = { generate: async () => ({ ok: false, error: { code: "AI_TIMEOUT", message: "超时" } }) };
  const out = await runWithFallback({
    gate: { skill: "summarize", purpose: "summarize", input: "长文本".repeat(1000) },
    client, deterministic: () => null, input: "长文本".repeat(1000),
  });
  assert.equal(out.ok, false, "must fail explicitly rather than invent a result");
  assert.equal(out.aiAssisted, false);
  assert.equal(out.result, null);
  assert.equal(out.fallbackReason, "AI_TIMEOUT");
});

test("runWithFallback marks a real model answer as aiAssisted with provider + model", async () => {
  const client = {
    generate: async () => ({
      ok: true, content: "AI 摘要", provider: "hunyuan", model: "hunyuan-turbos-latest",
      usage: { inputTokens: 10, outputTokens: 5 }, cached: false,
    }),
  };
  const out = await runWithFallback({
    gate: { skill: "summarize", purpose: "summarize", input: "长文本".repeat(1000) },
    client, deterministic: () => detResult, input: "长文本".repeat(1000),
  });
  assert.equal(out.ok, true);
  assert.equal(out.aiAssisted, true);
  assert.equal(out.provider, "hunyuan");
  assert.equal(out.model, "hunyuan-turbos-latest");
  assert.equal(out.fallbackReason, null);
});

test("runWithFallback uses the deterministic path when no client exists at all", async () => {
  const out = await runWithFallback({
    gate: { skill: "summarize", purpose: "summarize", input: "长文本".repeat(1000) },
    client: null, deterministic: () => detResult, input: "长文本".repeat(1000),
  });
  assert.equal(out.ok, true);
  assert.equal(out.aiAssisted, false);
  assert.equal(out.aiReason, AI_REASONS.ELIGIBLE_LONG_INPUT);
});

test("all four expected AI failure modes are classified recoverable", () => {
  for (const c of ["AI_TIMEOUT", "AI_RATE_LIMITED", "AI_NETWORK_ERROR", "AI_PROVIDER_ERROR"]) {
    assert.equal(isRecoverable(c), true, `${c} must be recoverable`);
    assert.ok(RECOVERABLE_AI_ERRORS.includes(c));
  }
  assert.equal(isRecoverable("AI_BUDGET_EXCEEDED"), false);
});

// ── end-to-end through the real client: cache + budget still enforced ────

test("AI client caching still holds with the 4B wiring intact", async () => {
  const client = createAIClient({ provider: "mock" });
  const a = await client.generate({ purpose: "summarize", input: "同样的输入内容" });
  const b = await client.generate({ purpose: "summarize", input: "同样的输入内容" });
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(b.cached, true, "second identical call must come from cache");
  assert.equal(client.usage().cacheSize, 1);
});

test("AI client reports mode + usage so the UI can show 本地处理 vs AI Assisted", async () => {
  const client = createAIClient({ provider: "mock" });
  await client.generate({ purpose: "plan", input: "制定一个参加活动的计划" });
  const u = client.usage();
  assert.equal(u.mode, "mock");
  assert.equal(u.calls, 1);
  assert.ok(u.log.length >= 1);
});

test("gate budget integrates with the real client budget object", async () => {
  const client = createAIClient({ provider: "mock", budget: { maxCalls: 1 } });
  const first = await client.generate({ purpose: "summarize", input: "第一次调用内容" });
  const second = await client.generate({ purpose: "summarize", input: "第二次调用内容" });
  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  assert.equal(second.error.code, "AI_BUDGET_EXCEEDED");

  const gate = shouldUseAI({
    skill: "summarize", purpose: "summarize", input: "第三次调用内容",
    budget: client.budget,
  });
  assert.equal(gate.eligible, false);
  assert.equal(gate.reason, AI_REASONS.BUDGET_EXCEEDED);
});
