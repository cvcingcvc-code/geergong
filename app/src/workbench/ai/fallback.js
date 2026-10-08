// Gorgon Workbench — AI Fallback Chain (Phase 4B.5).
//
// When a real provider fails (timeout / rate limit / network / unavailable),
// the Workbench MUST NOT crash and MUST NOT invent an AI answer. The chain is
//
//     cache  →  deterministic fallback  →  explicit failure
//
// and the *reason* is always carried through to the UI so a result is never
// mislabelled as AI-generated when it was actually produced locally.

import { shouldUseAI, AI_REASONS } from "./eligibility.js";

/** Error codes that mean "try the deterministic path", not "surface an error". */
export const RECOVERABLE_AI_ERRORS = Object.freeze([
  "AI_TIMEOUT",
  "AI_RATE_LIMITED",
  "AI_NETWORK_ERROR",
  "AI_PROVIDER_ERROR",
  "AI_NOT_CONFIGURED",
  "AI_EMPTY_RESPONSE",
]);

export function isRecoverable(code) {
  return RECOVERABLE_AI_ERRORS.indexOf(code) >= 0;
}

/**
 * Run one step through the full gate → model → fallback chain.
 *
 * @param {object} ctx
 *   gate      : eligibility context (see shouldUseAI)
 *   client    : AI client ({ generate }) — may be null when AI is unavailable
 *   deterministic : () => SkillResult-shaped fallback, run when AI cannot serve
 *   input     : string — the exact text that would be sent to the model
 * @returns {Promise<{ok:boolean, result?:object, aiAssisted:boolean,
 *                    provider:string|null, model:string|null, usage:object,
 *                    cached:boolean, fallbackReason:string|null, aiReason:string}>}
 */
export async function runWithFallback(ctx = {}) {
  const { client, deterministic, input = "" } = ctx;

  // `ctx.gate` is the gate's INPUT (context), matching shouldUseAI(ctx).
  // Callers may also pass an already-computed decision as `decision` to avoid
  // re-evaluating it; both are supported.
  const decision = ctx.decision && typeof ctx.decision.eligible === "boolean"
    ? ctx.decision
    : shouldUseAI(ctx.gate || {});

  // ── Gate says no → deterministic only, zero model calls. ──────────────
  if (!decision.eligible) {
    const det = typeof deterministic === "function" ? deterministic() : null;
    return {
      ok: Boolean(det && det.ok),
      result: det || null,
      aiAssisted: false,
      provider: null,
      model: null,
      usage: { inputTokens: 0, outputTokens: 0 },
      cached: false,
      fallbackReason: null,
      aiReason: decision.reason,
    };
  }

  // ── Gate says yes, but there is no usable client → deterministic. ────
  if (!client || typeof client.generate !== "function") {
    const det = typeof deterministic === "function" ? deterministic() : null;
    return {
      ok: Boolean(det && det.ok),
      result: det || null,
      aiAssisted: false,
      provider: null,
      model: null,
      usage: { inputTokens: 0, outputTokens: 0 },
      cached: false,
      fallbackReason: AI_REASONS.AI_DISABLED,
      aiReason: decision.reason,
    };
  }

  // ── Real call. Cache is handled inside the client. ────────────────────
  let res;
  try {
    res = await client.generate({ purpose: decision.purpose, input });
  } catch (e) {
    // A throwing provider must still not take the app down (§4B.5).
    res = { ok: false, error: { code: "AI_NETWORK_ERROR", message: String((e && e.message) || e) } };
  }

  if (res && res.ok) {
    return {
      ok: true,
      result: { content: res.content },
      aiAssisted: true,
      provider: res.provider || null,
      model: res.model || null,
      usage: res.usage || { inputTokens: 0, outputTokens: 0 },
      cached: Boolean(res.cached),
      fallbackReason: null,
      aiReason: decision.reason,
    };
  }

  const code = (res && res.error && res.error.code) || "AI_ERROR";

  // Recoverable → deterministic fallback. Non-recoverable (e.g. budget) →
  // deterministic too, but we record why, because a budget stop is a normal,
  // expected outcome rather than a provider fault.
  const det = typeof deterministic === "function" ? deterministic() : null;
  return {
    ok: Boolean(det && det.ok),
    result: det || null,
    aiAssisted: false,
    provider: null,
    model: null,
    usage: { inputTokens: 0, outputTokens: 0 },
    cached: false,
    fallbackReason: code,
    aiReason: decision.reason,
    aiError: { code, message: (res && res.error && res.error.message) || "" },
  };
}

export default runWithFallback;
