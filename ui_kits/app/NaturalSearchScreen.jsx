// Gorgon — Natural-language search (Information Retrieval PHASE 8 + PHASE 4.1).
//
// One input, one question, a ranked answer:
//   "这个周末上海有哪些值得去的 AI 活动？"  ->  帮我找活动
//   -> 找到 N 条信息 / 合并为 M 个活动 / X 个可信 / Y 个待核验
//   -> 结果卡（推荐度 + 为什么推荐）
//
// PHASE 4.1 layout:
//   Mobile   one column; the summary/context block is ordered above the results
//            (same reading order as before).
//   Desktop  2fr results / 1fr "搜索理解" context column (.gg-smart-grid).
//   Both share ONE component tree — only CSS changes where things sit.
//
// Data source: POST /api/search (pipeline/api/server.py).
// If the API is not running (plain `python -m http.server`), the screen falls
// back to the pre-computed demo result in generated-search-demo.js — and says
// so, instead of pretending to search.
(function(){
const { Tag, Button } = window.GorgonDesignSystem_56aa78;
const { useResponsive } = window.GorgonResponsive;

const DEMO_QUERY = "这个周末上海有什么 AI / Agent / Vibe Coding 的活动？最好免费，徐汇附近，下午开始。";
const API_URL = "/api/search";

// Recommendation chips. The first one is the exact pre-computed demo query so
// the screen still works with no API running.
const EXAMPLES = [
  { label: "完整示例", text: DEMO_QUERY },
  { label: "周末 AI 活动", text: "这个周末上海有哪些 AI 活动？" },
  { label: "上海黑客松", text: "上海本周末有黑客松吗？" },
  { label: "免费 Demo Day", text: "上海有没有免费的 Demo Day？" },
  { label: "徐汇下午活动", text: "徐汇附近下午有什么活动？" },
];

const WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

// Human labels for the parsed SearchRequest / plan values.
const PRICE_LABEL = { free_preferred: "免费优先", free_only: "只要免费", paid_ok: "收费也可以", any: "不限" };
const TIME_LABEL = { morning: "上午", afternoon: "下午", evening: "晚上", any: "不限" };
const RANGE_LABEL = {
  today: "今天", tomorrow: "明天", this_weekend: "本周末", next_weekend: "下周末",
  this_week: "本周", next_week: "下周", any: "不限",
};

function dateLabel(iso) {
  if (!iso) return "日期待定";
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return iso;
  return (d.getMonth() + 1) + " 月 " + d.getDate() + " 日 " + WEEKDAYS[(d.getDay() + 6) % 7];
}

function timeLabel(act) {
  if (act.startTime && act.endTime) return act.startTime + "–" + act.endTime;
  return act.startTime || "";
}

function priceLabel(act) {
  if (act.priceType === "free") return "免费";
  if (act.priceType === "paid" && act.price != null) return "¥" + act.price;
  return "价格待定";
}

function bucketLabel(bucket) {
  if (bucket === "needs_review") return "待核验";
  if (bucket === "duplicate_candidate") return "疑似重复";
  return null;
}

function scoreColor(score) {
  if (score >= 80) return "var(--accent, #00C28E)";
  if (score >= 60) return "var(--brand)";
  return "var(--text-muted)";
}

function rangeLabel(request, plan) {
  if (plan && plan.dateRange && plan.dateRange.label) return plan.dateRange.label;
  const v = request && request.dateRange && request.dateRange.value;
  return RANGE_LABEL[v] || (v ? String(v) : "不限");
}

/** Call the API; fall back to the recorded demo result when unavailable. */
async function fetchSearch(query) {
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: query, maxResults: 30 }),
    });
    if (res.ok) {
      const data = await res.json();
      data.__source = "api";
      return data;
    }
  } catch (e) { /* API not running — expected on a plain static server */ }

  const demo = window.GORGON_SEARCH_DEMO;
  if (demo && demo.query && demo.query.trim() === query.trim()) {
    demo.__source = "static";
    return demo;
  }
  return null;
}

