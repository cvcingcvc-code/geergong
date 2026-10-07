// TokenBudget — per-task hard ceiling on AI usage.
//
// Goal is NOT precise billing. Goal is to make infinite model loops impossible:
// a task can call the model at most MAX_AI_CALLS_PER_TASK times, and cannot exceed
// configured input/output token ceilings.

export const DEFAULT_AI_BUDGET = Object.freeze({
  MAX_AI_CALLS_PER_TASK: 3,
  MAX_INPUT_TOKENS: 8000,
  MAX_OUTPUT_TOKENS: 4000,
});

export function createTokenBudget(overrides = {}) {
  const maxCalls =
    overrides.maxCalls != null ? overrides.maxCalls : DEFAULT_AI_BUDGET.MAX_AI_CALLS_PER_TASK;
  const maxInputTokens =
    overrides.maxInputTokens != null
      ? overrides.maxInputTokens
      : DEFAULT_AI_BUDGET.MAX_INPUT_TOKENS;
  const maxOutputTokens =
    overrides.maxOutputTokens != null
      ? overrides.maxOutputTokens
      : DEFAULT_AI_BUDGET.MAX_OUTPUT_TOKENS;
  return {
    maxCalls,
    maxInputTokens,
    maxOutputTokens,
    usedCalls: 0,
    usedInputTokens: 0,
    usedOutputTokens: 0,
  };
}

// Returns true only if a call is currently permitted.
export function budgetCanCall(budget, request) {
  if (budget.usedCalls >= budget.maxCalls) return false;
  const estInput =
    request && typeof request.input === "string" ? request.input.length : 0;
  if (estInput > budget.maxInputTokens) return false;
  return true;
}

// Records one call (and its token usage) against the budget. Returns the budget.
export function budgetConsume(budget, usage = {}) {
  budget.usedCalls += 1;
  budget.usedInputTokens += Number(usage.inputTokens) || 0;
  budget.usedOutputTokens += Number(usage.outputTokens) || 0;
  return budget;
}
