// Gorgon Workbench — Extract Skill (Phase 3, deterministic).
//
// Local, regex-based structured extraction. NO NLP library, NO network,
// NO LLM. Pulls simple, well-formed facts out of free text or a previous
// step's text result: dates, times, URLs, amounts, emails, phone numbers,
// and obvious todo lines. Anything semantically ambiguous is left UNRECOGNIZED
// (empty arrays + a clear "未识别" summary) rather than guessed (§14).

import { createSkillResult, createSkillError, CAP_LOCAL } from "./skill-base.js";

// ── regex kit (deterministic, order-stable) ───────────────────────────────
const RE = {
  isoDate: /\b\d{4}[-\/]\d{1,2}[-\/]\d{1,2}\b/g,
  slashDate: /\b\d{1,2}[\/．.]\d{1,2}\b/g, // 10/12  (no year)
  cnDate: /(\d{1,2})\s*月\s*(\d{1,2})\s*日?/g, // 10月12日 / 10月12
  relDate: /(今天|今天晚上|明天|明早|明晚|后天|大后天|本周|这周末|本周末|下周|下周末|下周三|下周四|下周五|下周一|下周二)(?![一-日])/g, // 明天 / 下周 …
  hhmm: /\b\d{1,2}:\d{2}\b/g, // 15:00
  cnTime: /([上下早晚]午\s*)?(\d{1,2})\s*点\s*(半|钟|钟左右)?/g, // 下午3点 / 3点半
  url: /\bhttps?:\/\/[^\s，。、）)】」]+/gi,
  amount: /[¥￥$]\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*(?:元|块|块钱|万元?|美元|欧元)/g,
  email: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  phone: /\b1[3-9]\d{9}\b/g,
};

function uniq(arr) {
  return Array.from(new Set(arr.map((s) => String(s).trim()).filter(Boolean)));
}

function extractDates(text) {
  const out = [];
  let m;
  while ((m = RE.isoDate.exec(text))) out.push(m[0].replace(/\//g, "-"));
  while ((m = RE.slashDate.exec(text))) out.push(m[0]);
  while ((m = RE.cnDate.exec(text))) out.push(`${m[1]}月${m[2]}日`);
  while ((m = RE.relDate.exec(text))) out.push(m[0]);
  return uniq(out);
}

function extractTimes(text) {
  const out = [];
  let m;
  while ((m = RE.hhmm.exec(text))) out.push(m[0]);
  while ((m = RE.cnTime.exec(text))) {
    const period = m[1] ? m[1].trim() : "";
    const h = m[2];
    const half = m[3] === "半" ? "半" : "";
    out.push(`${period}${h}点${half}`.trim());
  }
  return uniq(out);
}

function extractTodos(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out = [];
  for (const l of lines) {
    // A line is a todo only if it LEADS with a marker; a bare `✅?\s*` would
    // match an empty prefix and swallow every line, so it is not allowed.
    const m = l.match(/^(?:[-*·]\s+|待办[:：]|TODO[:：]|任务[:：]|【待办】|✅\s*)(.*)$/i);
    if (m) {
      const rest = m[1].trim();
      if (rest) out.push(rest);
    } else if (/待办/.test(l)) {
      out.push(l.replace(/待办/g, "").trim());
    }
  }
  return out;
}

/** Public, pure extraction used by both the skill and unit tests. */
export function extractStructured(text) {
  const t = typeof text === "string" ? text : "";
  const dates = extractDates(t);
  const times = extractTimes(t);
  const urls = uniq(t.match(RE.url) || []);
  // Normalize amounts to a compact form (e.g. "500 元" -> "500元") per §14.
  const amounts = uniq((t.match(RE.amount) || []).map((s) => s.replace(/\s+/g, "")));
  const emails = uniq(t.match(RE.email) || []);
  const phones = uniq(t.match(RE.phone) || []);
  const todos = extractTodos(t);
  return { dates, times, urls, amounts, emails, phones, todos };
}

function describe(data) {
  const parts = [];
  if (data.dates.length) parts.push(`${data.dates.length} 个日期`);
  if (data.times.length) parts.push(`${data.times.length} 个时间`);
  if (data.urls.length) parts.push(`${data.urls.length} 个链接`);
  if (data.amounts.length) parts.push(`${data.amounts.length} 个金额`);
  if (data.emails.length) parts.push(`${data.emails.length} 个邮箱`);
  if (data.phones.length) parts.push(`${data.phones.length} 个电话`);
  if (data.todos.length) parts.push(`${data.todos.length} 条待办`);
  return parts;
}

const extractSkill = {
  id: "extract",
  name: "本地提取",
  description: "从文本中确定性地提取日期、时间、链接、金额、邮箱、电话与待办项（正则，无模型）。",
  capabilities: CAP_LOCAL,

  canHandle(ctx) {
    const g = (ctx && ctx.goal) || "";
    const hit = /提取|找出|列出日期|联系人|截止时间|地址|金额|链接|待办|抓取/.test(g);
    return { ok: hit, confidence: hit ? 0.85 : 0 };
  },

  // context: { goal, text?, previousResults?, task?, metadata? }
  // text 优先来自 context.text，否则用 goal；previousResults 命中则合并它们的文本。
  execute(ctx = {}) {
    const prevText = (ctx.previousResults || [])
      .map((r) => (r && r.result && typeof r.result.content === "string" ? r.result.content : ""))
      .join("\n");
    const text = (ctx.text != null ? ctx.text : ctx.goal) || "";
    const data = extractStructured(text + "\n" + prevText);

    const parts = describe(data);
    const summary = parts.length
      ? `本地提取到：${parts.join("、")}`
      : "未识别到结构化信息（已如实返回空结果，未猜测）";

    return createSkillResult("extract", {
      summary,
      result: { type: "json", content: data },
      metadata: { method: "regex", recognized: parts.length },
    });
  },
};

export const extractSkillObject = extractSkill;
export default extractSkill;
