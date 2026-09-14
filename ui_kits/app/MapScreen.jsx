// Gorgon — Map view.
(function(){
const { SearchField, Tag } = window.GorgonDesignSystem_56aa78;
const _MCATS = window.GorgonDesignSystem_56aa78.CATEGORIES;

function MapPin({ a, selected, onClick }) {
  const c = _MCATS[a.category].color;
  return (
    <button onClick={onClick} style={{ position: "absolute", left: `${a._x}%`, top: `${a._y}%`, transform: "translate(-50%,-100%)", border: "none", background: "transparent", cursor: "pointer", zIndex: selected ? 5 : 2 }}>
      {selected ? (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: c, color: "#fff", padding: "7px 12px 7px 9px", borderRadius: "var(--radius-pill)", boxShadow: "var(--shadow-lg)", fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 13, whiteSpace: "nowrap" }}>
          <span style={{ width: 18, height: 18, borderRadius: "50%", background: "rgba(255,255,255,0.28)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
            <i data-lucide="map-pin" style={{ width: 12, height: 12, color: "#fff" }} />
          </span>
          {a.price}
        </span>
      ) : (
        <span style={{ width: 30, height: 30, borderRadius: "50% 50% 50% 0", background: "#fff", transform: "rotate(-45deg)", display: "inline-flex", alignItems: "center", justifyContent: "center", boxShadow: "var(--shadow-md)", border: `2px solid ${c}` }}>
          <span style={{ width: 11, height: 11, borderRadius: "50%", background: c, transform: "rotate(45deg)" }} />
        </span>
      )}
    </button>
  );
}

function MapScreen({ synced, onSync, onOpen }) {
  const acts = window.GORGON_DATA.activities.map((a, i) => ({ ...a, _x: [28, 62, 44, 76, 18, 54][i], _y: [32, 26, 54, 60, 64, 78][i] }));
  const [sel, setSel] = React.useState(acts[1].id);
  const selected = acts.find((a) => a.id === sel);

  return (
    <div style={{ flex: 1, position: "relative", overflow: "hidden", background: "#eaeef6" }}>
      {/* Map base */}
      <div style={{ position: "absolute", inset: 0 }}>
        <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(#dfe5f0 1px,transparent 1px),linear-gradient(90deg,#dfe5f0 1px,transparent 1px)", backgroundSize: "44px 44px" }} />
        {/* river */}
        <div style={{ position: "absolute", left: "-10%", top: "40%", width: "130%", height: 46, background: "#cfe0f7", transform: "rotate(-8deg)", borderRadius: 40, opacity: 0.9 }} />
        {/* parks */}
        <div style={{ position: "absolute", left: "8%", top: "12%", width: 90, height: 70, background: "#d9ecdd", borderRadius: 20 }} />
        <div style={{ position: "absolute", right: "10%", bottom: "16%", width: 110, height: 80, background: "#d9ecdd", borderRadius: 24 }} />
        {/* main roads */}
        <div style={{ position: "absolute", left: 0, top: "22%", width: "100%", height: 8, background: "#fff", opacity: 0.85 }} />
        <div style={{ position: "absolute", left: "40%", top: 0, width: 8, height: "100%", background: "#fff", opacity: 0.85 }} />
      </div>

      {/* Floating search */}
      <div style={{ position: "absolute", top: 8, left: 16, right: 16, zIndex: 10, display: "flex", gap: 10 }}>
        <div style={{ flex: 1 }}><SearchField placeholder="在地图上找活动" /></div>
        <button style={{ width: 48, height: 48, borderRadius: "var(--radius-pill)", border: "1px solid var(--border-subtle)", background: "var(--surface-card)", boxShadow: "var(--shadow-sm)", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flex: "none" }}>
          <i data-lucide="locate-fixed" style={{ width: 20, height: 20, color: "var(--brand)" }} />
        </button>
      </div>

      {/* Category legend */}
      <div style={{ position: "absolute", top: 70, left: 16, zIndex: 9, display: "flex", gap: 6 }}>
        <Tag tone="ink" size="sm">附近 6 场</Tag>
      </div>

      {/* Pins */}
      {acts.map((a) => <MapPin key={a.id} a={a} selected={a.id === sel} onClick={() => setSel(a.id)} />)}

      {/* Bottom card */}
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 10, padding: "0 14px 16px" }}>
        <div onClick={() => onOpen(selected)} style={{ cursor: "pointer", background: "var(--surface-card)", borderRadius: "var(--radius-xl)", boxShadow: "var(--shadow-xl)", padding: 14, display: "flex", gap: 14, alignItems: "center" }}>
          <div style={{ width: 84, height: 84, borderRadius: "var(--radius-lg)", flex: "none", background: `linear-gradient(150deg, color-mix(in oklch, ${_MCATS[selected.category].color} 88%, #fff), color-mix(in oklch, ${_MCATS[selected.category].color} 60%, var(--indigo-800)))` }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: _MCATS[selected.category].color }} />
              <span style={{ fontFamily: "var(--font-display)", fontSize: 11.5, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-muted)", fontWeight: 600 }}>{selected.date} · {selected.time}</span>
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-strong)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selected.title}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 5, color: "var(--text-muted)", fontSize: 12.5 }}>
              <i data-lucide="map-pin" style={{ width: 13, height: 13 }} />{selected.venue} · {selected.distance}
            </div>
          </div>
          <button onClick={(e) => { e.stopPropagation(); onSync(selected.id); }} style={{ flex: "none", width: 50, height: 50, borderRadius: "50%", border: "none", cursor: "pointer", background: synced[selected.id] ? "var(--accent)" : "var(--brand)", color: synced[selected.id] ? "#06241B" : "#fff", boxShadow: synced[selected.id] ? "var(--shadow-mint)" : "var(--shadow-brand)", display: "inline-flex", alignItems: "center", justifyContent: "center", transition: "all var(--dur-base) var(--ease-spring)" }}>
            <i data-lucide={synced[selected.id] ? "check" : "plus"} style={{ width: 22, height: 22 }} />
          </button>
        </div>
      </div>
    </div>
  );
}

window.GorgonApp = Object.assign(window.GorgonApp || {}, { MapScreen });
})();
