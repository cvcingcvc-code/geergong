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
import { HunyuanProvider } from "./providers/hunyuan.js";

// Phase 4B: read provider settings from the HOST environment (Python desktop
// shell / CLI), never from the browser bundle. `process` does not exist in a
// Vite browser build, so this branch is dead code there — which is exactly what
// we want: an API key can never be compiled into the frontend (§4B.4).
function hostEnv(name) {
  try {
    if (typeof process !== "undefined" && process && process.env && process.env[name]) {
      return process.env[name];
    }
  } catch {
    /* not a node-like host */
  }
  return "";
}

/**
 * Build provider config from explicit input, else from the host environment.
 * Anything missing simply stays in mock — we never guess, never invent a key.
 */
export function resolveProviderConfig(input = {}) {
  const envProvider = hostEnv("GORGON_AI_PROVIDER");
  const envKey = hostEnv("GORGON_AI_API_KEY");
  const envModel = hostEnv("GORGON_AI_MODEL");
  const envBase = hostEnv("GORGON_AI_BASE_URL");

  // Explicit input always wins; env is only a fallback for the host shell.
  const provider = input.provider || envProvider || "mock";
  const apiKey = input.apiKey || envKey || "";
  const model = input.model || envModel || "";
  const baseURL = input.baseURL || envBase || "";

  const requestedMode = input.mode || (provider !== "mock" && apiKey ? "real" : "mock");
  return createModelConfig({ ...input, mode: requestedMode, provider, apiKey, model, baseURL });
}

// Returns a provider instance.
//
// Selection is EXPLICIT-ONLY: a provider is chosen by name, never inferred.
//   * provider === "hunyuan" AND a key is present → HunyuanProvider
//   * anything else (incl. "real" mode with an unknown name) → MockProvider
// Falling back to mock on an unknown/credential-less request is deliberate:
// the Workbench must stay fully runnable offline (§4B.4 "如果没有真实凭证,
// 不要阻塞项目").
export function createProvider(config) {
  const cfg = config || {};
  if (cfg.provider === "hunyuan" && cfg.mode === "real" && cfg.apiKey) {
    const p = new HunyuanProvider(cfg);
    if (p.usable) return p;
  }
  return new MockProvider(cfg);
}

export function createAIClient(input = {}) {
  const config = input.config && input.config.provider ? input.config : resolveProviderConfig(input);
  const provider = createProvider(config);
  const budget = createTokenBudget(input.budget || {});
  const cache = input.cache || createResponseCache();
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