/* ── Ask block (one component, responsive CSS) ────────────────────── */

function AskBox({ value, onChange, onSubmit, loading }) {
  return (
    <div className="gg-ask-box">
      <textarea
        value={value}
        rows={2}
        aria-label="告诉 Gorgon 你想参加什么"
        placeholder="例如：这个周末上海有什么 AI 黑客松？最好免费，徐汇附近。"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSubmit(); } }}
      />
      <div className="gg-ask-actions">
        <span className="gg-ask-hint">Enter 直接搜索 · Shift + Enter 换行</span>
        <Button variant="primary" onClick={onSubmit} disabled={loading || !value.trim()}
          leadingIcon={<i data-lucide="sparkles" style={{ width: 17, height: 17 }} />}>
          {loading ? "检索中…" : "帮我找活动"}
        </Button>
      </div>
    </div>
  );
}

function ExampleChips({ onPick, disabled }) {
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12, alignItems: "center" }}>
      <span style={{ fontSize: 12, color: "var(--text-faint)", fontWeight: 600 }}>推荐输入</span>
      {EXAMPLES.map((ex) => (
        <button key={ex.label} disabled={disabled} onClick={() => onPick(ex.text)} style={{
          border: "1px dashed var(--border-default)", background: "transparent", color: "var(--text-body)",
          borderRadius: "var(--radius-pill)", padding: "7px 13px", fontSize: 12.5, fontWeight: 600,
          cursor: disabled ? "default" : "pointer",
        }}>{ex.label}</button>
      ))}
    </div>
  );
}

/* ── Summary / context column ─────────────────────────────────────── */

function Metric({ value, label, accent }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 19, color: accent || "var(--text-strong)", fontVariantNumeric: "tabular-nums", lineHeight: 1.15 }}>{value}</div>
      <div style={{ fontSize: 10.5, color: "var(--text-faint)", marginTop: 2, whiteSpace: "nowrap" }}>{label}</div>
    </div>
  );
}

function Card({ kicker, children, style }) {
  return (
    <div style={{
      padding: "16px 18px", borderRadius: "var(--radius-lg)", background: "var(--surface-card)",
      border: "1px solid var(--border-subtle)", boxShadow: "var(--shadow-sm)", ...style,
    }}>
      {kicker && <div className="gorgon-kicker" style={{ marginBottom: 10 }}>{kicker}</div>}
      {children}
    </div>
  );
}

function SummaryCard({ summary, source }) {
  return (
    <Card kicker="检索概览">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(74px, 1fr))", gap: "12px 10px" }}>
        <Metric value={summary.rawResults} label="条原始信息" />
        <Metric value={summary.mergedRawResults != null ? summary.mergedRawResults : summary.canonical} label="条合并后" />
        <Metric value={summary.canonical} label="个活动" />
        <Metric value={summary.approved} label="个可信" accent="var(--accent, #00C28E)" />
        <Metric value={summary.needsReview} label="个待核验" accent="var(--warning, #E0A200)" />
      </div>
      <div style={{ marginTop: 12, fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.6 }}>
        去重合并 {summary.duplicates} 条 · 疑似重复 {summary.duplicateCandidates} 个
        <span style={{ color: "var(--text-faint)" }}> · {source === "api" ? "实时检索" : "离线演示结果"}</span>
      </div>
    </Card>
  );
}

