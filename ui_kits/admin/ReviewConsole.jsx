// Gorgon 审核后台 — 人工审核控制台组件。
// PHASE 3 (Human Review Loop)：消费 pipeline 真实 review queue（fallback DEMO），
// 支持 APPROVE / REJECT / RETURN、关键字段人工修正（edits）、状态筛选、
// duplicate 对比、决策导出。原始 pipeline 数据只读，edits 单独保存。
(function(){
const { VerifiedBadge, SourceTag, Tag, Button, StatBlock, ActivityCard, CategoryDot } = window.GorgonDesignSystem_56aa78;
const _CATS = window.GorgonDesignSystem_56aa78.CATEGORIES;

const SUGGEST = {
  auto_pass: { color: "var(--accent-strong)", bg: "var(--accent-soft)", icon: "shield-check", label: "建议自动通过" },
  review:    { color: "#9A6300", bg: "var(--warning-soft)", icon: "search-check", label: "需人工核实" },
  reject:    { color: "#C42B30", bg: "var(--danger-soft)", icon: "shield-x", label: "建议拒绝" },
};
const CHECK = {
  pass: { color: "var(--accent-strong)", icon: "check-circle-2" },
  warn: { color: "#9A6300", icon: "alert-triangle" },
  fail: { color: "var(--danger)", icon: "x-circle" },
};
// PHASE 5 — 人工可编辑字段白名单（与 docs/HUMAN_REVIEW_CONTRACT.md 一致）。
const EDITABLE = [
  { key: "title", label: "标题" },
  { key: "startDate", label: "日期", placeholder: "2026-09-20" },
  { key: "startTime", label: "开始时间", placeholder: "19:00" },
  { key: "venue", label: "场地" },
  { key: "district", label: "区域" },
  { key: "category", label: "分类" },
  { key: "price", label: "价格", placeholder: "免费 / ¥29" },
  { key: "organizer", label: "主办方" },
  { key: "registrationUrl", label: "报名链接" },
];
// 人工决定 -> 契约值。兼容旧版纯字符串记录。
const LEGACY = { approve: "approved", reject: "rejected", return: "needs_edit" };
const DECISION_LABEL = {
  approved: "已通过", rejected: "已拒绝", needs_edit: "已退回",
};

function normalizeDecisions(raw) {
  const out = {};
  Object.keys(raw || {}).forEach((id) => {
    const v = raw[id];
    if (typeof v === "string") {
      out[id] = { decision: LEGACY[v] || v, reviewedAt: null, edits: {} };
    } else if (v && typeof v === "object" && v.decision) {
      out[id] = { decision: v.decision, reviewedAt: v.reviewedAt || null, edits: v.edits || {} };
    }
  });
  return out;
}

function ScoreRing({ score, size = 54 }) {
  const tone = score >= 85 ? "var(--mint-500)" : score >= 60 ? "var(--amber-500)" : "var(--coral-500)";
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - score / 100);
  return (
    <span style={{ position: "relative", width: size, height: size, flex: "none", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--slate-200)" strokeWidth="5" />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={tone} strokeWidth="5" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off} />
      </svg>
      <span style={{ position: "absolute", fontFamily: "var(--font-display)", fontWeight: 700, fontSize: size * 0.3, color: "var(--text-strong)", fontVariantNumeric: "tabular-nums" }}>{score}</span>
    </span>
  );
}

function QueueItem({ item, active, decision, onClick }) {
  const sg = SUGGEST[item.suggestion] || SUGGEST.review;
  const cat = _CATS[item.category] || { color: "var(--text-faint)", label: item.category || "未分类" };
  return (
    <button onClick={onClick} style={{
      display: "flex", gap: 12, alignItems: "center", width: "100%", textAlign: "left", cursor: "pointer",
      border: active ? "1.5px solid var(--brand)" : "1px solid var(--border-subtle)",
      background: active ? "var(--brand-soft)" : "var(--surface-card)",
      borderRadius: "var(--radius-md)", padding: "12px 13px",
      opacity: decision ? 0.55 : 1,
      transition: "all var(--dur-fast) var(--ease-out)",
    }}>
      <ScoreRing score={item.score} size={44} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: cat.color, flex: "none" }} />
          <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-strong)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.title}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, color: "var(--text-muted)" }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 130 }}>{item.source}</span>
          <span style={{ color: "var(--text-faint)" }}>·</span>
          <span style={{ flex: "none" }}>{item.crawledAt || "—"}</span>
          {item.humanEdited && <span style={{ color: "var(--brand-strong)", fontWeight: 700 }}>·已改</span>}
        </div>
      </div>
      {decision ? (
        <span style={{ flex: "none", fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: 11.5, color: decision === "approved" ? "var(--accent-strong)" : decision === "rejected" ? "var(--danger)" : "#9A6300" }}>
          {DECISION_LABEL[decision] || decision}
        </span>
      ) : (
        <span style={{ flex: "none", width: 8, height: 8, borderRadius: "50%", background: sg.color }} />
      )}
    </button>
  );
}

