// Gorgon Workbench — AI Eligibility Gate (Phase 4B.1).
//
// PURE FUNCTION. No network, no provider, no localStorage, no React (§5).
//
// The single question this module answers: "may this step call a model?"
// The default answer is NO. A step may only reach a model when ALL of the
// following hold:
//
//   1. the skill is on the AI-ALLOWED list (search is NOT on it, ever)
//   2. the step is not trivially solvable by deterministic code
//   3. the input is big / complex enough to be worth a model call
//   4. the budget still allows a call
//   5. AI is enabled by the caller
//
// Anything else returns eligible:false with a machine-readable reason, so the
// UI can honestly say "本地处理" instead of silently pretending a model ran.

/** Purposes the gate is allowed to bless (§4B.3). "route" is absent on purpose. */
export const AI_ALLOWED_PURPOSES = Object.freeze([
  "summarize",
  "extract",
  "plan",
  "generate",
]);

/**
 * Skills that must NEVER call a model (§4B.2). These are the ones that make
 * the competition demo believable: search, date/price/region parsing, dedupe,
 * trust scoring, schema validation and task state transitions stay local, so
 * a plain "找上海 AI 活动" run has AI_CALLS = 0.
 */
export const AI_FORBIDDEN_SKILLS = Object.freeze([
  "search",
  "trust",
  "dedupe",
  "validate",
  "state",
  "route",
]);

/** Input at or above this length is considered "long" → worth a model. */
export const LONG_INPUT_CHARS = 1200;

/** Below this length a summarize is trivially extractive → stay local. */
export const SHORT_INPUT_CHARS = 400;

/** Deterministic confidence at/above this → the rules already handled it. */
export const HIGH_CONFIDENCE = 0.8;

/** Machine-readable reasons. Stable strings — UI + tests both rely on them. */
export const AI_REASONS = Object.freeze({
  AI_DISABLED: "AI_DISABLED",
  SKILL_FORBIDDEN: "SKILL_FORBIDDEN",
  SKILL_NOT_ALLOWED: "SKILL_NOT_ALLOWED",
  EMPTY_INPUT: "EMPTY_INPUT",
  INPUT_TOO_SHORT: "INPUT_TOO_SHORT",
  DETERMINISTIC_SUFFICIENT: "DETERMINISTIC_SUFFICIENT",
  BUDGET_EXCEEDED: "BUDGET_EXCEEDED",
  ELIGIBLE_COMPLEX: "ELIGIBLE_COMPLEX",
  ELIGIBLE_LONG_INPUT: "ELIGIBLE_LONG_INPUT",
  ELIGIBLE_UNKNOWN_INTENT: "ELIGIBLE_UNKNOWN_INTENT",
});

const COMPLEX_MARKERS = [
  "比较", "对比", "评估", "权衡", "优缺点", "风险", "分析", "解读", "为什么", "原因",
  "整理成", "归纳", "提炼", "深度", "详细", "润色", "改写", "扩写", "摘要", "总结",
  "制定", "规划", "策略", "方案", "步骤", "如何", "怎么", "帮我写", "起草",
];

function hasComplexityMarker(text) {
  return COMPLEX_MARKERS.some((m) => text.includes(m));
}

/** Rough token estimate. Deliberately cheap and stable — never exact billing. */
export function estimateCost(input) {
  const text = typeof input === "string" ? input : "";
  // CJK ≈ 1 token/char, ASCII ≈ 1 token per 4 chars. Good enough for a gate.
  const cjk = (text.match(/[一-龥]/g) || []).length;
  const rest = Math.max(0, text.length - cjk);
  const inputTokens = cjk + Math.ceil(rest / 4);
  return { inputTokens, outputTokens: Math.min(2000, Math.ceil(inputTokens / 2)) };
}

