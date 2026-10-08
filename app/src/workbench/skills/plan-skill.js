// Gorgon Workbench — Plan Skill (Phase 3, deterministic template).
//
// NO AI plan generation. Produces a fixed, rule-based action template.
//   * If a previous step produced search_results, the plan is tailored to act
//     on those candidates (look → verify → choose → act).
//   * Otherwise a generic 5-step template is returned.
// UI must label this "本地规划" / "规则生成", never "AI 规划" (§16/§46).

import { createSkillResult, CAP_LOCAL } from "./skill-base.js";
import { withAiAssist } from "../ai/assist.js";

const GENERIC_PLAN = [
  "明确目标与验收标准",
  "收集必要的资料与信息",
  "将工作拆分成可执行的主要步骤",
  "按顺序执行关键任务",
  "检查结果是否达成目标",
];

function planFromSearch(count) {
  const shown = Math.min(3, count || 0);
  const steps = [];
  if (shown > 0) steps.push(`查看排名靠前的 ${shown} 个候选`);
  steps.push("核对活动时间与报名 / 参与要求");
  steps.push("结合你的偏好选择最合适的一项");
  steps.push("完成报名或准备事项，并记录关键信息");
  return steps;
}

/** Public, pure planner used by the skill and by unit tests. */
export function buildPlan({ previousResults = [] } = {}) {
  const search = (previousResults || []).find(
    (r) => r && r.result && r.result.type === "search_results" &&
      Array.isArray(r.result.content) && r.result.content.length > 0
  );
  if (search) {
    return { steps: planFromSearch(search.result.content.length), source: "search_results", method: "rule_based" };
  }
  return { steps: GENERIC_PLAN.slice(), source: "generic", method: "rule_based" };
}

const planSkill = {
  id: "plan",
  name: "本地规划",
  description: "基于规则生成行动步骤模板，可结合上一步的检索结果。",
  capabilities: CAP_LOCAL,

  canHandle(ctx) {
    const g = (ctx && ctx.goal) || "";
    const hit = /计划|规划|安排|拆解|步骤|怎么做|行动方案|路线图/.test(g);
    return { ok: hit, confidence: hit ? 0.85 : 0 };
  },

  execute(ctx = {}, deps = {}) {
    // Plan NEVER re-searches: it consumes the previous step's search results
    // (buildPlan already does this, and metadata.source records it).
    const { steps, source } = buildPlan({ previousResults: ctx.previousResults || [] });
    const summary = `已生成 ${steps.length} 步行动计划（基于${source === "search_results" ? "检索结果" : "通用模板"}）`;

    const deterministic = () =>
      createSkillResult("plan", {
        summary,
        result: { type: "plan", content: steps },
        metadata: { method: "rule_based", source },
      });

    // The plan input is the goal + the candidates we already have. A generic
    // (no search results) plan is rule-based with high confidence; a plan built
    // on real candidates is complex enough for the gate to consider AI.
    const input = `${(ctx.goal || "")}\n${steps.join("\n")}`;
    return withAiAssist({
      skill: "plan",
      purpose: "plan",
      input,
      intent: (ctx.task && ctx.task.metadata && ctx.task.metadata.router && ctx.task.metadata.router.intent) || "",
      deps,
      deterministic,
      confidence: source === "search_results" ? 0.6 : 0.9,
      method: "rule_based",
      extra: { source },
    });
  },
};

export { planSkill };
export default planSkill;
