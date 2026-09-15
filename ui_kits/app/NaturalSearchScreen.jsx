// Gorgon — Natural-language search (Information Retrieval PHASE 8).
//
// One input, one question, a ranked answer:
//   "这个周末上海有哪些值得去的 AI 活动？"  ->  搜索
//   -> 找到 N 条信息 / 合并为 M 个活动 / X 个可信 / Y 个待核验
//   -> 结果卡（推荐度 + 为什么推荐）
//
// Data source: POST /api/search (pipeline/api/server.py).
// If the API is not running (plain `python -m http.server`), the screen falls
// back to the pre-computed demo result in generated-search-demo.js — and says
// so, instead of pretending to search.
(function(){
const { SearchField, Tag, Badge, Button } = window.GorgonDesignSystem_56aa78;

const DEMO_QUERY = "这个周末上海有什么 AI / Agent / Vibe Coding 的活动？最好免费，徐汇附近，下午开始。";
const API_URL = "/api/search";

const WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

function dateLabel(iso) {
  if (!iso) return "日期待定";
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return iso;
  return (d.getMonth() + 1) + " 月 " + d.getDate() + " 日 " + WEEKDAYS[(d.getDay() + 6) % 7];
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

function Metric({ value, label, accent }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 19, color: accent || "var(--text-strong)", fontVariantNumeric: "tabular-nums" }}>{value}</div>
      <div style={{ fontSize: 10.5, color: "var(--text-faint)", marginTop: 1, whiteSpace: "nowrap" }}>{label}</div>
    </div>
  );
}

function SummaryStrip({ summary, source }) {
  return (
    <div style={{ margin: "0 20px 16px", padding: "14px 16px", borderRadius: "var(--radius-lg)", background: "var(--surface-card)", border: "1px solid var(--border-subtle)" }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 11 }}>
        <Metric value={summary.rawResults} label="条原始信息" />
        <Metric value={summary.canonical} label="个活动" />
        <Metric value={summary.approved} label="个可信" accent="var(--accent, #00C28E)" />
        <Metric value={summary.needsReview} label="个待核验" accent="var(--warning, #E0A200)" />
      </div>
      <div style={{ fontSize: 11.5, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <span>去重合并 {summary.duplicates} 条 · 疑似重复 {summary.duplicateCandidates} 个</span>
        <span style={{ color: "var(--text-faint)" }}>{source === "api" ? "· 实时检索" : "· 离线演示结果"}</span>
      </div>
    </div>
  );
}

function ReasonList({ reasons }) {
  if (!reasons || !reasons.length) return null;
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-muted)", marginBottom: 5 }}>为什么推荐</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {reasons.map((r, i) => (
          <div key={i} style={{ display: "flex", gap: 6, fontSize: 12.5, color: "var(--text-body)", lineHeight: 1.5 }}>
            <span style={{ color: "var(--brand)", flex: "none" }}>•</span><span>{r}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ResultCard({ item, rank }) {
  const act = item.activity || {};
  const pending = item.bucket !== "approved";
  const label = bucketLabel(item.bucket);
  const sources = (item.provenance || []).map((p) => p.source).filter(Boolean);
  const uniqueSources = sources.filter((s, i) => sources.indexOf(s) === i);

  return (
    <div style={{
      borderRadius: "var(--radius-lg)", padding: "14px 15px",
      background: "var(--surface-card)",
      border: pending ? "1px dashed var(--border-strong, var(--border-subtle))" : "1px solid var(--border-subtle)",
      boxShadow: pending ? "none" : "var(--shadow-sm, none)",
      opacity: pending ? 0.86 : 1,
    }}>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 16, color: "var(--text-faint)", width: 18, flex: "none", fontVariantNumeric: "tabular-nums" }}>{rank}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
            <div style={{ flex: 1, fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15.5, color: "var(--text-strong)", lineHeight: 1.35 }}>
              {act.title || "(无标题)"}
            </div>
            <div style={{ flex: "none", textAlign: "right" }}>
              <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 17, color: scoreColor(item.finalScore), fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{item.finalScore}</div>
              <div style={{ fontSize: 9.5, color: "var(--text-faint)", marginTop: 1 }}>推荐度</div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8, alignItems: "center" }}>
            <Tag size="sm" tone="neutral">{dateLabel(act.startDate)}{act.startTime ? " " + act.startTime : ""}</Tag>
            {act.district && <Tag size="sm" tone="neutral">{act.district}</Tag>}
            <Tag size="sm" tone={act.priceType === "free" ? "mint" : "neutral"}>{priceLabel(act)}</Tag>
            {label && <Tag size="sm" tone="warning" leadingIcon={<i data-lucide="shield-alert" style={{ width: 11, height: 11 }} />}>{label}</Tag>}
          </div>

          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8, lineHeight: 1.5 }}>
            {act.venue || "地点待定"}{act.organizer ? " · " + act.organizer : ""}
          </div>

          <ReasonList reasons={item.reasons} />

          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, color: "var(--text-faint)" }}>
              可信度 {act.trustScore != null ? act.trustScore : "—"}/100
              {uniqueSources.length ? " · 来源 " + uniqueSources.join(" / ") : ""}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function PlanChips({ plan }) {
  if (!plan || !plan.queries) return null;
  const [open, setOpen] = React.useState(false);
  return (
    <div style={{ margin: "0 20px 16px" }}>
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

function Notice({ icon, title, body, action }) {
  return (
    <div style={{ margin: "0 20px", padding: "20px 18px", borderRadius: "var(--radius-lg)", background: "var(--bg-sunken)", textAlign: "center" }}>
      <i data-lucide={icon} style={{ width: 26, height: 26, color: "var(--text-faint)" }} />
      <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15, color: "var(--text-strong)", marginTop: 10 }}>{title}</div>
      <div style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.6, marginTop: 6 }}>{body}</div>
      {action}
    </div>
  );
}

