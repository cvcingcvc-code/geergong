// Gorgon Workbench — Skill AI Assist bridge (Phase 5).
//
// One helper every AI-capable Skill calls, so the gate + client + fallback
// chain is applied IDENTICALLY across extract / summarize / plan / write.
// Skills keep their deterministic behaviour as the default and only reach a
// model through this bridge.
//
// Two honesty rules are enforced here:
//
//   1. No client ⇒ no AI. `deps.aiClient` is opt-in. A task that never
//      configured a provider is 100% deterministic, which is exactly what the
//      competition demo needs (and what keeps a mock provider from degrading
//      good local output into canned text).
//   2. `aiAssisted` is only true for a REAL model. When the effective provider
//      is the offline MockProvider we report aiAssisted:false +
//      simulated:true, so the UI can never claim "AI Assisted" for output no
//      model actually produced.

import { runWithFallback } from "./fallback.js";
import { shouldUseAI } from "./eligibility.js";

/** Providers that are real, network-backed models. */
const REAL_PROVIDERS = new Set(["hunyuan", "deepseek", "openai", "qwen", "glm", "moonshot"]);

/** Build the metadata block the UI renders as 本地处理 / AI Assisted. */
function buildMeta({ outcome, method, gate, extra = {} }) {
  const realProvider = outcome.aiAssisted && REAL_PROVIDERS.has(outcome.provider);
  return {
    // `method` stays the deterministic method name (local_extractive / regex /
    // rule_based / template) so existing UI + tests keep working.
    method,
    aiAssisted: Boolean(realProvider),
    // A mock/unknown provider ran, but no real model did. Surfaced, not hidden.
    simulated: Boolean(outcome.aiAssisted && !realProvider),
    aiProvider: realProvider ? outcome.provider : null,
    aiModel: realProvider ? outcome.model : null,
    aiCached: Boolean(outcome.cached),
    aiUsage: outcome.usage || { inputTokens: 0, outputTokens: 0 },
    aiUsageTotal:
      (outcome.usage ? outcome.usage.inputTokens + outcome.usage.outputTokens : 0) || 0,
    aiReason: outcome.aiReason || null,
    aiFallbackReason: outcome.fallbackReason || null,
    ...extra,
  };
}

/**
 * Run a Skill's deterministic implementation, optionally upgrading it to an
 * AI-assisted result.
 *
 * @param {object} opts
 *   skill       : string  — the skill id (drives the gate)
 *   purpose     : string  — model purpose this step would request
 *   input       : string  — text that would be sent
 *   intent      : string  — router intent
 *   deps        : object  — runner deps; `deps.aiClient` is OPT-IN
 *   deterministic : () => SkillResult   — the always-available local path
 *   confidence  : number  — deterministic confidence (default 0)
 *   previousFailure : boolean
 *   method      : string  — deterministic method label
 *   extra       : object  — merged into metadata
 * @returns {SkillResult | Promise<SkillResult>} — a plain SkillResult whenever
 *          no model call happens, so a Skill stays synchronous in the common
 *          (offline) case and existing sync callers keep working. Only a real
 *          AI upgrade returns a Promise.
 */
export function withAiAssist(opts) {
  const {
    skill,
    purpose,
    input,
    intent = "",
    deps = {},
    deterministic,
    confidence = 0,
    previousFailure = false,
    method,
    extra = {},
  } = opts;

  const det = typeof deterministic === "function" ? deterministic() : null;

  // Nothing to assist, or the caller opted out entirely.
  if (!det || !det.ok) return det;

  // Peek at the gate so the deterministic metadata can record WHY it stayed
  // local — that is what makes the UI's "本地处理" badge truthful.
  const gate = shouldUseAI({
    skill,
    purpose,
    input,
    intent,
    deterministicConfidence: confidence,
    previousFailure,
    budget: deps.aiClient && typeof deps.aiClient.budget === "object" ? deps.aiClient.budget : null,
  });

  const wantsAi = gate.eligible && deps.aiClient && typeof deps.aiClient.generate === "function";
  if (!wantsAi) {
    const meta = buildMeta({
      outcome: { aiAssisted: false, provider: null, model: null, cached: false, usage: { inputTokens: 0, outputTokens: 0 }, fallbackReason: null, aiReason: gate.reason },
      method,
      gate,
      extra,
    });
    return { ...det, metadata: { ...det.metadata, ...meta } };
  }

  // Only a real model upgrade needs the async chain; keep it a returned
  // Promise (not `await`) so the offline path above stays synchronous.
  return runWithFallback({
    gate,
    decision: gate,
    client: deps.aiClient,
    deterministic,
    input,
  }).then((outcome) => {
    const meta = buildMeta({ outcome, method, gate, extra });

    // CRITICAL: only a REAL model may replace the result content. The offline
    // MockProvider exists to exercise the interface — if its canned text were
    // allowed to overwrite good deterministic output, an unconfigured task
    // would silently degrade (e.g. a tailored 4-step plan replaced by mock
    // filler). So a non-real provider is *recorded* (simulated:true) but its
    // content is discarded and the local result is kept.
    const realProvider = outcome.aiAssisted && REAL_PROVIDERS.has(outcome.provider);
    const hasUsableContent =
      outcome.ok && outcome.result && typeof outcome.result.content === "string" && outcome.result.content.trim();

    if (realProvider && hasUsableContent) {
      return {
        ...det,
        summary: `AI 辅助${method === "template" ? "写作" : "处理"}完成`,
        result: { ...det.result, content: outcome.result.content },
        metadata: { ...det.metadata, ...meta },
      };
    }

    // Otherwise keep the deterministic result, labelled honestly.
    return { ...det, metadata: { ...det.metadata, ...meta } };
  });
}

export default withAiAssist;
