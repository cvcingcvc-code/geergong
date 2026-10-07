// Gorgon Workbench — Task Router (Phase 3, deterministic).
//
// PURE FUNCTION. No API, no localStorage, no React, no LLM (§5). Given a goal
// it returns which Skills should run, in a stable, reproducible order, with a
// human-readable rationale. If nothing matches it returns intent="unknown"
// and an EMPTY skillIds list — it NEVER guesses (§8).
//
// Rules are simple keyword triggers (§6). The same input ALWAYS yields the
// same output (tested in §37). Multi-skill goals (e.g. "找到…并制定计划")
// union the matched skills; ties are broken by a fixed PRIORITY so the order
// is deterministic. The result is capped at MAX_SKILLS_PER_TASK (§7/§48).

import { SKILL_IDS } from "./skills/registry.js";

export const MAX_SKILLS_PER_TASK = 3;

// Fixed keyword tables. Order here defines the canonical output order.
const RULES = [
  {
    id: "search",
    keywords: ["找", "搜索", "查一下", "查询", "哪里", "有哪些", "活动", "机会", "黑客松", "比赛", "附近", "最近", "检索", "搜"],
  },
  {
    id: "extract",
    keywords: ["提取", "找出", "列出日期", "联系人", "截止时间", "地址", "金额", "链接", "待办", "抓取"],
  },
  {
    id: "summarize",
    keywords: ["总结", "概括", "整理重点", "提炼", "摘要", "归纳"],
  },
  {
    id: "plan",
    keywords: ["计划", "规划", "安排", "拆解", "步骤", "怎么做", "行动方案", "路线图"],
  },
  {
    id: "write",
    keywords: ["写", "生成文案", "起草", "草拟", "回复", "邮件", "总结稿", "拟"],
  },
];

// Lower number = higher priority when trimming to MAX_SKILLS_PER_TASK.
const PRIORITY = { search: 0, extract: 1, plan: 2, summarize: 3, write: 4 };

// Keep only the highest-priority skills when more than the cap are matched.
function trimToCap(skillIds, cap) {
  if (skillIds.length <= cap) return skillIds.slice();
  const sorted = skillIds.slice().sort((a, b) => (PRIORITY[a] ?? 99) - (PRIORITY[b] ?? 99));
  const kept = sorted.slice(0, cap);
  // restore canonical (RULES) order for the kept set
  return RULES.map((r) => r.id).filter((id) => kept.includes(id));
}

/**
 * Route a task goal to a set of skills.
 * @param {{goal?:string, metadata?:object}} input
 * @returns {{intent:string, skillIds:string[], confidence:number, reasons:string[]}}
 */
export function routeTask(input = {}) {
  const raw = String(input && input.goal ? input.goal : "");

  const matched = [];
  const reasons = [];

  // Filter RULES to those whose keywords actually appear (stable order).
  for (const rule of RULES) {
    const hits = rule.keywords.filter((k) => raw.includes(k));
    if (hits.length) {
      matched.push(rule.id);
      reasons.push(`检测到「${hits.join("、")}」→ ${rule.id}`);
    }
  }

  const trimmed = matched.length > MAX_SKILLS_PER_TASK;
  const skillIds = trimToCap(matched, MAX_SKILLS_PER_TASK);

  if (trimmed) {
    reasons.push(`命中 ${matched.length} 个能力，超过上限 ${MAX_SKILLS_PER_TASK}，仅保留优先级最高的 ${skillIds.length} 个`);
  }

  const intent =
    skillIds.length === 0 ? "unknown" : skillIds.length === 1 ? skillIds[0] : "workflow";

  // confidence: deterministic function of hit count; 0 when unknown.
  const confidence = skillIds.length ? Math.min(0.99, 0.7 + 0.08 * skillIds.length) : 0;

  return { intent, skillIds, confidence, reasons };
}

/** Validate a list of skill ids against the registry (used by manual selection). */
export function validateSkillIds(ids) {
  if (!Array.isArray(ids)) return [];
  return ids.filter((id) => SKILL_IDS.indexOf(id) >= 0);
}
