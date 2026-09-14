// Gorgon — Search & filters.
(function(){
const { SearchField, ActivityCard, Tag } = window.GorgonDesignSystem_56aa78;

function SearchScreen({ synced, onSync, onOpen }) {
  const { activities } = window.GORGON_DATA;
  const [q, setQ] = React.useState("");
  const recent = ["苏州河夜跑", "免费市集", "Livehouse", "陶艺"];
  const trending = [
    { t: "夜跑", c: "sport" }, { t: "Livehouse", c: "music" }, { t: "手作工作坊", c: "art" },
    { t: "城市骑行", c: "outdoor" }, { t: "私厨", c: "food" }, { t: "旧书市集", c: "study" },
  ];
  const results = q ? activities.filter((a) => a.title.includes(q) || a.tags.some((t) => t.includes(q))) : activities.slice(0, 3);

  return (
    <div style={{ flex: 1, overflowY: "auto", scrollbarWidth: "none" }}>
      <div style={{ padding: "8px 20px 16px", position: "sticky", top: 0, background: "var(--bg-base)", zIndex: 2 }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: 26, fontWeight: 700, color: "var(--text-strong)", marginBottom: 12 }}>搜索</h1>
        <SearchField value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索活动、地点、标签" size="lg" />
      </div>

      {!q && (
        <div style={{ padding: "0 20px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "6px 0 10px" }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-strong)" }}>最近搜索</span>
            <button style={{ border: "none", background: "transparent", color: "var(--text-muted)", fontSize: 12.5, cursor: "pointer" }}>清除</button>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 22 }}>
            {recent.map((r) => (
              <button key={r} onClick={() => setQ(r)} style={{ display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid var(--border-subtle)", background: "var(--surface-card)", borderRadius: "var(--radius-pill)", padding: "8px 13px", fontSize: 13, color: "var(--text-body)", fontWeight: 500, cursor: "pointer" }}>
                <i data-lucide="clock" style={{ width: 13, height: 13, color: "var(--text-faint)" }} />{r}
              </button>
            ))}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 7, margin: "0 0 12px" }}>
            <i data-lucide="trending-up" style={{ width: 17, height: 17, color: "var(--brand)" }} />
            <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-strong)" }}>本周热搜</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9, marginBottom: 24 }}>
            {trending.map((tr, i) => (
              <button key={tr.t} onClick={() => setQ(tr.t)} style={{ display: "flex", alignItems: "center", gap: 10, border: "1px solid var(--border-subtle)", background: "var(--surface-card)", borderRadius: "var(--radius-md)", padding: "11px 13px", cursor: "pointer", textAlign: "left" }}>
                <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 16, color: i < 2 ? "var(--brand)" : "var(--text-faint)", width: 16 }}>{i + 1}</span>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: `var(--cat-${tr.c})`, flex: "none" }} />
                <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text-body)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tr.t}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ padding: "0 20px 24px" }}>
        {q && <div style={{ fontSize: 13, color: "var(--text-muted)", margin: "2px 0 12px" }}>找到 <b style={{ color: "var(--text-strong)" }}>{results.length}</b> 场相关活动</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {results.map((a) => (
            <div key={a.id} onClick={() => onOpen(a)} style={{ cursor: "pointer" }}>
              <ActivityCard compact title={a.title} category={a.category} date={a.date} time={a.time} location={a.location} distance={a.distance} synced={!!synced[a.id]} onSync={() => onSync(a.id)} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

window.GorgonApp = Object.assign(window.GorgonApp || {}, { SearchScreen });
})();
