// Gorgon Workbench — Search Skill (Phase 3, REAL retrieval reuse).
//
// This skill REUSES the existing Gorgon search capability — it does NOT
// implement a second search client (§9/§33). The actual network call lives
// in app/src/lib/api.js (`searchActivities`, the single API layer used by
// NaturalSearchScreen). The Runner injects that function as `deps.search`,
// so the skill can be unit-tested with a mock and the browser reuses the one
// real client. Only if no `deps.search` is supplied do we lazily import the
// real api module (never in tests, always in standalone use).
//
// Failure is HONEST (§12): unavailable API or provider error is reported as a
// failed SkillResult with a clear code — we never fabricate "live" results,
// and if the backend returns demo data we surface `isDemo` so the UI can show
// the DEMO DATA badge.

import { createSkillResult, createSkillError, CAP_NETWORK_READ } from "./skill-base.js";

/** Defensive source normalization (§11). Never assumes activity-specific fields. */
function normalizeSource(item) {
  if (!item || typeof item !== "object") return null;
  const a = item.activity && typeof item.activity === "object" ? item.activity : item;
  const title =
    a.title || a.name || (typeof item.title === "string" ? item.title : "") || "未命名结果";
  const url = a.sourceUrl || a.registrationUrl || a.url || a.link || null;
  const provider = a.source || a.provider || a.origin || null;
  return { type: "search", title: String(title).trim(), url: url ? String(url) : null, provider: provider ? String(provider) : null };
}

function detectDemo(data) {
  if (!data || typeof data !== "object") return false;
  if (data.providerMode === "demo") return true;
  if (data.dataOrigin === "demo") return true;
  if (data.__source === "static") return true;
  const results = Array.isArray(data.results) ? data.results : [];
  return results.some((r) => r && r.dataOrigin === "demo");
}

async function loadDefaultSearch() {
  try {
    const m = await import("../lib/api.js");
    return m && typeof m.searchActivities === "function" ? m.searchActivities : null;
  } catch {
    return null;
  }
}

const searchSkill = {
  id: "search",
  name: "智能搜索",
  description: "复用 Gorgon 检索接口，从目标文本中查找活动 / 机会等信息。",
  capabilities: CAP_NETWORK_READ,

  canHandle(ctx) {
    const g = (ctx && ctx.goal) || "";
    const hit = /找|搜索|查询|哪里|有哪些|活动|机会|黑客松|比赛|附近|最近|检索|搜/.test(g);
    return { ok: hit, confidence: hit ? 0.92 : 0 };
  },

  /**
   * @param {object} ctx  { goal, previousResults?, task?, metadata? }
   * @param {object} deps { search?, maxResults?, now? }
   *   deps.search: (query) => Promise<{kind,data}|{kind:'error'}|{kind:'unavailable'}>
   */
  async execute(ctx = {}, deps = {}) {
    const goal = (ctx && ctx.goal) || "";
    if (!goal || !goal.trim()) {
      return createSkillError("search", "SEARCH_EMPTY_GOAL", "未提供搜索目标");
    }

    const search = deps.search || (await loadDefaultSearch());
    if (typeof search !== "function") {
      return createSkillError("search", "SEARCH_NOT_CONFIGURED", "搜索后端未配置");
    }

    let resp;
    try {
      resp = await search({ query: goal, maxResults: deps.maxResults || 30 });
    } catch (e) {
      return createSkillError("search", "SEARCH_PROVIDER_ERROR", String((e && e.message) || e));
    }

    if (!resp || resp.kind === "unavailable") {
      return createSkillError("search", "SEARCH_OFFLINE", "检索服务不可用（未连接 / 离线）");
    }
    if (resp.kind === "error") {
      return createSkillError("search", "SEARCH_API_ERROR", resp.detail || `检索失败（HTTP ${resp.status}）`);
    }

    // kind === "ok"
    const data = resp.data || {};
    const results = Array.isArray(data.results) ? data.results : [];
    const sources = results.map(normalizeSource).filter(Boolean);
    const isDemo = detectDemo(data);
    const count = results.length;

    const summary = isDemo
      ? `（DEMO 数据）找到 ${count} 个相关结果`
      : `找到 ${count} 个相关结果`;

    return createSkillResult("search", {
      summary,
      sources,
      result: { type: "search_results", content: results },
      metadata: {
        method: "api",
        isDemo,
        providerMode: data.providerMode || null,
        summary: data.summary || null,
        rawCount: count,
      },
    });
  },
};

export default searchSkill;