/**
 * Decide whether a step may call a model.
 *
 * @param {object} ctx
 *   skill                  : string  — skill id about to run
 *   purpose                : string  — model purpose it would request
 *   input                  : string  — the text it would send
 *   intent                 : string  — router intent ("unknown" ⇒ eligible fallback)
 *   deterministicConfidence: number  — 0..1, how well local rules handled it
 *   previousFailure        : boolean — a prior attempt already failed
 *   budget                 : { maxCalls, usedCalls, maxInputTokens }
 *   aiEnabled              : boolean — master switch (default true)
 * @returns {{eligible:boolean, reason:string, purpose:string,
 *            estimatedCost:{inputTokens:number, outputTokens:number}}}
 */
export function shouldUseAI(ctx = {}) {
  const {
    skill = "",
    purpose = "generate",
    input = "",
    intent = "",
    deterministicConfidence = 0,
    previousFailure = false,
    budget = null,
    aiEnabled = true,
  } = ctx;

  const est = estimateCost(input);
  const deny = (reason) => ({
    eligible: false,
    reason,
    purpose: "",
    estimatedCost: { inputTokens: 0, outputTokens: 0 },
  });

  // 1. Master switch.
  if (!aiEnabled) return deny(AI_REASONS.AI_DISABLED);

  // 2. Skills that must never touch a model — this is the demo-critical rule.
  if (AI_FORBIDDEN_SKILLS.indexOf(skill) >= 0) return deny(AI_REASONS.SKILL_FORBIDDEN);

  // 3. Only the four blessed purposes (§4B.3).
  if (AI_ALLOWED_PURPOSES.indexOf(purpose) < 0) return deny(AI_REASONS.SKILL_NOT_ALLOWED);

  // 4. Nothing to send.
  const text = typeof input === "string" ? input : "";
  if (text.trim() === "") return deny(AI_REASONS.EMPTY_INPUT);

  // 5. Budget is a hard stop, checked before any complexity reasoning so an
  //    exhausted task never even considers a call.
  if (budget) {
    const used = Number(budget.usedCalls) || 0;
    const max = Number(budget.maxCalls);
    if (Number.isFinite(max) && used >= max) return deny(AI_REASONS.BUDGET_EXCEEDED);
    const maxIn = Number(budget.maxInputTokens);
    if (Number.isFinite(maxIn) && est.inputTokens > maxIn) return deny(AI_REASONS.BUDGET_EXCEEDED);
  }

  const allow = (reason) => ({ eligible: true, reason, purpose, estimatedCost: est });

  // 6. A previous deterministic attempt already failed → a model is the
  //    documented next step (and stays inside budget because of check 5).
  if (previousFailure === true) return allow(AI_REASONS.ELIGIBLE_COMPLEX);

  // 7. Router could not understand the goal → "unknown intent fallback" is one
  //    of the explicitly allowed AI scenarios (§4B.3).
  if (intent === "unknown") return allow(AI_REASONS.ELIGIBLE_UNKNOWN_INTENT);

  // 8. The local rules were confident → they already did the job.
  if (Number(deterministicConfidence) >= HIGH_CONFIDENCE && text.length < LONG_INPUT_CHARS) {
    return deny(AI_REASONS.DETERMINISTIC_SUFFICIENT);
  }

  // 9. Long input → genuinely too much for extractive summarization.
  if (text.length >= LONG_INPUT_CHARS) return allow(AI_REASONS.ELIGIBLE_LONG_INPUT);

  // 10. Short input that no local rule handled well.
  if (Number(deterministicConfidence) < HIGH_CONFIDENCE && hasComplexityMarker(text)) {
    return allow(AI_REASONS.ELIGIBLE_COMPLEX);
  }

  // 11. Very short and no complexity signal → local extractive is fine.
  if (text.length < SHORT_INPUT_CHARS) return deny(AI_REASONS.INPUT_TOO_SHORT);

  return allow(AI_REASONS.ELIGIBLE_COMPLEX);
}

export default shouldUseAI;
