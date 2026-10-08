// Gorgon Workbench — Write Skill (Phase 3, template only).
//
// Template / local writing. Generates a structured work-log / report from the
// task goal + any collected sources. It does NOT write files, send mail, or
// touch any external system (§32) — "write" here means "produce text".
// UI must show "Template / Local", never "AI 写作" (§17/§46).

import { createSkillResult, CAP_LOCAL } from "./skill-base.js";
import { withAiAssist } from "../ai/assist.js";

function fmtNow(now) {
  if (typeof now === "function") {
    try { return now(); } catch { /* fall through */ }
  }
  if (typeof now === "string") return now;
  return new Date().toISOString();
}

/** Public, pure template writer used by the skill and by unit tests. */
export function renderWorkLog({ title, goal, sources = [], now } = {}) {
  const lines = [];
  lines.push(`# 工作记录：${title || goal || "未命名任务"}`);
  lines.push("");
  lines.push(`- 目标：${goal || ""}`);
  lines.push(`- 生成方式：本地模板（Template / Local，未调用模型）`);
  lines.push(`- 生成时间：${fmtNow(now)}`);
  if (Array.isArray(sources) && sources.length) {
    lines.push("");
    lines.push(`## 来源（${sources.length}）`);
    for (const s of sources) {
      const titleText = (s && s.title) || "未命名来源";
      const url = s && s.url ? ` — ${s.url}` : "";
      const provider = s && s.provider ? ` [${s.provider}]` : "";
      lines.push(`- ${titleText}${provider}${url}`);
    }
  }
  lines.push("");
  lines.push("## 正文");
  lines.push(goal || "");
  lines.push("");
  lines.push("> 本记录由模板生成，内容仅整理自上方目标与来源，未做任何外部写入。");
  return lines.join("\n");
}

const writeSkill = {
  id: "write",
  name: "模板写作",
  description: "根据目标与来源生成结构化的工作记录 / 汇报模板（本地模板，无外部写入）。",
  capabilities: CAP_LOCAL,

  canHandle(ctx) {
    const g = (ctx && ctx.goal) || "";
    const hit = /写|生成文案|起草|草拟|回复|邮件|总结稿|拟/.test(g);
    return { ok: hit, confidence: hit ? 0.85 : 0 };
  },

  // deps.now is optional; tests pass a fixed stamp for determinism.
  // Produces TEXT ONLY — this skill must never perform an external write (§32).
  execute(ctx = {}, deps = {}) {
    const goal = (ctx && ctx.goal) || "";
    const task = ctx && ctx.task;
    const title = (task && task.title) || goal.slice(0, 30) || "未命名任务";
    const sources = (ctx && ctx.previousSources) || [];

    const deterministic = () => {
      const content = renderWorkLog({ title, goal, sources, now: deps.now });
      return createSkillResult("write", {
        summary: "已生成模板工作记录（本地，无外部写入）",
        result: { type: "text", content },
        metadata: { method: "template", externalWrite: false },
      });
    };

    const input = [goal, ...sources.map((s) => (s && s.title) || "")].join("\n");
    return withAiAssist({
      skill: "write",
      purpose: "generate",
      input,
      intent: (ctx && ctx.task && ctx.task.metadata && ctx.task.metadata.router && ctx.task.metadata.router.intent) || "",
      deps,
      deterministic,
      confidence: 0.75,
      method: "template",
      // Hard guarantee: whatever happens, no external write is ever recorded.
      extra: { externalWrite: false },
    });
  },
};

export default writeSkill;
