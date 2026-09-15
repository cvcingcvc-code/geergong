// Gorgon 审核后台 — Review Data Adapter (Human Review Loop PHASE 2)。
//
//   window.GORGON_REVIEW_QUEUE 存在且非空 -> 使用 pipeline 真实 review queue
//   否则                                 -> 保持 queue.js 的 DEMO 队列不变
//
// pipeline 数据由 `python pipeline/run.py` 生成到 generated-review-data.js，
// 不通过 fetch 读本地 JSON（file:// 与跨路径环境容易出问题）。

(function () {
  var items = window.GORGON_REVIEW_QUEUE;
  if (!Array.isArray(items) || items.length === 0) return; // fallback: queue.js
  if (!window.GORGON_QUEUE || typeof window.GORGON_QUEUE !== "object") return;

  var summary = window.GORGON_REVIEW_SUMMARY || {};
  var total = (summary.approved || 0) + (summary.needs_review || 0) + (summary.low_confidence || 0) || items.length;

  window.GORGON_QUEUE = {
    fromPipeline: true,
    stats: {
      pending: items.length,
      autoPassRate: total ? (summary.approved || 0) / total : 0,
      todayReviewed: 0,
      sources: items.map(function (i) { return i.source; }).filter(function (s, idx, arr) { return arr.indexOf(s) === idx; }).length,
    },
    items: items,
  };
})();
