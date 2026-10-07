// Gorgon Workbench — Summarize Skill (Phase 3, deterministic).
//
// LOCAL EXTRACTIVE summary. NO LLM. The method is fully transparent:
//   1. split into sentences,   2. trim / drop empty,
//   3. score each sentence by term-frequency (Chinese + ASCII tokens),
//   4. pick the top 3–5 representatives, 5. keep ORIGINAL order.
// Very short text is returned unchanged. UI must label this "本地摘要",
// never "AI Summary" (§15/§46).

import { createSkillResult, CAP_LOCAL } from "./skill-base.js";

const STOP = new Set([
  "的", "了", "和", "与", "及", "在", "是", "我", "你", "他", "她", "它", "我们", "你们", "他们",
  "这个", "那个", "一个", "一些", "可以", "需要", "进行", "通过", "对于", "关于", "以及", "或者",
  "the", "a", "an", "and", "or", "to", "of", "in", "on", "for", "is", "are", "we", "you", "i",
  "。", "，", "、", "；", "：", "？", "！", "”", "“", "（", "）", "—", "…",
]);

function splitSentences(text) {
  const parts = String(text || "").split(/([。！？!?\n；;])/);
  const out = [];
  let buf = "";
  for (const p of parts) {
    buf += p;
    if (/[。！？!?\n；;]/.test(p)) {
      const t = buf.trim();
      if (t) out.push(t);
      buf = "";
    }
  }
  const tail = buf.trim();
  if (tail) out.push(tail);
  return out.filter(Boolean);
}

function tokenize(sentence) {
  const ascii = sentence.toLowerCase().match(/[a-z0-9][a-z0-9.+#@-]*/g) || [];
  const cjk = sentence.match(/[一-龥]/g) || [];
  return ascii.concat(cjk);
}

function scoreSentences(sentences) {
  const freq = new Map();
  for (const s of sentences) {
    for (const tk of tokenize(s)) {
      if (STOP.has(tk)) continue;
      freq.set(tk, (freq.get(tk) || 0) + 1);
    }
  }
  return sentences.map((s, i) => {
    let score = 0;
    const seen = new Set();
    for (const tk of tokenize(s)) {
      if (STOP.has(tk) || seen.has(tk)) continue;
      seen.add(tk);
      score += freq.get(tk) || 0;
    }
    // mild length bonus so non-trivial sentences win ties, but not dominate
    score += Math.min(s.length, 60) / 200;
    return { sentence: s, index: i, score };
  });
}

/** Public, pure summarizer used by the skill and by unit tests. */
export function localSummarize(text, { maxSentences = 5 } = {}) {
  const sentences = splitSentences(text);
  if (sentences.length <= 2) {
    return { summary: sentences.join("").trim() || "", sentences, method: "local_extractive", truncated: false };
  }
  const scored = scoreSentences(sentences);
  const k = Math.max(1, Math.min(maxSentences, Math.ceil(sentences.length / 2)));
  const top = scored
    .slice()
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .sort((a, b) => a.index - b.index)
    .map((x) => x.sentence);
  return {
    summary: top.join(""),
    sentences: top,
    method: "local_extractive",
    truncated: top.length < sentences.length,
    totalSentences: sentences.length,
    kept: top.length,
  };
}

export const summarizeSkill = {
  id: "summarize",
  name: "本地摘要",
  description: "基于词频的抽取式本地摘要，不调用任何模型。",
  capabilities: CAP_LOCAL,

  canHandle(ctx) {
    const g = (ctx && ctx.goal) || "";
    const hit = /总结|概括|整理重点|提炼|摘要|归纳/.test(g);
    return { ok: hit, confidence: hit ? 0.85 : 0 };
  },

  execute(ctx = {}) {
    const prevText = (ctx.previousResults || [])
      .map((r) => (r && r.result && typeof r.result.content === "string" ? r.result.content : ""))
      .join("\n");
    const text = (ctx.text != null ? ctx.text : ctx.goal) || "";
    const input = (text + "\n" + prevText).trim();
    if (!input) {
      return createSkillResult("summarize", {
        summary: "没有可摘要的内容",
        result: { type: "text", content: "" },
        metadata: { method: "local_extractive", empty: true },
      });
    }
    const out = localSummarize(input, { maxSentences: 5 });
    return createSkillResult("summarize", {
      summary: out.summary,
      result: { type: "text", content: out.summary },
      metadata: {
        method: "local_extractive",
        totalSentences: out.totalSentences,
        kept: out.kept,
        truncated: out.truncated,
      },
    });
  },
};

export default summarizeSkill;