function CheckRow({ c }) {
  const m = CHECK[c.status] || CHECK.warn;
  return (
    <div style={{ display: "flex", gap: 11, alignItems: "flex-start", padding: "10px 0", borderBottom: "1px solid var(--border-subtle)" }}>
      <i data-lucide={m.icon} style={{ width: 18, height: 18, color: m.color, flex: "none", marginTop: 1 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text-strong)" }}>{c.label}</div>
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 2, lineHeight: 1.5 }}>{c.detail}</div>
      </div>
    </div>
  );
}

// PHASE 3 — duplicate candidate 对比（title / date / venue / organizer / source）。
function DuplicateCompare({ item }) {
  const cand = (item.duplicateCandidates || [])[0];
  if (!cand || !cand.activity) return null;
  const a = {
    title: item.title,
    date: item.startDate || item.date,
    venue: item.venue,
    organizer: item.organizer,
    source: item.source,
  };
  const b = {
    title: cand.activity.title,
    date: cand.activity.startDate,
    venue: cand.activity.venue,
    organizer: cand.activity.organizer,
    source: cand.activity.sourceName,
  };
  const rows = [
    ["标题", "title"], ["日期", "date"], ["场地", "venue"], ["主办方", "organizer"], ["来源", "source"],
  ];
  return (
    <div style={{ marginTop: 18, border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)", overflow: "hidden" }}>
      <div style={{ padding: "10px 14px", background: "var(--warning-soft)", display: "flex", alignItems: "center", gap: 8 }}>
        <i data-lucide="copy" style={{ width: 15, height: 15, color: "#9A6300" }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: "#9A6300" }}>
          疑似重复 · 与 {cand.duplicateOf} 相似度 {Math.round((cand.duplicateConfidence || 0) * 100)}%
        </span>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
        <thead>
          <tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
            <th style={{ padding: "7px 14px", fontWeight: 600, width: 64 }}>字段</th>
            <th style={{ padding: "7px 14px", fontWeight: 600 }}>当前活动（{item.id}）</th>
            <th style={{ padding: "7px 14px", fontWeight: 600 }}>候选（{cand.duplicateOf}）</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, key]) => (
            <tr key={key} style={{ borderTop: "1px solid var(--border-subtle)" }}>
              <td style={{ padding: "7px 14px", color: "var(--text-muted)" }}>{label}</td>
              <td style={{ padding: "7px 14px", color: "var(--text-strong)", fontWeight: 600 }}>{a[key] || "—"}</td>
              <td style={{ padding: "7px 14px", color: "var(--text-body)" }}>{b[key] || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// PHASE 5 — 关键字段人工修正。保存为 edits，不破坏原始 pipeline 数据。
function EditForm({ item, savedEdits, onSaveEdits }) {
  const [draft, setDraft] = React.useState(() => {
    const d = {};
    EDITABLE.forEach(({ key }) => { d[key] = (savedEdits && savedEdits[key]) != null ? savedEdits[key] : (item[key] != null ? String(item[key]) : ""); });
    return d;
  });
  const dirty = EDITABLE.some(({ key }) => String(draft[key] || "") !== String(item[key] != null ? item[key] : ""));
  React.useEffect(() => {
    setDraft(() => {
      const d = {};
      EDITABLE.forEach(({ key }) => { d[key] = (savedEdits && savedEdits[key]) != null ? savedEdits[key] : (item[key] != null ? String(item[key]) : ""); });
      return d;
    });
  }, [item.id]);
  return (
    <div style={{ marginTop: 18, border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)", padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <i data-lucide="pencil-line" style={{ width: 15, height: 15, color: "var(--text-muted)" }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-strong)" }}>人工修正</span>
        <span style={{ fontSize: 11.5, color: "var(--text-faint)" }}>仅随「通过」保存为 edits，不改原始数据</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 12px" }}>
        {EDITABLE.map(({ key, label, placeholder }) => (
          <label key={key} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)" }}>{label}</span>
            <input value={draft[key] || ""} placeholder={placeholder} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
              style={{ border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-sm)", padding: "7px 9px", fontSize: 12.5, fontFamily: "var(--font-sans)", color: "var(--text-strong)", background: "var(--surface-card)" }} />
          </label>
        ))}
      </div>
      <div style={{ display: "flex", gap: 9, marginTop: 12, alignItems: "center" }}>
        <Button variant="secondary" onClick={() => onSaveEdits(draft)}
          leadingIcon={<i data-lucide="save" style={{ width: 15, height: 15 }} />}>保存修正</Button>
        {dirty && <span style={{ fontSize: 11.5, color: "#9A6300" }}>有未保存修改</span>}
        {!dirty && savedEdits && Object.keys(savedEdits).length > 0 && (
          <span style={{ fontSize: 11.5, color: "var(--accent-strong)" }}>已保存 {Object.keys(savedEdits).length} 处修正</span>
        )}
      </div>
    </div>
  );
}

function ReviewPanel({ item, onDecide, onSaveEdits, decision }) {
  if (!item) return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-faint)", fontSize: 14 }}>
      从左侧选择一条待审核活动
    </div>
  );
  const sg = SUGGEST[item.suggestion] || SUGGEST.review;
  const cat = _CATS[item.category] || { color: "var(--text-faint)", label: item.category || "未分类" };
  const passN = item.checks.filter((c) => c.status === "pass").length;
  const failN = item.checks.filter((c) => c.status === "fail").length;
  const savedEdits = (decision && decision.edits) || {};
  const reasonLabel = {
    duplicate_candidate: "疑似重复活动",
    cross_source_conflict: "多来源信息冲突",
    low_confidence: "低置信度（评分过低）",
    medium_confidence: "中等置信度，建议人工核实",
  }[item.reviewReason] || item.reviewReason;

  return (
    <div style={{ flex: 1, display: "flex", minWidth: 0 }}>
      {/* 校验详情 */}
      <div style={{ flex: 1, minWidth: 0, padding: "24px 26px", overflowY: "auto" }}>
        {/* 建议横幅 */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 18px", borderRadius: "var(--radius-lg)", background: sg.bg, marginBottom: 20 }}>
          <ScoreRing score={item.score} />
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <i data-lucide={sg.icon} style={{ width: 18, height: 18, color: sg.color }} />
              <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 17, color: sg.color }}>{sg.label}</span>
              <Tag tone="neutral" size="sm">{reasonLabel}</Tag>
            </div>
            <div style={{ fontSize: 13, color: "var(--text-body)", marginTop: 4 }}>机器自动校验 {item.checks.length} 项 · 通过 {passN} 项{failN ? ` · 冲突 ${failN} 项` : ""} · 综合评分 {item.score}/100</div>
          </div>
          {decision && (
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-strong)" }}>{DECISION_LABEL[decision.decision] || decision.decision}</div>
              {decision.reviewedAt && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{decision.reviewedAt.replace("T", " ").slice(0, 16)}</div>}
            </div>
          )}
        </div>

        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 700, color: "var(--text-strong)", marginBottom: 10 }}>{item.title}</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 4 }}>
          <Tag tone="neutral" size="sm" dotColor={cat.color}>{cat.label}</Tag>
          <Tag tone="neutral" size="sm">{item.date} {item.time}</Tag>
          <Tag tone="neutral" size="sm">{item.venue}</Tag>
          <Tag tone="neutral" size="sm">{item.price}</Tag>
          {item.organizer && <Tag tone="neutral" size="sm">{item.organizer}</Tag>}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 18 }}>
          {item.sourceUrl
            ? <SourceTag source={item.source} href={item.sourceUrl} />
            : <Tag tone="warning" size="sm">无可核实来源 · {item.source}</Tag>}
          {item.registrationUrl && <SourceTag source="报名入口" href={item.registrationUrl} />}
        </div>

        <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--text-strong)", margin: "4px 0 2px" }}>自动校验结果</h3>
        <div style={{ marginBottom: 8 }}>
          {item.checks.map((c) => <CheckRow key={c.key} c={c} />)}
        </div>

        <DuplicateCompare item={item} />

        <EditForm item={item} savedEdits={savedEdits} onSaveEdits={(draft) => onSaveEdits(item.id, draft)} />
      </div>

      {/* 预览 + 操作 */}
      <div style={{ width: 320, flex: "none", borderLeft: "1px solid var(--border-subtle)", display: "flex", flexDirection: "column", background: "var(--bg-base)" }}>
        <div style={{ padding: "20px 18px 12px", flex: 1, overflowY: "auto" }}>
          <div style={{ fontFamily: "var(--font-display)", textTransform: "uppercase", letterSpacing: "0.1em", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginBottom: 12 }}>App 内预览</div>
          <ActivityCard
            title={item.title} category={item.category} date={item.date} time={item.time}
            location={item.location} price={item.price} synced={false} onSync={() => {}}
          />
          <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 10, lineHeight: 1.5 }}>
            通过后将以此卡片形式进入发现流;信任等级由来源核验自动决定。
          </div>
        </div>

        <div style={{ flex: "none", padding: "14px 18px 18px", borderTop: "1px solid var(--border-subtle)", background: "var(--surface-card)", display: "flex", flexDirection: "column", gap: 9 }}>
          <Button block variant="mint" onClick={() => onDecide(item.id, "approved")}
            leadingIcon={<i data-lucide="check" style={{ width: 17, height: 17 }} />}>通过并发布</Button>
          <div style={{ display: "flex", gap: 9 }}>
            <Button variant="secondary" onClick={() => onDecide(item.id, "needs_edit")} style={{ flex: 1 }}
              leadingIcon={<i data-lucide="corner-up-left" style={{ width: 16, height: 16 }} />}>退回核实</Button>
            <Button variant="secondary" onClick={() => onDecide(item.id, "rejected")} style={{ flex: 1, color: "var(--danger)" }}
              leadingIcon={<i data-lucide="x" style={{ width: 16, height: 16 }} />}>拒绝</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ReviewConsole() {
  const data = window.GORGON_QUEUE;
  const store = window.GorgonStore;
  const [decided, setDecided] = React.useState(() => normalizeDecisions(store ? store.getAdmin() : {}));
  const [filter, setFilter] = React.useState("pending");
  const [sel, setSel] = React.useState(() => {
    const d = normalizeDecisions(store ? store.getAdmin() : {});
    const firstPending = data.items.find((i) => !d[i.id] || d[i.id].decision === "needs_edit");
    return (firstPending || data.items[0]).id;
  });

  const persist = (next) => {
    setDecided(next);
    if (store) store.setAdmin(next);
  };
  // PHASE 4 — 人工决定（approved / rejected / needs_edit）+ reviewedAt。
  const decide = (id, action) => {
    const prev = decided[id] || {};
    persist({ ...decided, [id]: { decision: action, reviewedAt: new Date().toISOString(), edits: prev.edits || {} } });
    if (action !== "needs_edit") {
      const rest = data.items.filter((i) => i.id !== id && (!decided[i.id] || decided[i.id].decision === "needs_edit"));
      if (rest[0]) setSel(rest[0].id);
    }
  };
  // PHASE 5 — 保存人工修正（仅保存与原值不同的字段）。
  const saveEdits = (id, draft) => {
    const item = data.items.find((i) => i.id === id);
    const edits = {};
    EDITABLE.forEach(({ key }) => {
      const orig = item[key] != null ? String(item[key]) : "";
      if (String(draft[key] || "") !== orig) edits[key] = draft[key];
    });
    const prev = decided[id] || {};
    persist({ ...decided, [id]: { decision: prev.decision || "needs_edit", reviewedAt: prev.reviewedAt || new Date().toISOString(), edits } });
  };

  React.useEffect(() => { window.lucide && window.lucide.createIcons(); });

  // PHASE 10 — 状态筛选：机器判断 -> 人工复核 -> 最终结果。
  const matchFilter = (it) => {
    const d = decided[it.id];
    if (filter === "all") return true;
    if (filter === "pending") return !d || d.decision === "needs_edit";
    if (filter === "approved") return d && d.decision === "approved";
    if (filter === "rejected") return d && d.decision === "rejected";
    return true;
  };
  const visible = data.items.filter(matchFilter);
  const pendingN = data.items.filter((i) => !decided[i.id] || decided[i.id].decision === "needs_edit").length;
  const approvedN = Object.values(decided).filter((d) => d.decision === "approved").length;
  const rejectedN = Object.values(decided).filter((d) => d.decision === "rejected").length;
  const editedN = Object.values(decided).filter((d) => d.edits && Object.keys(d.edits).length > 0).length;

  // PHASE 7 — 导出人工决定（浏览器下载 -> 放入 pipeline/data/review/ -> --apply-reviews）。
  const exportDecisions = () => {
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      decisions: decided,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "gorgon-review-decisions.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  const filterTab = (key, label, n) => (
    <button onClick={() => setFilter(key)} style={{
      border: "none", cursor: "pointer", padding: "6px 12px", borderRadius: "var(--radius-pill)",
      fontFamily: "var(--font-sans)", fontSize: 12.5, fontWeight: 600,
      background: filter === key ? "var(--brand)" : "transparent",
      color: filter === key ? "#fff" : "var(--text-muted)",
    }}>{label}{n != null ? ` ${n}` : ""}</button>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden", background: "var(--surface-card)" }}>
      {/* Top bar */}
      <header style={{ flex: "none", padding: "16px 26px", borderBottom: "1px solid var(--border-subtle)", display: "flex", alignItems: "center", gap: 16 }}>
        <img src="../../assets/logo-mark.svg" width="34" height="34" alt="Gorgon" />
        <div>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18, color: "var(--text-strong)", lineHeight: 1 }}>审核后台</div>
          <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 3 }}>
            {window.GORGON_REVIEW_QUEUE && window.GORGON_REVIEW_QUEUE.length
              ? "pipeline review queue → 人工审核 → 发布"
              : "DEMO 数据 → 自动校验 → 人工审核 → 发布"}
          </div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 30, alignItems: "center" }}>
          <StatBlock value={pendingN} label="待审核" accent="brand" align="center" />
          <StatBlock value={approvedN} label="人工通过" accent="mint" align="center" />
          <StatBlock value={rejectedN} label="已拒绝" align="center" />
          {editedN > 0 && <StatBlock value={editedN} label="含修正" align="center" />}
          <Button variant="secondary" onClick={exportDecisions}
            leadingIcon={<i data-lucide="download" style={{ width: 15, height: 15 }} />}>Export Review Decisions</Button>
          <div style={{ display: "flex", alignItems: "center", gap: 9, paddingLeft: 6 }}>
            <span style={{ width: 34, height: 34, borderRadius: "50%", background: "var(--brand-soft)", color: "var(--brand-strong)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 13 }}>运营</span>
          </div>
        </div>
      </header>

      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* Queue */}
        <div style={{ width: 360, flex: "none", borderRight: "1px solid var(--border-subtle)", display: "flex", flexDirection: "column", background: "var(--bg-base)" }}>
          <div style={{ flex: "none", padding: "16px 18px 8px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15, color: "var(--text-strong)" }}>审核队列</span>
            <Tag tone="brand" size="sm">{data.items.length} 条</Tag>
          </div>
          <div style={{ flex: "none", padding: "0 14px 10px", display: "flex", gap: 2, flexWrap: "wrap" }}>
            {filterTab("pending", "待处理", pendingN)}
            {filterTab("approved", "已通过", approvedN)}
            {filterTab("rejected", "已拒绝", rejectedN)}
            {filterTab("all", "全部")}
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "0 16px 18px", display: "flex", flexDirection: "column", gap: 9 }}>
            {visible.map((it) => (
              <QueueItem key={it.id} item={it} active={it.id === sel} decision={(decided[it.id] || {}).decision} onClick={() => setSel(it.id)} />
            ))}
            {visible.length === 0 && (
              <div style={{ color: "var(--text-faint)", fontSize: 13, padding: "18px 6px" }}>该状态下暂无条目</div>
            )}
          </div>
        </div>

        {/* Review */}
        <ReviewPanel item={data.items.find((i) => i.id === sel)} onDecide={decide} onSaveEdits={saveEdits} decision={decided[sel]} />
      </div>
    </div>
  );
}

window.GorgonAdmin = { ReviewConsole };
})();
