// Gorgon Workbench — Skill Contract (Phase 3).
//
// Every Skill — whether deterministic (Phase 3) or LLM-backed (Phase 4) —
// MUST speak this ONE result shape. Skills NEVER touch the Task layer
// directly (§3): they only return a SkillResult, and the Task Runner writes
// it into the repository. That keeps Phase 4's LLM skills from ever
// corrupting Task state.
//
// A Skill object:
//   {
//     id: string,
//     name: string,            // short human label (Chinese)
//     description: string,     // what it does, for the manual picker / docs
//     capabilities: {          // for Phase-6 review routing (§31)
//       network: boolean,
//       writeExternal: boolean,
//       requiresReview: boolean,
//     },
//     canHandle(context) -> { ok: boolean, confidence: number },  // optional hint
//     execute(context, deps) -> SkillResult | Promise<SkillResult>,
//   }
//
// SkillResult (success):
//   { ok: true, skillId, summary, steps: [], sources: [], result, metadata }
// SkillResult (failure):
//   { ok: false, skillId, error: { code, message }, metadata }

export const SKILL_CONTRACT_VERSION = "1.0";

/** Build a successful SkillResult. `result` should match task-model makeResult. */
export function createSkillResult(skillId, { summary, steps = [], sources = [], result, metadata = {} } = {}) {
  return {
    ok: true,
    skillId,
    summary: typeof summary === "string" ? summary : "",
    steps: Array.isArray(steps) ? steps : [],
    sources: Array.isArray(sources) ? sources : [],
    result: result == null ? null : result,
    metadata: metadata && typeof metadata === "object" ? metadata : {},
  };
}

/** Build a failed SkillResult. */
export function createSkillError(skillId, code, message, metadata = {}) {
  return {
    ok: false,
    skillId,
    error: {
      code: typeof code === "string" ? code : "SKILL_ERROR",
      message: typeof message === "string" ? message : String(message || "未知错误"),
    },
    metadata: metadata && typeof metadata === "object" ? metadata : {},
  };
}

/** Capability presets. Local transforms have no network / no external write. */
export const CAP_LOCAL = { network: false, writeExternal: false, requiresReview: false };
export const CAP_NETWORK_READ = { network: true, writeExternal: false, requiresReview: false };
