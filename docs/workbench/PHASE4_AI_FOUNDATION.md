# Phase 4A — AI Provider Foundation

**Status:** ✅ Infrastructure complete (dormant — not yet wired into the live router/skills path)
**Branch:** `feature/workbench-competition`
**Principle:** *能不用模型完成，就不用模型。* The deterministic Task Router + Skills remain the primary path; AI is a fallback only.

---

## 1. Scope

Phase 4A establishes the **model infrastructure** and nothing more:

| Component | File | Responsibility |
|---|---|---|
| ModelConfig | `ai/config.js` | Holds provider/model/mode. `real` mode auto-downgrades to `mock` unless a real key is supplied. Never invents or stores a key in mock mode. |
| AIProvider contract | `ai/provider.js` | Unified `generate(request)` → normalized response. `AI_PURPOSES`, `createAIResponse`, `createAIError`. |
| MockProvider | `ai/providers/mock.js` | Offline, deterministic stand-in. No network, no key, no secrets. Validates the entire interface. |
| TokenBudget | `ai/budget.js` | Per-task ceiling: `MAX_AI_CALLS_PER_TASK = 3`, input/output token caps. `budgetCanCall` / `budgetConsume`. |
| ResponseCache | `ai/cache.js` | In-memory, keyed by `provider+model+purpose+input`. Identical requests never re-invoke the model. |
| AIClient | `ai/index.js` | Factory `createAIClient()` composing provider + budget + cache + usage log. Enforces ceiling, cache, and observability. |

**Not built in 4A:** real model adapters, router AI-fallback wiring, skill AI-calls. Those are later phases.

---

## 2. Provider contract

```js
// request
{ taskId?, purpose: "summarize"|"extract"|"plan"|"generate"|"route", input: string, maxTokens? }

// success
{ ok: true, content, provider, model, purpose, usage: { inputTokens, outputTokens }, cached: boolean }

// failure
{ ok: false, error: { code, message } }
```

No recursion, no agent loop, one call in → one response out.

---

## 3. Budget (hard ceiling)

```js
import { createTokenBudget } from "../workbench/ai/budget.js";
const b = createTokenBudget();        // maxCalls = 3 by default
budgetCanCall(b, request);            // false once usedCalls >= 3 or input token cap exceeded
budgetConsume(b, usage);              // records one call + tokens
```

Prevents infinite model loops. A task can call the model at most 3 times.

---

## 4. Cache

```js
cache.get(provider, model, purpose, input);   // null if miss
cache.set(provider, model, purpose, input, response);
```

Cached entries are returned with `cached: true` so the UI can show "来自本地缓存" instead of "AI 正在生成".

---

## 5. Usage / observability

```js
const client = createAIClient({ budget: { maxCalls: 3 } });
const res = await client.generate({ purpose: "summarize", input: "..." });
client.usage();  // { mode, calls, maxCalls, inputTokens, outputTokens, cacheSize, log }
```

---

## 6. Safety rails (enforced)

- **No paid API:** `createProvider` returns `MockProvider` in Phase 4A. Real adapters are added later behind explicit config + a real key.
- **No key guessing:** `createModelConfig` retains a key only in `real` mode with a non-empty key; otherwise it is blanked.
- **No agent loop:** `generate` is a single call; the client never re-invokes itself.
- **Deterministic-first:** AI is only ever a fallback for tasks the local rules cannot handle.
- **Dormant:** the module is **not imported** by `App`, store, skills, or router, so the Settings screen still reports AI Provider "Not configured" and existing E2E assertions (`workbench-status-ai`) stay green.

---

## 7. Tests

`app/tests/ai.test.mjs` — 15 tests, all passing. Covers provider contract, MockProvider (every purpose + error paths), budget ceiling, cache hit/miss, config downgrade, and the AIClient budget/cache/usage behavior.

```text
UNIT_TESTS=  125/125  (110 prior + 15 AI)
TEST_BUILD=  18/18
VITE_BUILD=  PASS (ai/ not bundled → 404.78 kB, unchanged)
WORKBENCH_E2E= 69/69 (no regression; §40/§41/§42 intact)
LEGACY_E2E= 58/58 (no regression)
NEW_REGRESSIONS= 0
```

---

## 8. Next (later phases, NOT this one)

- Real provider adapters behind `providers/` (OpenAI/DeepSeek/…) gated on explicit key.
- Opt-in AI-assisted router fallback for `intent === "unknown"` (default **off**).
- Skill-level AI calls (complex summarize / extract / plan) routed through `createAIClient`, counted against the task budget.
