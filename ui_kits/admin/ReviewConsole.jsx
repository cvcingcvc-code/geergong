// Gorgon 审核后台 — 人工审核控制台组件。
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

function QueueItem({ item, active, decided, onClick }) {
  const sg = SUGGEST[item.suggestion];
  const cat = _CATS[item.category];
  return (
    <button onClick={onClick} style={{
      display: "flex", gap: 12, alignItems: "center", width: "100%", textAlign: "left", cursor: "pointer",
      border: active ? "1.5px solid var(--brand)" : "1px solid var(--border-subtle)",
      background: active ? "var(--brand-soft)" : "var(--surface-card)",
      borderRadius: "var(--radius-md)", padding: "12px 13px",
      opacity: decided ? 0.5 : 1,
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
          <span style={{ flex: "none" }}>{item.crawledAt}</span>
        </div>
      </div>
      {decided ? (
        <span style={{ flex: "none", fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: 11.5, color: decided === "approve" ? "var(--accent-strong)" : "var(--danger)" }}>
          {decided === "approve" ? "已通过" : decided === "reject" ? "已拒绝" : "已退回"}
        </span>
      ) : (
        <span style={{ flex: "none", width: 8, height: 8, borderRadius: "50%", background: sg.color }} />
      )}
    </button>
  );
}

function CheckRow({ c }) {
  const m = CHECK[c.status];
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

function ReviewPanel({ item, onDecide }) {
  if (!item) return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-faint)", fontSize: 14 }}>
      从左侧选择一条待审核活动
    </div>
  );
  const sg = SUGGEST[item.suggestion];
  const cat = _CATS[item.category];
  const passN = item.checks.filter((c) => c.status === "pass").length;

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
            </div>
            <div style={{ fontSize: 13, color: "var(--text-body)", marginTop: 4 }}>机器自动校验 {item.checks.length} 项 · 通过 {passN} 项 · 综合评分 {item.score}/100</div>
          </div>
        </div>

        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 700, color: "var(--text-strong)", marginBottom: 10 }}>{item.title}</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 18 }}>
          <Tag tone="neutral" size="sm" dotColor={cat.color}>{cat.label}</Tag>
          <Tag tone="neutral" size="sm">{item.date} {item.time}</Tag>
          <Tag tone="neutral" size="sm">{item.venue}</Tag>
          {item.sourceUrl
            ? <SourceTag source={item.source} href={item.sourceUrl} />
            : <Tag tone="warning" size="sm">无可核实来源</Tag>}
        </div>

        <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--text-strong)", margin: "4px 0 2px" }}>自动校验结果</h3>
        <div style={{ marginBottom: 8 }}>
          {item.checks.map((c) => <CheckRow key={c.key} c={c} />)}
        </div>
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
          <Button block variant="mint" onClick={() => onDecide(item.id, "approve")}
            leadingIcon={<i data-lucide="check" style={{ width: 17, height: 17 }} />}>通过并发布</Button>
          <div style={{ display: "flex", gap: 9 }}>
            <Button variant="secondary" onClick={() => onDecide(item.id, "return")} style={{ flex: 1 }}
              leadingIcon={<i data-lucide="corner-up-left" style={{ width: 16, height: 16 }} />}>退回核实</Button>
            <Button variant="secondary" onClick={() => onDecide(item.id, "reject")} style={{ flex: 1, color: "var(--danger)" }}
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
  const [decided, setDecided] = React.useState(() => (store ? store.getAdmin() : {}));
  const [sel, setSel] = React.useState(() => {
    const d = store ? store.getAdmin() : {};
    const firstPending = data.items.find((i) => !d[i.id]);
    return (firstPending || data.items[0]).id;
  });
  const item = data.items.find((i) => i.id === sel);

  const decide = (id, action) => {
    const next = { ...decided, [id]: action };
    setDecided(next);
    if (store) store.setAdmin(next);
    const rest = data.items.filter((i) => !next[i.id] && i.id !== id);
    if (rest[0]) setSel(rest[0].id);
  };

  React.useEffect(() => { window.lucide && window.lucide.createIcons(); });

  const pendingN = data.items.filter((i) => !decided[i.id]).length;
  const approvedN = Object.values(decided).filter((d) => d === "approve").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden", background: "var(--surface-card)" }}>
      {/* Top bar */}
      <header style={{ flex: "none", padding: "16px 26px", borderBottom: "1px solid var(--border-subtle)", display: "flex", alignItems: "center", gap: 16 }}>
        <img src="../../assets/logo-mark.svg" width="34" height="34" alt="Gorgon" />
        <div>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18, color: "var(--text-strong)", lineHeight: 1 }}>审核后台</div>
          <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 3 }}>爬取 → 自动校验 → 人工审核 → 发布</div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 30, alignItems: "center" }}>
          <StatBlock value={pendingN} label="待审核" accent="brand" align="center" />
          <StatBlock value={`${Math.round(data.stats.autoPassRate * 100)}%`} label="自动通过率" accent="mint" align="center" />
          <StatBlock value={data.stats.todayReviewed + approvedN} label="今日已处理" align="center" />
          <div style={{ display: "flex", alignItems: "center", gap: 9, paddingLeft: 6 }}>
            <span style={{ width: 34, height: 34, borderRadius: "50%", background: "var(--brand-soft)", color: "var(--brand-strong)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 13 }}>运营</span>
          </div>
        </div>
      </header>

      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* Queue */}
        <div style={{ width: 360, flex: "none", borderRight: "1px solid var(--border-subtle)", display: "flex", flexDirection: "column", background: "var(--bg-base)" }}>
          <div style={{ flex: "none", padding: "16px 18px 12px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15, color: "var(--text-strong)" }}>待审核队列</span>
            <Tag tone="brand" size="sm">{pendingN} 条</Tag>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "0 16px 18px", display: "flex", flexDirection: "column", gap: 9 }}>
            {data.items.map((it) => (
              <QueueItem key={it.id} item={it} active={it.id === sel} decided={decided[it.id]} onClick={() => setSel(it.id)} />
            ))}
          </div>
        </div>

        {/* Review */}
        <ReviewPanel item={item} onDecide={decide} />
      </div>
    </div>
  );
}

window.GorgonAdmin = { ReviewConsole };
})();
