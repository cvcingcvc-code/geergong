// Gorgon — Discover feed (home).
(function(){
const { ActivityCard, SearchField, SegmentedControl, Avatar, CategoryDot } = window.GorgonDesignSystem_56aa78;

function CategoryRail({ value, onChange }) {
  const cats = window.GORGON_DATA.categories;
  return (
    <div style={{ display: "flex", gap: 8, overflowX: "auto", padding: "0 20px 2px", scrollbarWidth: "none" }}>
      {cats.map((c) => {
        const on = c.key === value;
        return (
          <button key={c.key} onClick={() => onChange(c.key)} style={{
            flex: "none", display: "inline-flex", alignItems: "center", gap: 7,
            border: on ? "1px solid var(--brand)" : "1px solid var(--border-subtle)",
            background: on ? "var(--brand)" : "var(--surface-card)",
            color: on ? "#fff" : "var(--text-body)",
            fontFamily: "var(--font-sans)", fontWeight: 600, fontSize: 13.5,
            padding: "9px 15px", borderRadius: "var(--radius-pill)", cursor: "pointer",
            transition: "all var(--dur-fast) var(--ease-out)",
          }}>
            {c.key !== "all" && <span style={{ width: 8, height: 8, borderRadius: "50%", background: on ? "#fff" : `var(--cat-${c.key})` }} />}
            {c.label}
          </button>
        );
      })}
    </div>
  );
}

function DiscoverScreen({ synced, onSync, onOpen }) {
  const { user, activities } = window.GORGON_DATA;
  const [cat, setCat] = React.useState("all");
  const [when, setWhen] = React.useState("本周末");
  const list = activities.filter((a) => cat === "all" || a.category === cat);

  return (
    <div style={{ flex: 1, overflowY: "auto", scrollbarWidth: "none" }}>
      {/* Header */}
      <div style={{ padding: "8px 20px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 5, color: "var(--text-muted)", fontSize: 12.5, fontWeight: 500 }}>
            <i data-lucide="map-pin" style={{ width: 13, height: 13 }} />{user.campus}
          </div>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 23, color: "var(--text-strong)", letterSpacing: "-0.01em", marginTop: 3 }}>
            周末好，{user.name} 👋
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button style={{ position: "relative", width: 42, height: 42, borderRadius: "var(--radius-md)", border: "1px solid var(--border-subtle)", background: "var(--surface-card)", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <i data-lucide="bell" style={{ width: 20, height: 20, color: "var(--text-body)" }} />
            <span style={{ position: "absolute", top: 9, right: 10, width: 8, height: 8, borderRadius: "50%", background: "var(--danger)", boxShadow: "0 0 0 2px var(--surface-card)" }} />
          </button>
          <Avatar name={user.name} size="md" ring />
        </div>
      </div>

      {/* Search */}
      <div style={{ padding: "0 20px 14px" }}>
        <SearchField placeholder="搜索活动、地点、标签" />
      </div>

      {/* Hero count strip */}
      <div style={{ margin: "0 20px 16px", padding: "16px 18px", borderRadius: "var(--radius-lg)", background: "var(--grad-sync)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "space-between", boxShadow: "var(--shadow-brand)" }}>
        <div>
          <div style={{ fontFamily: "var(--font-display)", textTransform: "uppercase", letterSpacing: "0.12em", fontSize: 11, fontWeight: 600, opacity: 0.9 }}>This Weekend</div>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 26, marginTop: 2 }}>就在你附近 38 场</div>
        </div>
        <i data-lucide="sparkles" style={{ width: 30, height: 30, opacity: 0.95 }} />
      </div>

      <div style={{ marginBottom: 14 }}><CategoryRail value={cat} onChange={setCat} /></div>

      <div style={{ padding: "0 20px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <SegmentedControl options={["本周末", "下周末", "全部"]} value={when} onChange={setWhen} />
        <button style={{ display: "inline-flex", alignItems: "center", gap: 5, border: "none", background: "transparent", color: "var(--text-muted)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
          <i data-lucide="sliders-horizontal" style={{ width: 16, height: 16 }} />筛选
        </button>
      </div>

      {/* Feed */}
      <div style={{ padding: "0 20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
        {list.map((a) => (
          <div key={a.id} onClick={() => onOpen(a)} style={{ cursor: "pointer" }}>
            <ActivityCard
              title={a.title} category={a.category} date={a.date} time={a.time}
              location={a.location} distance={a.distance} price={a.price}
              tags={a.tags} hot={a.hot} synced={!!synced[a.id]}
              onSync={() => onSync(a.id)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

window.GorgonApp = Object.assign(window.GorgonApp || {}, { DiscoverScreen });
})();
