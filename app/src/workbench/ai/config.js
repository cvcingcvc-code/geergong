// ModelConfig — minimal AI provider configuration.
//
// Phase 4A (AI_PROVIDER_FOUNDATION): only the *configuration shape* lives here.
// No network access, no API key creation, no key guessing. A "real" mode is only
// ever honored when an explicit, non-empty key is supplied by the caller; otherwise
// the effective mode is downgraded to "mock" so the system can never silently call
// a paid endpoint.

export const AI_MODE = Object.freeze({ MOCK: "mock", REAL: "real" });

export function createModelConfig(input = {}) {
  const requested = input.mode === "real" ? AI_MODE.REAL : AI_MODE.MOCK;
  const hasKey = typeof input.apiKey === "string" && input.apiKey.length > 0;

  // Hard rule: real mode REQUIRES a real key. Without it we stay in mock.
  const effectiveMode = requested === "real" && hasKey ? AI_MODE.REAL : AI_MODE.MOCK;

  return {
    mode: effectiveMode,
    provider: typeof input.provider === "string" ? input.provider : "mock",
    model: typeof input.model === "string" ? input.model : "mock-model",
    // Keys are passed through verbatim but only retained in REAL mode.
    apiKey: effectiveMode === "real" ? input.apiKey : "",
    baseURL: typeof input.baseURL === "string" ? input.baseURL : "",
    enabled: input.enabled !== false,
  };
}
