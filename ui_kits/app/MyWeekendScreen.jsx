// Gorgon — My Weekend (synced schedule) + Favorites.
// Demo MVP: My Weekend persists via localStorage (gorgon_my_weekend);
// added a "收藏" view backed by gorgon_favorites.
(function(){
const { ActivityCard, Button, StatBlock, SegmentedControl } = window.GorgonDesignSystem_56aa78;

function DayGroup({ label, dateLabel, items, synced, onSync, onOpen }) {
  if (!items.length) return null;
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "0 20px 12px" }}>
        <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 19, color: "var(--text-strong)" }}>{label}</span>
        <span style={{ fontSize: 13, color: "var(--text-muted)", fontWeight: 500 }}>{dateLabel}</span>
        <span style={{ marginLeft: "auto", padding: "0 20px 0 0", fontSize: 12.5, color: "var(--text-faint)" }}>{items.length} 场</span>
      </div>
      <div style={{ padding: "0 20px", display: "flex", flexDirection: "column", gap: 12 }}>
        {items.map((a) => (
          <div key={a.id} onClick={() => onOpen(a)} style={{ cursor: "pointer" }}>
            <ActivityCard compact title={a.title} category={a.category} date={a.date} time={a.time} location={a.location} distance={a.distance} image={a.image} synced={!!synced[a.id]} onSync={() => onSync(a.id)} />
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyWeekend({ onDiscover }) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 40, textAlign: "center" }}>
      <div style={{ width: 92, height: 92, borderRadius: "var(--radius-2xl)", background: "var(--grad-sync)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "var(--shadow-brand)", marginBottom: 20 }}>
        <i data-lucide="calendar-heart" style={{ width: 44, height: 44, color: "#fff" }} />
      </div>
      <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 700, color: "var(--text-strong)", marginBottom: 8 }}>周末还空着</h2>
      <p style={{ fontSize: 14.5, color: "var(--text-muted)", lineHeight: 1.6, maxWidth: 260, marginBottom: 22 }}>去发现页逛逛，把喜欢的活动一键加入到这里。</p>
      <Button variant="primary" size="lg" onClick={onDiscover} leadingIcon={<i data-lucide="compass" style={{ width: 18, height: 18 }} />}>去发现活动</Button>
    </div>
  );
}

function EmptyFavorites({ onDiscover }) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 40, textAlign: "center" }}>
      <div style={{ width: 92, height: 92, borderRadius: "var(--radius-2xl)", background: "var(--bg-sunken)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 20 }}>
        <i data-lucide="heart" style={{ width: 42, height: 42, color: "var(--text-faint)" }} />
      </div>
      <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 700, color: "var(--text-strong)", marginBottom: 8 }}>还没有收藏</h2>
      <p style={{ fontSize: 14.5, color: "var(--text-muted)", lineHeight: 1.6, maxWidth: 260, marginBottom: 22 }}>在活动详情页点右上角的 ❤️，就能把它收藏到这里。</p>
      <Button variant="primary" size="lg" onClick={onDiscover} leadingIcon={<i data-lucide="compass" style={{ width: 18, height: 18 }} />}>去发现活动</Button>
    </div>
  );
}

function FavRow({ a, onOpen, onRemove }) {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center", padding: 12, borderRadius: "var(--radius-md)", border: "1px solid var(--border-subtle)", background: "var(--surface-card)" }}>
      <div style={{ width: 4, alignSelf: "stretch", borderRadius: 4, background: `var(--cat-${a.category})`, flex: "none" }} />
      <div onClick={() => onOpen(a)} style={{ flex: 1, minWidth: 0, cursor: "pointer" }}>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 12, fontWeight: 600, color: "var(--brand)", fontVariantNumeric: "tabular-nums" }}>{a.date} · {a.time}</div>
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-strong)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.title}</div>
        <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>{a.venue} · {a.distance}</div>
      </div>
      <button onClick={() => onRemove(a.id)} aria-label="取消收藏" title="取消收藏" style={{ flex: "none", width: 38, height: 38, borderRadius: "50%", border: "none", background: "var(--danger-soft)", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
        <i data-lucide="heart-off" style={{ width: 18, height: 18, color: "var(--danger)" }} />
      </button>
    </div>
  );
}

function MyWeekendScreen({ synced, onSync, onOpen, onDiscover, favorites, onToggleFavorite }) {
  const { activities } = window.GORGON_DATA;
  const [view, setView] = React.useState("我的周末");
  const syncedList = activities.filter((a) => synced[a.id]);
  const favList = activities.filter((a) => (favorites || []).indexOf(a.id) >= 0);
  const sat = syncedList.filter((a) => a.day === "sat");
  const sun = syncedList.filter((a) => a.day === "sun");
  const freeCount = syncedList.filter((a) => a.price === "免费").length;

  React.useEffect(() => { window.lucide && window.lucide.createIcons(); }, [view, favorites, synced]);

  const isFav = view === "收藏";

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflowY: "auto", scrollbarWidth: "none" }}>
      <div style={{ padding: "8px 20px 14px" }}>
        <div style={{ fontFamily: "var(--font-display)", textTransform: "uppercase", letterSpacing: "0.12em", fontSize: 11, fontWeight: 600, color: "var(--brand)" }}>{isFav ? "Saved" : "My Weekend · 6.20–6.21"}</div>
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: 28, fontWeight: 700, color: "var(--text-strong)", marginTop: 3, marginBottom: 12 }}>{isFav ? "我的收藏" : "我的周末"}</h1>
        <SegmentedControl options={["我的周末", "收藏"]} value={view} onChange={setView} />
      </div>

      {!isFav && (syncedList.length === 0 ? (
        <EmptyWeekend onDiscover={onDiscover} />
      ) : (
        <>
          <div style={{ margin: "0 20px 20px", padding: "16px 18px", borderRadius: "var(--radius-lg)", background: "var(--surface-card)", border: "1px solid var(--border-subtle)", boxShadow: "var(--shadow-sm)", display: "flex", justifyContent: "space-around" }}>
            <StatBlock value={syncedList.length} label="已加入" accent="brand" align="center" />
            <div style={{ width: 1, background: "var(--border-subtle)" }} />
            <StatBlock value={freeCount} label="免费场次" accent="mint" align="center" />
            <div style={{ width: 1, background: "var(--border-subtle)" }} />
            <StatBlock value={`${sat.length}/${sun.length}`} label="周六 / 周日" align="center" />
          </div>
          <DayGroup label="周六" dateLabel="6月20日" items={sat} synced={synced} onSync={onSync} onOpen={onOpen} />
          <DayGroup label="周日" dateLabel="6月21日" items={sun} synced={synced} onSync={onSync} onOpen={onOpen} />
        </>
      ))}

      {isFav && (favList.length === 0 ? (
        <EmptyFavorites onDiscover={onDiscover} />
      ) : (
        <div style={{ padding: "0 20px 24px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 2 }}>共收藏 <b style={{ color: "var(--text-strong)" }}>{favList.length}</b> 场</div>
          {favList.map((a) => (
            <FavRow key={a.id} a={a} onOpen={onOpen} onRemove={onToggleFavorite} />
          ))}
        </div>
      ))}
    </div>
  );
}

window.GorgonApp = Object.assign(window.GorgonApp || {}, { MyWeekendScreen });
})();