function UnderstandingCard({ request, plan }) {
  const rows = [
    { k: "地点", v: request.city || "不限" },
    { k: "时间", v: rangeLabel(request, plan) },
    { k: "时段", v: TIME_LABEL[request.timePreference] || "不限" },
    { k: "兴趣", v: (request.topics || []).join(" / ") || "不限" },
    { k: "价格", v: PRICE_LABEL[request.pricePreference] || "不限" },
    { k: "区域", v: request.locationPreference || "不限" },
  ];
  return (
    <Card kicker="搜索理解">
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {rows.map((r) => (
          <div key={r.k} style={{ display: "flex", gap: 10, fontSize: 13, lineHeight: 1.5 }}>
            <span style={{ color: "var(--text-faint)", width: 34, flex: "none" }}>{r.k}</span>
            <span style={{ color: "var(--text-strong)", fontWeight: 600, minWidth: 0 }}>{r.v}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function QueriesCard({ plan, isDesktop }) {
  const [open, setOpen] = React.useState(false);
  if (!plan || !plan.queries || !plan.queries.length) return null;

  if (isDesktop) {
    return (
      <Card kicker={"检索任务 " + plan.queries.length}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {plan.queries.map((q, i) => (
            <div key={i} style={{ display: "flex", gap: 8, fontSize: 12.5, color: "var(--text-body)", lineHeight: 1.5 }}>
              <span style={{ color: "var(--brand)", flex: "none" }}>•</span>
              <span style={{ minWidth: 0 }}>{q.text || q}</span>
            </div>
          ))}
        </div>
      </Card>
    );
  }

  return (
    <div>
      <button onClick={() => setOpen((v) => !v)} style={{
        display: "inline-flex", alignItems: "center", gap: 6, border: "none", background: "transparent",
        color: "var(--brand)", fontSize: 12.5, fontWeight: 600, cursor: "pointer", padding: 0,
      }}>
        <i data-lucide="list-tree" style={{ width: 14, height: 14 }} />
        系统拆成了 {plan.queries.length} 个检索任务 {open ? "（收起）" : "（展开）"}
      </button>
      {open && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
          {plan.queries.map((q, i) => (
            <Tag key={i} size="sm" tone="neutral">{q.text || q}</Tag>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Result card ──────────────────────────────────────────────────── */

function ReasonList({ reasons, isDesktop }) {
  if (!reasons || !reasons.length) return null;
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-muted)", marginBottom: 5 }}>为什么推荐</div>
      <div className="gg-reasons">
        {reasons.map((r, i) => (
          <div key={i} style={{ display: "flex", gap: 6, fontSize: 12.5, color: "var(--text-body)", lineHeight: 1.5 }}>
            <span style={{ color: "var(--brand)", flex: "none" }}>{isDesktop ? "✓" : "•"}</span><span>{r}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ResultCard({ item, rank, isDesktop }) {
  const act = item.activity || {};
  const pending = item.bucket !== "approved";
  const label = bucketLabel(item.bucket);
  const sources = (item.provenance || []).map((p) => p.source).filter(Boolean);
  const uniqueSources = sources.filter((s, i) => sources.indexOf(s) === i);

  return (
    <div style={{
      borderRadius: "var(--radius-lg)", padding: isDesktop ? "18px 20px" : "14px 15px",
      background: "var(--surface-card)",
      border: pending ? "1px dashed var(--border-strong, var(--border-subtle))" : "1px solid var(--border-subtle)",
      boxShadow: pending ? "none" : "var(--shadow-sm, none)",
      opacity: pending ? 0.86 : 1,
    }}>
      <div style={{ display: "flex", gap: isDesktop ? 14 : 10, alignItems: "flex-start" }}>
        <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: isDesktop ? 18 : 16, color: "var(--text-faint)", width: isDesktop ? 22 : 18, flex: "none", fontVariantNumeric: "tabular-nums" }}>{rank}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <div style={{ flex: 1, fontFamily: "var(--font-display)", fontWeight: 700, fontSize: isDesktop ? 17.5 : 15.5, color: "var(--text-strong)", lineHeight: 1.35 }}>
              {act.title || "(无标题)"}
            </div>
            <div style={{ flex: "none", textAlign: "right" }}>
              <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: isDesktop ? 22 : 17, color: scoreColor(item.finalScore), fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{item.finalScore}</div>
              <div style={{ fontSize: 9.5, color: "var(--text-faint)", marginTop: 2 }}>推荐度</div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 9, alignItems: "center" }}>
            <Tag size="sm" tone="neutral">{dateLabel(act.startDate)}{timeLabel(act) ? " " + timeLabel(act) : ""}</Tag>
            {act.district && <Tag size="sm" tone="neutral">{act.district}</Tag>}
            <Tag size="sm" tone={act.priceType === "free" ? "mint" : "neutral"}>{priceLabel(act)}</Tag>
            {label && <Tag size="sm" tone="warning" leadingIcon={<i data-lucide="shield-alert" style={{ width: 11, height: 11 }} />}>{label}</Tag>}
          </div>

          {isDesktop && act.tags && act.tags.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
              {act.tags.slice(0, 6).map((t) => <Tag key={t} size="sm" tone="neutral">{t}</Tag>)}
            </div>
          )}

          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8, lineHeight: 1.5 }}>
            {act.venue || "地点待定"}{act.organizer ? " · " + act.organizer : ""}
          </div>

          <ReasonList reasons={item.reasons} isDesktop={isDesktop} />

          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, color: "var(--text-faint)" }}>
              {uniqueSources.length ? `${uniqueSources.length} 个来源 · ${uniqueSources.join(" / ")}` : "来源待补充"}
              {" · 可信度 "}{act.trustScore != null ? act.trustScore : "—"}/100
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Screen ───────────────────────────────────────────────────────── */

function Notice({ icon, title, body, action }) {
  return (
    <div style={{ margin: "0 var(--gg-gutter)", padding: "24px 18px", borderRadius: "var(--radius-lg)", background: "var(--bg-sunken)", textAlign: "center" }}>
      <i data-lucide={icon} style={{ width: 26, height: 26, color: "var(--text-faint)" }} />
      <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15, color: "var(--text-strong)", marginTop: 10 }}>{title}</div>
      <div style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.6, marginTop: 6, maxWidth: 520, marginLeft: "auto", marginRight: "auto" }}>{body}</div>
      {action}
    </div>
  );
}

function NaturalSearchScreen() {
  const { isMobile, isDesktop } = useResponsive();
  const [q, setQ] = React.useState("");
  const [phase, setPhase] = React.useState("idle");   // idle | loading | done | unavailable
  const [data, setData] = React.useState(null);
  const [error, setError] = React.useState("");

  React.useEffect(() => { window.lucide && window.lucide.createIcons(); }, [phase, data]);

  const submit = async (text) => {
    const query = (text == null ? q : text).trim();
    if (!query) return;
    setQ(query);
    setPhase("loading");
    setError("");
    const result = await fetchSearch(query);
    if (!result) {
      setPhase("unavailable");
      setData(null);
      return;
    }
    setData(result);
    setPhase("done");
  };

  const backToAsk = () => { setPhase("idle"); setData(null); };

  const results = (data && data.results) || [];
  const approved = results.filter((r) => r.bucket === "approved");
  const pending = results.filter((r) => r.bucket !== "approved");
  // The pipeline's own count — the result list may be truncated by maxResults.
  const pendingTotal = data && data.summary
    ? (data.summary.needsReview || 0) + (data.summary.duplicateCandidates || 0)
    : pending.length;

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", scrollbarWidth: "none" }}>
      {/* ── First screen: ask ─────────────────────────────────────── */}
      {phase === "idle" && (
        <div className="gg-ask-wrap">
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: isMobile ? 24 : 34, fontWeight: 700, color: "var(--text-strong)", margin: "0 0 6px", letterSpacing: "-0.02em" }}>
            你想参加什么？
          </h1>
          <p style={{ fontSize: isMobile ? 12.5 : 14.5, color: "var(--text-muted)", margin: "0 0 16px", lineHeight: 1.6 }}>
            告诉 Gorgon 你想做什么，用一句话说出来就行，不用填表格。
          </p>
          <AskBox value={q} onChange={setQ} onSubmit={() => submit()} loading={phase === "loading"} />
          <ExampleChips onPick={submit} disabled={phase === "loading"} />
          <div style={{ marginTop: 18, padding: "12px 14px", borderRadius: "var(--radius-md)", background: "var(--bg-sunken)", fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.6, textAlign: "left" }}>
            检索结果来自 <b>DEMO 数据</b>：本阶段用固定 fixture 模拟多来源检索，
            不接真实爬虫、不接地图 API。链路本身（拆解 → 检索 → 合并 → 去重 → 可信度 → 人审 → 排序）是真的。
          </div>
        </div>
      )}

      {/* ── Compact ask bar once there is an answer ───────────────── */}
      {phase !== "idle" && (
        <div style={{ padding: "20px var(--gg-gutter) 16px" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
            <h1 style={{ fontFamily: "var(--font-display)", fontSize: isMobile ? 21 : 24, fontWeight: 700, color: "var(--text-strong)", margin: 0 }}>
              智能找活动
            </h1>
            {phase === "done" && (
              <button onClick={backToAsk} style={{ border: "none", background: "transparent", color: "var(--brand)", fontSize: 12.5, fontWeight: 600, cursor: "pointer", padding: 0 }}>
                换个问题
              </button>
            )}
          </div>
          <AskBox value={q} onChange={setQ} onSubmit={() => submit()} loading={phase === "loading"} />
        </div>
      )}

      {phase === "loading" && (
        <div style={{ padding: "28px var(--gg-gutter)", textAlign: "center", fontSize: 13, color: "var(--text-muted)" }}>
          正在拆解需求 → 生成检索任务 → 合并多来源信息 → 去重 / 可信度判断…
        </div>
      )}

      {phase === "unavailable" && (
        <Notice
          icon="plug-zap"
          title="检索服务未启动"
          body="当前是静态演示模式，只能回答问题库里已有的问题。运行 python pipeline/api/server.py --port 8000 即可实时检索。"
          action={<button onClick={() => submit(DEMO_QUERY)} style={{ marginTop: 12, border: "1px solid var(--border-subtle)", background: "var(--surface-card)", borderRadius: "var(--radius-pill)", padding: "8px 14px", fontSize: 12.5, fontWeight: 600, color: "var(--brand)", cursor: "pointer" }}>用示例问题看看效果</button>}
        />
      )}

      {/* ── Answer ────────────────────────────────────────────────── */}
      {phase === "done" && data && (
        <div className="gg-smart-grid" style={{ padding: "0 var(--gg-gutter) 32px" }}>
          {/* Context column. On mobile `order:-1` lifts it above the
              results so the reading order matches the original design. */}
          <aside className="gg-smart-aside" style={{ display: "flex", flexDirection: "column", gap: isMobile ? 12 : 16 }}>
            <SummaryCard summary={data.summary} source={data.__source} />
            {isDesktop && <UnderstandingCard request={data.request || {}} plan={data.plan} />}
            <QueriesCard plan={data.plan} isDesktop={isDesktop} />
          </aside>

          <div className="gg-smart-main">
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
              <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18, color: "var(--text-strong)" }}>推荐结果</div>
              <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
                找到 <b style={{ color: "var(--text-strong)" }}>{data.summary.rawResults}</b> 条信息
                → <b style={{ color: "var(--text-strong)" }}>{data.summary.canonical}</b> 个活动
                → <b style={{ color: "var(--text-strong)" }}>{data.summary.approved}</b> 个可信
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: isDesktop ? 14 : 12 }}>
              {approved.map((item, i) => (
                <ResultCard key={item.id} item={item} rank={i + 1} isDesktop={isDesktop} />
              ))}

              {pending.length > 0 && (
                <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                  <i data-lucide="shield-alert" style={{ width: 15, height: 15, color: "var(--warning, #E0A200)" }} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-strong)" }}>待核验 {pendingTotal} 个</span>
                  {pending.length < pendingTotal && (
                    <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>（本次显示 {pending.length} 个）</span>
                  )}
                  <span style={{ fontSize: 11.5, color: "var(--text-faint)" }}>信息有冲突或来源不足，人工确认前不作为推荐</span>
                </div>
              )}
              {pending.map((item, i) => (
                <ResultCard key={item.id} item={item} rank={approved.length + i + 1} isDesktop={isDesktop} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

window.GorgonApp = Object.assign(window.GorgonApp || {}, { NaturalSearchScreen });
})();
