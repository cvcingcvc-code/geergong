// Phase 4A — AI provider foundation (deterministic, offline, no paid endpoints).
import { test } from "node:test";
import assert from "node:assert/strict";

import { createModelConfig, AI_MODE } from "../src/workbench/ai/config.js";
import {
  createAIResponse,
  createAIError,
  normalizePurpose,
  AI_PURPOSES,
} from "../src/workbench/ai/provider.js";
import { MockProvider } from "../src/workbench/ai/providers/mock.js";
import {
  createTokenBudget,
  budgetCanCall,
  budgetConsume,
  DEFAULT_AI_BUDGET,
} from "../src/workbench/ai/budget.js";
import { createResponseCache } from "../src/workbench/ai/cache.js";
import { createProvider, createAIClient } from "../src/workbench/ai/index.js";

test("normalizePurpose falls back to generate", () => {
  assert.equal(normalizePurpose("summarize"), "summarize");
  assert.equal(normalizePurpose("nonsense"), "generate");
  assert.equal(AI_PURPOSES.length, 5);
});

test("createAIResponse shapes ok response", () => {
  const r = createAIResponse({ content: "hi", provider: "mock", model: "m", purpose: "plan" });
  assert.equal(r.ok, true);
  assert.equal(r.content, "hi");
  assert.equal(r.purpose, "plan");
  assert.deepEqual(r.usage, { inputTokens: 0, outputTokens: 0 });
  assert.equal(r.cached, false);
});

test("createAIError shapes error response", () => {
  const e = createAIError("X", "boom");
  assert.equal(e.ok, false);
  assert.equal(e.error.code, "X");
  assert.equal(e.error.message, "boom");
});

test("MockProvider returns ok with content + usage for every purpose", async () => {
  const p = new MockProvider({ model: "mock-v1" });
  for (const purpose of AI_PURPOSES) {
    const res = await p.generate({ purpose, input: "一些输入文本" });
    assert.equal(res.ok, true, `purpose ${purpose} should be ok`);
    assert.equal(res.provider, "mock");
    assert.equal(res.model, "mock-v1");
    assert.equal(res.purpose, purpose);
    assert.ok(res.content.length > 0, "content must be non-empty");
    assert.ok(res.usage.inputTokens > 0);
    assert.ok(res.usage.outputTokens > 0);
  }
});

test("MockProvider rejects empty input and non-object request", async () => {
  const p = new MockProvider();
  const empty = await p.generate({ purpose: "summarize", input: "   " });
  assert.equal(empty.ok, false);
  assert.equal(empty.error.code, "AI_EMPTY_INPUT");

  const notObj = await p.generate(null);
  assert.equal(notObj.ok, false);
  assert.equal(notObj.error.code, "AI_INVALID_REQUEST");
});

test("MockProvider honors artificial latency", async () => {
  const p = new MockProvider({ latencyMs: 20 });
  const t0 = Date.now();
  await p.generate({ purpose: "generate", input: "x" });
  assert.ok(Date.now() - t0 >= 15, "should wait ~latency");
});

test("TokenBudget defaults to MAX_AI_CALLS_PER_TASK=3", () => {
  const b = createTokenBudget();
  assert.equal(b.maxCalls, 3);
  assert.equal(b.maxCalls, DEFAULT_AI_BUDGET.MAX_AI_CALLS_PER_TASK);
  assert.equal(b.usedCalls, 0);
  assert.equal(budgetCanCall(b, { input: "abc" }), true);
});

test("TokenBudget blocks after maxCalls and on oversized input", () => {
  const b = createTokenBudget({ maxCalls: 2, maxInputTokens: 5 });
  assert.equal(budgetCanCall(b, { input: "abc" }), true);
  budgetConsume(b, { inputTokens: 3, outputTokens: 2 });
  budgetConsume(b, { inputTokens: 1, outputTokens: 1 });
  assert.equal(b.usedCalls, 2);
  assert.equal(budgetCanCall(b, { input: "abc" }), false, "exceeded call ceiling");
  assert.equal(budgetCanCall(b, { input: "abcdefghij" }), false, "exceeded input token ceiling");
});

test("ResponseCache get/set/has + cached flag", () => {
  const c = createResponseCache();
  const resp = createAIResponse({ content: "cached!", provider: "mock", model: "m", purpose: "extract" });
  assert.equal(c.has("mock", "m", "extract", "k"), false);
  c.set("mock", "m", "extract", "k", resp);
  assert.equal(c.has("mock", "m", "extract", "k"), true);
  const got = c.get("mock", "m", "extract", "k");
  assert.equal(got.content, "cached!");
  assert.equal(got.cached, true);
  assert.equal(c.size(), 1);
  c.clear();
  assert.equal(c.size(), 0);
});

test("createModelConfig downgrades real mode without a key", () => {
  const withKey = createModelConfig({ mode: "real", provider: "deepseek", apiKey: "sk-test", model: "v3" });
  assert.equal(withKey.mode, "real"); // key present → real honored
  assert.equal(withKey.apiKey, "sk-test");

  const noKey = createModelConfig({ mode: "real", provider: "deepseek", model: "v3" });
  assert.equal(noKey.mode, "mock", "no key → must downgrade to mock");
  assert.equal(noKey.apiKey, "", "must not retain a key in mock mode");

  const plain = createModelConfig();
  assert.equal(plain.mode, "mock");
  assert.equal(plain.provider, "mock");
  assert.equal(plain.model, "mock-model");
});

test("createProvider returns a MockProvider (Phase 4A has no real adapter)", () => {
  const p = createProvider(createModelConfig({ mode: "real", apiKey: "x" }));
  assert.ok(p instanceof MockProvider);
  assert.equal(p.config.provider, "mock");
});

test("createAIClient generate works and usage() reports spend", async () => {
  const client = createAIClient({ budget: { maxCalls: 3 } });
  const r = await client.generate({ purpose: "summarize", input: "今天天气不错，要总结一下。" });
  assert.equal(r.ok, true);
  assert.equal(r.cached, false);
  const u = client.usage();
  assert.equal(u.calls, 1);
  assert.equal(u.maxCalls, 3);
  assert.ok(u.inputTokens > 0);
});

test("createAIClient serves cached response on repeat and flags cached:true", async () => {
  const client = createAIClient({ budget: { maxCalls: 5 } });
  const req = { purpose: "plan", input: "重复的计划请求用于验证缓存命中行为" };
  const first = await client.generate(req);
  assert.equal(first.cached, false);
  const second = await client.generate(req);
  assert.equal(second.ok, true);
  assert.equal(second.cached, true, "second identical call must be served from cache");
  assert.equal(client.usage().cacheSize, 1);
});

test("createAIClient enforces MAX_AI_CALLS_PER_TASK hard ceiling", async () => {
  const client = createAIClient({ budget: { maxCalls: 3 } });
  let okCount = 0;
  for (let i = 0; i < 3; i++) {
    const r = await client.generate({ purpose: "generate", input: `第 ${i} 次真实调用用于测试上限` });
    if (r.ok) okCount++;
  }
  assert.equal(okCount, 3, "first three calls should succeed");
  const fourth = await client.generate({ purpose: "generate", input: "第四次调用应当被预算拦截" });
  assert.equal(fourth.ok, false, "fourth call must be blocked");
  assert.equal(fourth.error.code, "AI_BUDGET_EXCEEDED");
  assert.equal(client.usage().calls, 3);
});

test("createAIClient does not crash on empty input (returns error response)", async () => {
  const client = createAIClient();
  const r = await client.generate({ purpose: "summarize", input: "   " });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "AI_EMPTY_INPUT");
});
