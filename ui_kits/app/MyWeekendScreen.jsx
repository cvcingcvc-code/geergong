// Gorgon — My Weekend (synced schedule).
(function(){
const { ActivityCard, Button, StatBlock } = window.GorgonDesignSystem_56aa78;

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
            <ActivityCard compact title={a.title} category={a.category} date={a.date} time={a.time} location={a.location} distance={a.distance} synced={!!synced[a.id]} onSync={() => onSync(a.id)} />
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyState({ onDiscover }) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 40, textAlign: "center" }}>
      <div style={{ width: 92, height: 92, borderRadius: "var(--radius-2xl)", background: "var(--grad-sync)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "var(--shadow-brand)", marginBottom: 20 }}>
        <i data-lucide="calendar-heart" style={{ width: 44, height: 44, color: "#fff" }} />
      </div>
      <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 700, color: "var(--text-strong)", marginBottom: 8 }}>周末还空着</h2>
      <p style={{ fontSize: 14.5, color: "var(--text-muted)", lineHeight: 1.6, maxWidth: 260, marginBottom: 22 }}>去发现页逛逛，把喜欢的活动一键同步到这里。</p>
      <Button variant="primary" size="lg" onClick={onDiscover} leadingIcon={<i data-lucide="compass" style={{ width: 18, height: 18 }} />}>去发现活动</Button>
    </div>
  );
}

function MyWeekendScreen({ synced, onSync, onOpen, onDiscover }) {
  const { activities } = window.GORGON_DATA;
  const syncedList = activities.filter((a) => synced[a.id]);
  const sat = syncedList.filter((a) => a.day === "sat");
  const sun = syncedList.filter((a) => a.day === "sun");
  const freeCount = syncedList.filter((a) => a.price === "免费").length;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflowY: "auto", scrollbarWidth: "none" }}>
      <div style={{ padding: "8px 20px 16px" }}>
        <div style={{ fontFamily: "var(--font-display)", textTransform: "uppercase", letterSpacing: "0.12em", fontSize: 11, fontWeight: 600, color: "var(--brand)" }}>My Weekend · 6.15–6.16</div>
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: 28, fontWeight: 700, color: "var(--text-strong)", marginTop: 3 }}>我的周末</h1>
      </div>

      {syncedList.length === 0 ? (
        <EmptyState onDiscover={onDiscover} />
      ) : (
        <>
          <div style={{ margin: "0 20px 20px", padding: "16px 18px", borderRadius: "var(--radius-lg)", background: "var(--surface-card)", border: "1px solid var(--border-subtle)", boxShadow: "var(--shadow-sm)", display: "flex", justifyContent: "space-around" }}>
            <StatBlock value={syncedList.length} label="已同步" accent="brand" align="center" />
            <div style={{ width: 1, background: "var(--border-subtle)" }} />
            <StatBlock value={freeCount} label="免费场次" accent="mint" align="center" />
            <div style={{ width: 1, background: "var(--border-subtle)" }} />
            <StatBlock value={`${sat.length}/${sun.length}`} label="周六 / 周日" align="center" />
          </div>
          <DayGroup label="周六" dateLabel="6月15日" items={sat} synced={synced} onSync={onSync} onOpen={onOpen} />
          <DayGroup label="周日" dateLabel="6月16日" items={sun} synced={synced} onSync={onSync} onOpen={onOpen} />
        </>
      )}
    </div>
  );
}

window.GorgonApp = Object.assign(window.GorgonApp || {}, { MyWeekendScreen });
})();
