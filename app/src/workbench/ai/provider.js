// AIProvider contract — the unified interface every model adapter implements.
//
// All providers expose a single synchronous-or-async `generate(request)` and return
// a normalized response. There is deliberately NO internal recursion, no agent loop,
// no "AI calling AI" — one call in, one response out.
//
// Request: { taskId?, purpose, input, maxTokens? }
// Response (ok):    { ok:true, content, provider, model, purpose, usage:{inputTokens,outputTokens}, cached }
// Response (error): { ok:false, error:{ code, message } }

export const AI_PURPOSES = Object.freeze([
  "summarize",
  "extract",
  "plan",
  "generate",
  "route",
]);

export function normalizePurpose(purpose) {
  return AI_PURPOSES.includes(purpose) ? purpose : "generate";
}

export function createAIResponse({
  content = "",
  provider = "mock",
  model = "mock-model",
  purpose = "generate",
  usage = {},
  cached = false,
} = {}) {
  return {
    ok: true,
    content: typeof content === "string" ? content : "",
    provider,
    model,
    purpose: normalizePurpose(purpose),
    usage: {
      inputTokens: Number(usage.inputTokens) || 0,
      outputTokens: Number(usage.outputTokens) || 0,
    },
    cached: Boolean(cached),
  };
}

export function createAIError(code, message) {
  return {
    ok: false,
    error: {
      code: typeof code === "string" ? code : "AI_ERROR",
      message: typeof message === "string" ? message : "unknown error",
    },
  };
}

export class AIProvider {
  constructor(config = {}) {
    this.config = config;
  }

  // Subclasses MUST override. Single call, no recursion.
  async generate(/* request */) {
    throw new Error("AIProvider.generate() must be implemented by a subclass");
  }
}