function NaturalSearchScreen() {
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

  const results = (data && data.results) || [];
  const approved = results.filter((r) => r.bucket === "approved");
  const pending = results.filter((r) => r.bucket !== "approved");
  // The pipeline's own count — the result list may be truncated by maxResults.
  const pendingTotal = data && data.summary
    ? (data.summary.needsReview || 0) + (data.summary.duplicateCandidates || 0)
    : pending.length;

  return (
    <div style={{ flex: 1, overflowY: "auto", scrollbarWidth: "none" }}>
      <div style={{ padding: "8px 20px 14px" }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 700, color: "var(--text-strong)", margin: "0 0 4px" }}>
          你想找什么活动？
        </h1>
        <p style={{ fontSize: 12.5, color: "var(--text-muted)", margin: "0 0 12px", lineHeight: 1.5 }}>
          用一句话说出来就行，不用填表格。
        </p>
        <SearchField
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          placeholder="这个周末上海有哪些值得去的 AI 活动？"
          size="lg"
        />
        <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
          <Button variant="primary" size="sm" onClick={() => submit()} disabled={phase === "loading" || !q.trim()}>
            {phase === "loading" ? "检索中…" : "搜索"}
          </Button>
          <button onClick={() => submit(DEMO_QUERY)} style={{
            border: "1px dashed var(--border-subtle)", background: "transparent", color: "var(--text-muted)",
            borderRadius: "var(--radius-pill)", padding: "7px 12px", fontSize: 11.5, cursor: "pointer",
          }}>试试示例问题</button>
        </div>
      </div>

      {phase === "loading" && (
        <div style={{ padding: "28px 20px", textAlign: "center", fontSize: 13, color: "var(--text-muted)" }}>
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

      {phase === "done" && data && (
        <div>
          <div style={{ padding: "0 20px 10px", fontSize: 12.5, color: "var(--text-muted)" }}>
            找到 <b style={{ color: "var(--text-strong)" }}>{data.summary.rawResults}</b> 条信息
            → 合并为 <b style={{ color: "var(--text-strong)" }}>{data.summary.canonical}</b> 个活动
            → <b style={{ color: "var(--text-strong)" }}>{data.summary.approved}</b> 个可信
            → <b style={{ color: "var(--text-strong)" }}>{data.summary.needsReview}</b> 个待核验
          </div>

          <SummaryStrip summary={data.summary} source={data.__source} />
          <PlanChips plan={data.plan} />

          <div style={{ padding: "0 20px 24px", display: "flex", flexDirection: "column", gap: 12 }}>
            {approved.map((item, i) => (
              <ResultCard key={item.id} item={item} rank={i + 1} />
            ))}

            {pending.length > 0 && (
              <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                <i data-lucide="shield-alert" style={{ width: 15, height: 15, color: "var(--warning, #E0A200)" }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-strong)" }}>待核验 {pendingTotal} 个</span>
                {pending.length < pendingTotal && (
                  <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>（本次显示 {pending.length} 个）</span>
                )}
                <span style={{ fontSize: 11.5, color: "var(--text-faint)" }}>信息有冲突或来源不足，人工确认前不作为推荐</span>
              </div>
            )}
            {pending.map((item, i) => (
              <ResultCard key={item.id} item={item} rank={approved.length + i + 1} />
            ))}
          </div>
        </div>
      )}

      {phase === "idle" && (
        <div style={{ padding: "0 20px 24px" }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-strong)", margin: "6px 0 8px" }}>可以这样问</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[
              "这个周末上海有什么 AI / Agent / Vibe Coding 活动？最好免费，徐汇附近，下午开始。",
              "本周末上海有什么 AI 和 Agent 的活动？",
              "这个周末上海有哪些 Vibe Coding 活动？",
            ].map((t) => (
              <button key={t} onClick={() => submit(t)} style={{
                textAlign: "left", border: "1px solid var(--border-subtle)", background: "var(--surface-card)",
                borderRadius: "var(--radius-md)", padding: "11px 13px", fontSize: 12.5, color: "var(--text-body)",
                lineHeight: 1.5, cursor: "pointer",
              }}>{t}</button>
            ))}
          </div>
          <div style={{ marginTop: 18, padding: "12px 14px", borderRadius: "var(--radius-md)", background: "var(--bg-sunken)", fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.6 }}>
            检索结果来自 <b>DEMO 数据</b>：本阶段用固定 fixture 模拟多来源检索，
            不接真实爬虫、不接地图 API。链路本身（拆解 → 检索 → 合并 → 去重 → 可信度 → 人审 → 排序）是真的。
          </div>
        </div>
      )}
    </div>
  );
}

window.GorgonApp = Object.assign(window.GorgonApp || {}, { NaturalSearchScreen });
})();
