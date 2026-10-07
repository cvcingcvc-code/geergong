// AI client factory — composes provider + budget + cache + usage into one entry point.
//
// This is the ONLY thing a future skill/router should import. It enforces:
//   - per-task call ceiling (budget)
//   - input-token ceiling (budget)
//   - response caching (no duplicate model calls)
//   - usage logging (observable spend)
//
// Phase 4A ships only MockProvider. The factory never invents a key, never guesses
// a provider, and never falls through to a real paid endpoint on its own.

import { createModelConfig } from "./config.js";
import { createTokenBudget, budgetCanCall, budgetConsume } from "./budget.js";
import { createResponseCache } from "./cache.js";
import { MockProvider } from "./providers/mock.js";

// Returns a provider instance. Phase 4A: only MockProvider exists. Real adapters
// are added later behind an explicit config + real key; until then we always return
// the offline mock so the system stays safe and deterministic.
export function createProvider(config) {
  // Intentionally no real-adapter branch yet. If a caller asks for "real" without a
  // registered adapter, we safely degrade to mock rather than risk a blind network call.
  return new MockProvider(config || {});
}

export function createAIClient(input = {}) {
  const config = createModelConfig(input);
  const provider = createProvider(config);
  const budget = createTokenBudget(input.budget || {});
  const cache = createResponseCache();
  const log = [];

  const pkOf = (request) => ({
    provider: provider.config.provider,
    model: provider.config.model,
    purpose: request.purpose || "generate",
    input: request.input || "",
  });

  return {
    config,
    provider,
    budget,
    mode: config.mode,

    async generate(request) {
      if (!budgetCanCall(budget, request)) {
        return {
          ok: false,
          error: {
            code: "AI_BUDGET_EXCEEDED",
            message: "已达本任务 AI 调用上限或输入 token 超限",
          },
        };
      }

      const pk = pkOf(request);

      // Cache hit → return immediately, still counts as a (cheap) call.
      const cached = cache.get(pk.provider, pk.model, pk.purpose, pk.input);
      if (cached) {
        budgetConsume(budget, cached.usage);
        log.push({ purpose: pk.purpose, ok: true, cached: true });
        return cached;
      }

      const res = await provider.generate(request);
      if (res.ok) {
        budgetConsume(budget, res.usage);
        cache.set(pk.provider, pk.model, pk.purpose, pk.input, res);
        log.push({ purpose: pk.purpose, ok: true, cached: false, usage: res.usage });
      } else {
        log.push({ purpose: pk.purpose, ok: false, error: res.error });
      }
      return res;
    },

    usage() {
      return {
        mode: config.mode,
        calls: budget.usedCalls,
        maxCalls: budget.maxCalls,
        inputTokens: budget.usedInputTokens,
        outputTokens: budget.usedOutputTokens,
        cacheSize: cache.size(),
        log: log.slice(),
      };
    },
  };
}
