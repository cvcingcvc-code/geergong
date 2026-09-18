// Gorgon — 智能找活动 (natural-language search + real retrieval).
//
// PHASE 5 layout:
//   Desktop (>=1200)   ask hero -> 2fr results / 1fr context column
//   Tablet  (768-1199) ask hero -> single column, context above results
//   Mobile  (<768)     ask page -> results, context collapsed into a details
//
// Data source: POST /api/search. When the API is not running the screen falls
// back to the recorded demo payload in generated-search-demo.js — and SAYS SO
// with the DEMO DATA badge. A failed real search never silently renders demo
// rows as if they were real.
(function () {
  const { Button, Tag } = window.GorgonDesignSystem_56aa78;
  const { useResponsive } = window.GorgonResponsive;
  const V = window.GorgonActivityView;
  const C = window.GorgonCommon;
  const D = window.GorgonDistrict;
  const DistrictPicker = (window.GorgonApp && window.GorgonApp.DistrictPicker) || function () { return null; };

  const DEMO_QUERY = "这个周末上海有什么 AI / Agent / Vibe Coding 的活动？最好免费，徐汇附近，下午开始。";
  const API_URL = "/api/search";

  // Topic chips: `topic` is what we add to the request; all use the real
  // SearchRequest vocabulary so the planner understands them.
  const TOPICS = [
    { key: "all", label: "全部活动", topic: null },
    { key: "ai", label: "AI", topic: "AI" },
    { key: "agent", label: "Agent", topic: "Agent" },
    { key: "vibecoding", label: "Vibe Coding", topic: "Vibe Coding" },
    { key: "startup", label: "创业", topic: "创业" },
    { key: "talk", label: "分享会", topic: "分享会" },
    { key: "meetup", label: "Meetup", topic: "Meetup" },
    { key: "hackathon", label: "Hackathon", topic: "Hackathon" },
    { key: "demoday", label: "Demo Day", topic: "Demo Day" },
  ];

  const WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  const PRICE_LABEL = { free_preferred: "免费优先", free_only: "只要免费", paid_ok: "收费也可以", any: "不限" };
  const TIME_LABEL = { morning: "上午", afternoon: "下午", evening: "晚上", any: "不限" };
  const RANGE_LABEL = {
    today: "今天", tomorrow: "明天", this_weekend: "本周末", next_weekend: "下周末",
    this_week: "本周", next_week: "下周", any: "不限",
  };

  function rangeLabel(request, plan) {
    if (plan && plan.dateRange && plan.dateRange.label) return plan.dateRange.label;
    const v = request && request.dateRange && request.dateRange.value;
    return RANGE_LABEL[v] || (v ? String(v) : "不限");
  }

  function dateLabel(iso) {
    if (!iso) return "日期待定";
    const d = new Date(iso + "T00:00:00");
    if (isNaN(d.getTime())) return iso;
    return (d.getMonth() + 1) + "月" + d.getDate() + "日 · " + WEEKDAYS[(d.getDay() + 6) % 7];
  }

  /** Call the API; fall back to the recorded demo payload when unavailable. */
  // The API lives on the SAME origin as the page (PHASE 8 public deployment),
  // so `/api/search` works unchanged behind a tunnel. The timeout is a backstop
  // above the server's own 40s deadline: the server's readable 504 should win,
  // and only a genuinely wedged connection gets aborted here.
  const REQUEST_TIMEOUT_MS = 45000;

  async function fetchSearch(query, topics) {
    const body = { query: query, maxResults: 30 };
    if (topics && topics.length) body.topics = topics;
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : null;
    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller ? controller.signal : undefined,
      });
      if (res.ok) {
        const data = await res.json();
        data.__source = "api";
        return data;
      }
      // A 4xx/5xx from a live server is a real failure, not "no API" — report it.
      // The server sends a human-readable `message`; `detail` is the legacy key.
      let detail = "";
      try {
        const payload = await res.json();
        detail = payload.message || payload.detail || "";
      } catch (e) { /* ignore */ }
      return { __source: "error", __status: res.status, __detail: detail };
    } catch (e) {
      if (e && e.name === "AbortError") {
        return { __source: "error", __status: 0,
                 __detail: "检索超时，请稍后重试，或换一个更具体的关键词。" };
      }
      /* API not running — expected on a plain static server */
    } finally {
      if (timer) clearTimeout(timer);
    }

    const demo = window.GORGON_SEARCH_DEMO;
    if (demo && demo.query && demo.query.trim() === query.trim()) {
      demo.__source = "static";
      return demo;
    }
    return null;
  }

  /* ── Ask block ───────────────────────────────────────────────────── */

  function AskBox({ value, onChange, onSubmit, loading, compact }) {
    return (
      <div className={"gg-ask-box" + (compact ? " is-compact" : "")}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          <i data-lucide="search" style={{ width: compact ? 17 : 20, height: compact ? 17 : 20, color: "var(--text-faint)", flex: "none", marginTop: compact ? 3 : 5 }} />
          <textarea
            value={value}
            rows={compact ? 1 : 2}
            aria-label="告诉 Gorgon 你想参加什么活动"
            placeholder="这个周末上海有哪些 AI / Agent / Vibe Coding 活动？最好免费，徐汇附近，下午开始。"
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSubmit(); } }}
          />
        </div>
        <div className="gg-ask-actions">
          <span className="gg-ask-hint">Enter 直接检索 · Shift + Enter 换行</span>
          <Button variant="primary" onClick={onSubmit} disabled={loading || !value.trim()}
            leadingIcon={<i data-lucide="sparkles" style={{ width: 17, height: 17 }} />}>
            {loading ? "检索中…" : "帮我找活动"}
          </Button>
        </div>
      </div>
    );
  }

  function TopicChips({ value, onChange, disabled }) {
    return (
      <div className="gg-chip-row">
        {TOPICS.map((t) => {
          const on = t.key === value;
          return (
            <button key={t.key} disabled={disabled} onClick={() => onChange(t.key)} className={"gg-chip" + (on ? " is-on" : "")}>
              {t.label}
            </button>
          );
        })}
      </div>
    );
  }

  /* ── Loading: staged, no fake percentages ────────────────────────── */

  function StageList({ stages, active }) {
    return (
      <div className="gg-stage-list">
        {stages.map((s, i) => {
          const done = i < active;
          const now = i === active;
          return (
            <div key={s.key || i} className={"gg-stage" + (done ? " is-done" : "") + (now ? " is-now" : "")}>
              <span className="gg-stage-glyph">
                {done
                  ? <i data-lucide="check" style={{ width: 13, height: 13 }} />
                  : now
                    ? <span className="gg-spin" />
                    : <span className="gg-dot" />}
              </span>
              <span>{s.label}</span>
            </div>
          );
        })}
      </div>
    );
  }

  /* ── Result card (desktop-first) ─────────────────────────────────── */

  function ResultCard({ item, rank, isDesktop, isMobile, synced, onSync, onOpen }) {
    const view = V.toView(item.activity || {}, {
      reasons: item.reasons,
      sources: item.sources,
      provenance: item.provenance,
      finalScore: item.finalScore,
      bucket: item.bucket,
      dataOrigin: item.dataOrigin,
    });
    const pending = view.trust !== "confirmed";
    const score = item.finalScore;
    const scoreTone = score >= 80 ? "var(--accent-strong, #00A277)" : score >= 60 ? "var(--brand)" : "var(--text-muted)";
    const sourceCount = item.sourceCount || (view.provenance.length || view.sources.length || 1);
    const isSynced = !!synced[view.id];

    return (
      <article className="gg-result" data-gg-card-district={view.district || ""} style={{
        border: pending ? "1px dashed var(--border-strong, var(--border-subtle))" : "1px solid var(--border-subtle)",
      }}>
        <div className="gg-result-media">
          <C.ActivityImage image={view.image} alt={view.title} ratio={isMobile ? "16 / 9" : "4 / 3"} radius="var(--radius-md)">
            <C.PlaceholderNote image={view.image} />
          </C.ActivityImage>
        </div>

        <div className="gg-result-body">
          <div className="gg-result-head">
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
                <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 12.5, color: "var(--text-faint)", fontVariantNumeric: "tabular-nums" }}>#{rank}</span>
                <C.TrustChip status={view.trust} size="sm" />
                {view.dataOrigin === "demo" && <C.ProviderBadge mode="demo" size="sm" />}
              </div>
              <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: isDesktop ? 17.5 : 16, color: "var(--text-strong)", lineHeight: 1.35, margin: "6px 0 0" }}>
                {view.title}
              </h3>
            </div>
            {score != null && (
              <div className="gg-result-score">
                <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: isDesktop ? 24 : 20, color: scoreTone, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{score}</div>
                <div style={{ fontSize: 9.5, color: "var(--text-faint)", marginTop: 3, letterSpacing: "0.04em" }}>推荐度</div>
              </div>
            )}
          </div>

          <div className="gg-result-facts">
            <span className="gg-fact"><i data-lucide="calendar" style={{ width: 13, height: 13 }} />{view.dateText || "日期待定"}{view.timeText ? " · " + view.timeText : ""}</span>
            <span className="gg-fact"><i data-lucide="map-pin" style={{ width: 13, height: 13 }} />{[view.district, view.venue].filter(Boolean).join(" · ") || "地点待定"}</span>
            <span className="gg-fact" style={{ color: view.priceType === "free" ? "var(--accent-strong, #047857)" : undefined, fontWeight: 700 }}>
              <i data-lucide="ticket" style={{ width: 13, height: 13 }} />{view.priceLabel}
            </span>
          </div>

          {view.tags.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
              {view.tags.slice(0, 6).map((t) => <Tag key={t} size="sm" tone="neutral">{t}</Tag>)}
            </div>
          )}

          {view.reasons.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-muted)", marginBottom: 6 }}>为什么推荐</div>
              <div className="gg-reasons">
                {view.reasons.map((r, i) => (
                  <div key={i} style={{ display: "flex", gap: 6, fontSize: 12.5, color: "var(--text-body)", lineHeight: 1.5 }}>
                    <span style={{ color: "var(--accent-strong, #00A277)", flex: "none" }}>✓</span><span>{r}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="gg-result-foot">
            <span style={{ fontSize: 11.5, color: "var(--text-faint)", minWidth: 0 }}>
              {sourceCount} 个来源 · {view.trustLabel}
              {view.trustScore != null ? " · 可信度 " + view.trustScore + "/100" : ""}
            </span>
            <div style={{ display: "flex", gap: 8, flex: "none" }}>
              <Button variant="secondary" size="sm" onClick={() => onOpen(view)}>详情</Button>
              <Button variant={isSynced ? "mint" : "primary"} size="sm" onClick={() => onSync(view)}
                leadingIcon={<i data-lucide={isSynced ? "check" : "plus"} style={{ width: 14, height: 14 }} />}>
                {isSynced ? "已加入我的周末" : "加入我的周末"}
              </Button>
            </div>
          </div>
        </div>
      </article>
    );
  }

  /* ── Context column ──────────────────────────────────────────────── */

  function Panel({ kicker, children, style }) {
    return (
      <div style={Object.assign({
        padding: "16px 18px", borderRadius: "var(--radius-lg)", background: "var(--surface-card)",
        border: "1px solid var(--border-subtle)", boxShadow: "var(--shadow-sm)",
      }, style || {})}>
        {kicker && <div className="gorgon-kicker" style={{ marginBottom: 11 }}>{kicker}</div>}
        {children}
      </div>
    );
  }

  function Row({ k, v }) {
    return (
      <div style={{ display: "flex", gap: 10, fontSize: 13, lineHeight: 1.5 }}>
        <span style={{ color: "var(--text-faint)", width: 38, flex: "none" }}>{k}</span>
        <span style={{ color: "var(--text-strong)", fontWeight: 600, minWidth: 0, overflowWrap: "anywhere" }}>{v}</span>
      </div>
    );
  }

  function UnderstandingPanel({ request, plan }) {
    return (
      <Panel kicker="搜索理解">
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Row k="地点" v={request.city || "不限"} />
          <Row k="区域" v={request.locationPreference || "不限"} />
          <Row k="时间" v={rangeLabel(request, plan)} />
          <Row k="时段" v={TIME_LABEL[request.timePreference] || "不限"} />
          <Row k="兴趣" v={(request.topics || []).join(" / ") || "不限"} />
          <Row k="价格" v={PRICE_LABEL[request.pricePreference] || "不限"} />
        </div>
      </Panel>
    );
  }

  function PlanPanel({ plan }) {
    if (!plan || !plan.queries || !plan.queries.length) return null;
    return (
      <Panel kicker={"检索计划 · " + plan.queries.length + " 条"}>
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          {plan.queries.map((q, i) => (
            <div key={i} style={{ display: "flex", gap: 9, fontSize: 12.5, color: "var(--text-body)", lineHeight: 1.5 }}>
              <span style={{ color: "var(--brand)", flex: "none", fontVariantNumeric: "tabular-nums" }}>{i + 1}</span>
              <span style={{ minWidth: 0 }}>{q.text || q}</span>
            </div>
          ))}
        </div>
      </Panel>
    );
  }

  function Metric({ value, label, accent }) {
    return (
      <div style={{ minWidth: 0 }}>
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 20, color: accent || "var(--text-strong)", fontVariantNumeric: "tabular-nums", lineHeight: 1.15 }}>{value}</div>
        <div style={{ fontSize: 10.5, color: "var(--text-faint)", marginTop: 3, whiteSpace: "nowrap" }}>{label}</div>
      </div>
    );
  }

  function SummaryPanel({ summary, providers, providerMode, source, district, shown }) {
    const failed = (providers || []).filter((p) => p.available === false);
    const filtered = !D.isAll(district);
    return (
      <Panel kicker="检索结果汇总">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(70px, 1fr))", gap: "13px 10px" }}>
          <Metric value={summary.rawResults} label="条原始信息" />
          <Metric value={summary.canonical} label="个活动" />
          <Metric value={summary.approved} label="已确认" accent="var(--accent-strong, #00A277)" />
          <Metric value={summary.needsReview} label="待核验" accent="#9A6300" />
          <Metric value={summary.withImage} label="有真实图片" />
        </div>
        <div style={{ marginTop: 13, fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.7 }}>
          <div>去重合并 {summary.duplicates || 0} 条 · 疑似重复 {summary.duplicateCandidates || 0} 个</div>
          <div>数据来源：{source === "api" ? "实时检索接口" : "离线演示结果"}</div>
          {failed.length > 0 && (
            <div style={{ color: "#9A6300" }}>部分来源暂时不可用：{failed.map((p) => p.name).join("、")}</div>
          )}
          {/* The numbers above describe the RETRIEVAL; the list below is
              narrowed by the district. Saying so is what keeps the panel from
              contradicting the cards. */}
          {filtered && (
            <div style={{ color: "var(--brand)", fontWeight: 600 }}>
              已按地区筛选：仅显示 {district} 的活动（{shown} 个），合计 {summary.canonical} 个活动来自整个上海
            </div>
          )}
        </div>
      </Panel>
    );
  }

  /* ── Screen ──────────────────────────────────────────────────────── */

  function NaturalSearchScreen({ synced, onSync, onOpen, district, onDistrictChange }) {
    const { isMobile, isDesktop } = useResponsive();
    const [q, setQ] = React.useState("");
    const [topic, setTopic] = React.useState("all");
    const [phase, setPhase] = React.useState("idle");   // idle | loading | done | unavailable | error
    const [data, setData] = React.useState(null);
    const [error, setError] = React.useState(null);
    const [stage, setStage] = React.useState(0);

    React.useEffect(() => { window.lucide && window.lucide.createIcons(); }, [phase, data, stage, topic, error]);

    const stages = (data && data.stages) || (window.GORGON_SEARCH_DEMO && window.GORGON_SEARCH_DEMO.stages) || [];

    // Staged loading copy. Driven by a timer, NOT a fabricated percentage:
    // the last stage simply holds until the response lands.
    React.useEffect(() => {
      if (phase !== "loading") return;
      setStage(0);
      const total = Math.max(stages.length, 1);
      const timer = setInterval(() => {
        setStage((s) => Math.min(s + 1, total - 1));
      }, 520);
      return () => clearInterval(timer);
    }, [phase]);

    const submit = async (text) => {
      const query = (text == null ? q : text).trim();
      if (!query) return;
      const t = TOPICS.find((x) => x.key === topic);
      const topics = t && t.topic ? [t.topic] : [];
      setQ(query);
      setPhase("loading");
      setError(null);
      const result = await fetchSearch(query, topics);
      if (!result) {
        setPhase("unavailable");
        setData(null);
        return;
      }
      if (result.__source === "error") {
        setError({ status: result.__status, detail: result.__detail });
        setPhase("error");
        setData(null);
        return;
      }
      setData(result);
      setPhase("done");
    };

    const backToAsk = () => { setPhase("idle"); setData(null); setError(null); };

    const allResults = (data && data.results) || [];
    // The retrieval is district-agnostic; the LIST is not. Filtering happens on
    // the already-fetched results through the same predicate every other screen
    // uses — the search provider, the request and trust scoring are untouched.
    // A degraded provider therefore never switches the district off: the filter
    // still runs, the "部分来源暂时不可用" notice still shows, and no other
    // district's rows ever leak into this list.
    const results = React.useMemo(() => {
      if (D.isAll(district)) return allResults;
      return allResults.filter((r) => D.matches(r.activity || {}, district));
    }, [allResults, district]);

    const approved = results.filter((r) => r.bucket === "approved");
    const pending = results.filter((r) => r.bucket !== "approved");
    const summary = (data && data.summary) || {};
    const providerMode = (data && data.providerMode) || "demo";
    const notices = (data && data.notices) || [];

    // Counts for the picker: how many retrieved results sit in each district.
    // Untouched by the current selection, so the menu can be trusted.
    const resultActivities = React.useMemo(
      () => allResults.map((r) => r.activity || {}),
      [allResults]
    );
    const districtActive = !D.isAll(district);

    // The headline sentence the spec asks for: raw information in, events out.
    //
    // The second number is deliberately `results.length` — the count the reader
    // can verify by counting the cards below — and NOT `summary.canonical`.
    // Canonical counts deduped entities, while the list also renders the rows
    // flagged as suspected duplicates, so the two disagree (13 cards under a
    // headline claiming 11 activities). The dedupe detail stays in the context
    // column, where it explains the difference instead of contradicting it.
    // With a district active the same rule applies to the district: the number
    // stays equal to the cards, and the range is named.
    const headline = data ? (
      <span>
        {districtActive && <span>在 <b style={{ color: "var(--text-strong)" }}>{district}</b> 范围内，</span>}
        找到 <b style={{ color: "var(--text-strong)" }}>{summary.rawResults || 0}</b> 条相关信息，为你整理出{" "}
        <b style={{ color: "var(--text-strong)" }}>{results.length}</b> 个活动。
        {districtActive && allResults.length > results.length ? (
          <span style={{ color: "var(--text-faint)" }}>
            （另有 {allResults.length - results.length} 个结果不在 {district}，已隐藏）
          </span>
        ) : null}
      </span>
    ) : null;

    return (
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", scrollbarWidth: "none" }} data-gg-screen="smart">

        {/* ── Ask page ─────────────────────────────────────────────── */}
        {phase === "idle" && (
          <div className="gg-ask-wrap">
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
              <h1 style={{ fontFamily: "var(--font-display)", fontSize: isMobile ? 24 : 34, fontWeight: 700, color: "var(--text-strong)", margin: 0, letterSpacing: "-0.02em" }}>
                ✨ 智能找活动
              </h1>
              <C.ProviderBadge mode="real" />
            </div>
            <p style={{ fontSize: isMobile ? 13 : 15, color: "var(--text-muted)", margin: "0 0 18px", lineHeight: 1.65, maxWidth: 720 }}>
              告诉 Gorgon 你想参加什么活动，我们会帮你检索、整理并推荐。
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
              <DistrictPicker value={district} onChange={onDistrictChange} activities={[]} showCounts={false} />
              <span style={{ fontSize: 12.5, color: "var(--text-faint)" }}>
                {D.isAll(district) ? "检索范围：整个上海" : "结果只会保留 " + district + " 区域内的活动"}
              </span>
            </div>
            <AskBox value={q} onChange={setQ} onSubmit={() => submit()} loading={phase === "loading"} />
            <div style={{ marginTop: 14 }}>
              <TopicChips value={topic} onChange={setTopic} disabled={phase === "loading"} />
            </div>
            <div style={{ marginTop: 20, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button onClick={() => submit(DEMO_QUERY)} className="gg-chip">试试示例问题</button>
              <button onClick={() => submit("上海本周末有哪些 AI Hackathon？")} className="gg-chip">上海本周末黑客松</button>
              <button onClick={() => submit("上海有没有免费的 Demo Day？")} className="gg-chip">免费 Demo Day</button>
            </div>
          </div>
        )}

        {/* ── Compact ask bar once there is an answer ───────────────── */}
        {phase !== "idle" && (
          <div style={{ padding: "20px var(--gg-gutter) 14px" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 11, flexWrap: "wrap" }}>
              <h1 style={{ fontFamily: "var(--font-display)", fontSize: isMobile ? 20 : 24, fontWeight: 700, color: "var(--text-strong)", margin: 0 }}>
                ✨ 智能找活动
              </h1>
              {data && <C.ProviderBadge mode={providerMode} />}
              <button onClick={backToAsk} style={{ border: "none", background: "transparent", color: "var(--brand)", fontSize: 12.5, fontWeight: 600, cursor: "pointer", padding: 0, marginLeft: "auto" }}>
                换个问题
              </button>
            </div>
            <AskBox value={q} onChange={setQ} onSubmit={() => submit()} loading={phase === "loading"} compact />
            <div style={{ marginTop: 11 }}>
              <TopicChips value={topic} onChange={setTopic} disabled={phase === "loading"} />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
              <DistrictPicker value={district} onChange={onDistrictChange}
                activities={resultActivities}
                showCounts={allResults.length > 0} />
              <span style={{ fontSize: 12.5, color: "var(--text-faint)" }}>
                {D.isAll(district) ? "结果范围：整个上海" : "正在只看 " + district + " 的结果"}
              </span>
            </div>
          </div>
        )}

        {/* ── Loading ──────────────────────────────────────────────── */}
        {phase === "loading" && (
          <div style={{ padding: "10px var(--gg-gutter) 40px", maxWidth: 560 }}>
            <StageList stages={stages.length ? stages : [
              { key: "understood", label: "正在理解你的需求…" },
              { key: "planned", label: "正在生成检索计划…" },
              { key: "searching", label: "正在检索活动…" },
              { key: "extracting", label: "正在访问候选活动页面…" },
              { key: "merging", label: "正在整理多来源信息…" },
              { key: "deduping", label: "正在去重…" },
              { key: "scoring", label: "正在评估可信度…" },
              { key: "ranking", label: "正在生成推荐…" },
            ]} active={stage} />
          </div>
        )}

        {/* ── Errors / service missing ─────────────────────────────── */}
        {phase === "unavailable" && (
          <div style={{ padding: "0 var(--gg-gutter) 40px" }}>
            <C.NoticeBlock
              icon="plug-zap" tone="warning"
              title="检索服务未启动"
              body={"暂时无法连接检索服务，只能回答示例问题库里已有的问题。请稍后重试，或先看看示例问题的效果。"}
              action={<button onClick={() => submit(DEMO_QUERY)} className="gg-chip">用示例问题看看效果</button>}
            />
          </div>
        )}

        {phase === "error" && (
          <div style={{ padding: "0 var(--gg-gutter) 40px" }}>
            <C.NoticeBlock
              icon="triangle-alert" tone="danger"
              title={"检索失败（HTTP " + (error && error.status) + "）"}
              body={(error && error.detail) || "服务端返回了错误，请查看服务端日志。"}
              action={<button onClick={() => submit()} className="gg-chip">重试</button>}
            />
          </div>
        )}

        {/* ── Result: honest notices first ─────────────────────────── */}
        {phase === "done" && data && (
          <>
            {providerMode === "demo" && (
              <div style={{ padding: "0 var(--gg-gutter) 12px" }}>
                <C.NoticeBlock
                  icon="flask-conical" tone="warning"
                  title="DEMO DATA"
                  body="本次结果来自本地录制的演示数据，不是真实网页检索结果。"
                />
              </div>
            )}
            {notices.length > 0 && (
              <div style={{ padding: "0 var(--gg-gutter) 12px", display: "flex", flexDirection: "column", gap: 10 }}>
                {notices.map((n, i) => (
                  <C.NoticeBlock key={i} icon={n.level === "warning" ? "triangle-alert" : "info"}
                    tone={n.level === "warning" ? "warning" : "neutral"} title={n.code || "提示"} body={n.message} />
                ))}
              </div>
            )}

            {/* Headline */}
            <div style={{ padding: "0 var(--gg-gutter) 16px" }}>
              <div style={{ fontSize: isMobile ? 13.5 : 15, color: "var(--text-body)", lineHeight: 1.6 }}>{headline}</div>
            </div>

            {data.status === "unavailable" || results.length === 0 ? (
              <div style={{ padding: "0 var(--gg-gutter) 40px" }}>
                {data.status === "unavailable" ? (
                  <C.NoticeBlock
                    icon="search-x" tone="warning"
                    title="没有找到符合条件的活动"
                    body={"真实检索没有返回可用结果。可以换一个说法，或稍后重试 —— Gorgon 不会用演示数据冒充检索结果。"}
                    action={<button onClick={backToAsk} className="gg-chip">修改问题</button>}
                  />
                ) : districtActive && allResults.length > 0 ? (
                  /* The retrieval DID find things — just none in this district.
                     Say exactly that, and never quietly widen the filter. */
                  <C.NoticeBlock
                    icon="map-pin-off" tone="warning"
                    title={D.emptyTitle(district, true)}
                    body={"本次检索找到 " + allResults.length + " 个活动，其中没有位于 " + district + " 的。不会用其他区域的结果填充这个列表。"}
                    action={
                      <span style={{ display: "inline-flex", gap: 8, flexWrap: "wrap" }}>
                        <button onClick={() => onDistrictChange(D.ALL)} className="gg-chip">查看全上海结果</button>
                        <button onClick={backToAsk} className="gg-chip">修改问题</button>
                      </span>
                    }
                  />
                ) : (
                  <C.NoticeBlock
                    icon="search-x" tone="warning"
                    title="没有找到符合条件的活动"
                    body={"真实检索没有返回可用结果。可以换一个说法，或稍后重试 —— Gorgon 不会用演示数据冒充检索结果。"}
                    action={<button onClick={backToAsk} className="gg-chip">修改问题</button>}
                  />
                )}
              </div>
            ) : (
              <div className="gg-smart-grid" style={{ padding: "0 var(--gg-gutter) 40px" }}>
                <aside className="gg-smart-aside" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <SummaryPanel summary={summary} providers={data.providers} providerMode={providerMode} source={data.__source}
                    district={district} shown={results.length} />
                  <UnderstandingPanel request={data.request || {}} plan={data.plan} />
                  <PlanPanel plan={data.plan} />
                </aside>

                <div className="gg-smart-main">
                  <div className="gg-section-head" style={{ marginBottom: 14 }}>
                    <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18, color: "var(--text-strong)" }}>搜索结果</div>
                    <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
                      已确认 <b style={{ color: "var(--text-strong)" }}>{approved.length}</b> · 待核验 <b style={{ color: "var(--text-strong)" }}>{pending.length}</b>
                    </div>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    {approved.map((item, i) => (
                      <ResultCard key={item.id} item={item} rank={i + 1} isDesktop={isDesktop} isMobile={isMobile}
                        synced={synced} onSync={onSync} onOpen={onOpen} />
                    ))}

                    {pending.length > 0 && (
                      <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <i data-lucide="shield-alert" style={{ width: 15, height: 15, color: "#9A6300" }} />
                        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-strong)" }}>
                          待核验 {pending.length} 个
                        </span>
                        <span style={{ fontSize: 11.5, color: "var(--text-faint)" }}>信息有冲突或来源不足，人工确认前不作为推荐</span>
                      </div>
                    )}
                    {pending.map((item, i) => (
                      <ResultCard key={item.id} item={item} rank={approved.length + i + 1} isDesktop={isDesktop} isMobile={isMobile}
                        synced={synced} onSync={onSync} onOpen={onOpen} />
                    ))}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  window.GorgonApp = Object.assign(window.GorgonApp || {}, { NaturalSearchScreen });
})();
