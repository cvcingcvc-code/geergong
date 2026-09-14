// Gorgon — Map view.
// Demo MVP: dynamic pin layout for any number of activities, live count,
// a tappable location list, and support for focusing a specific activity (from detail).
(function(){
const { SearchField, Tag } = window.GorgonDesignSystem_56aa78;
const _MCATS = window.GorgonDesignSystem_56aa78.CATEGORIES;

/** Deterministic spread layout so pins never depend on a hard-coded 6-item array. */
function layout(n) {
  const cols = Math.min(4, Math.max(3, Math.ceil(Math.sqrt(n))));
  const rows = Math.ceil(n / cols);
  const out = [];
  for (let i = 0; i < n; i++) {
    const c = i % cols, r = Math.floor(i / cols);
    const x = 14 + (c + 0.5) * (72 / cols);
    const y = 14 + (r + 0.5) * (60 / rows);
    const jx = ((i * 37) % 11 - 5) * 0.5;
    const jy = ((i * 53) % 9 - 4) * 0.5;
    out.push({ x: Math.max(8, Math.min(92, x + jx)), y: Math.max(12, Math.min(78, y + jy)) });
  }
  return out;
}

/** Inline pin glyph. Deliberately NOT a lucide <i data-lucide>: this element is
 *  conditionally swapped by React, and a lucide-replaced node would break React's
 *  DOM reconciliation (removeChild on a detached node). React must own it fully. */
function PinGlyph({ color }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

function MapPin({ a, selected, onClick }) {
  const c = _MCATS[a.category].color;
  return (
    <button onClick={onClick} style={{ position: "absolute", left: `${a._x}%`, top: `${a._y}%`, transform: "translate(-50%,-100%)", border: "none", background: "transparent", cursor: "pointer", zIndex: selected ? 5 : 2 }}>
      {selected ? (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: c, color: "#fff", padding: "7px 12px 7px 9px", borderRadius: "var(--radius-pill)", boxShadow: "var(--shadow-lg)", fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 13, whiteSpace: "nowrap" }}>
          <span style={{ width: 18, height: 18, borderRadius: "50%", background: "rgba(255,255,255,0.28)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
            <PinGlyph color="#fff" />
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

function MapScreen({ synced, onSync, onOpen, focusId }) {
  const pos = layout(window.GORGON_DATA.activities.length);
  const acts = window.GORGON_DATA.activities.map((a, i) => ({ ...a, _x: pos[i].x, _y: pos[i].y }));
  const [sel, setSel] = React.useState(focusId || (acts[0] && acts[0].id));
  const selected = acts.find((a) => a.id === sel) || acts[0];

  React.useEffect(() => {
    if (focusId && acts.some((a) => a.id === focusId)) setSel(focusId);
  }, [focusId]);

  React.useEffect(() => { window.lucide && window.lucide.createIcons(); }, []);

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
        <div style={{ flex: 1 }}><SearchField placeholder="在地图上找活动" readOnly /></div>
        <button style={{ width: 48, height: 48, borderRadius: "var(--radius-pill)", border: "1px solid var(--border-subtle)", background: "var(--surface-card)", boxShadow: "var(--shadow-sm)", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flex: "none" }}>
          <i data-lucide="locate-fixed" style={{ width: 20, height: 20, color: "var(--brand)" }} />
        </button>
      </div>

      {/* Legend — live count */}
      <div style={{ position: "absolute", top: 70, left: 16, zIndex: 9, display: "flex", gap: 6 }}>
        <Tag tone="ink" size="sm">附近 {acts.length} 场</Tag>
      </div>

      {/* Pins */}
      {acts.map((a) => <MapPin key={a.id} a={a} selected={a.id === sel} onClick={() => setSel(a.id)} />)}

      {/* Location list */}
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 132, zIndex: 9, padding: "0 14px 8px", display: "flex", gap: 8, overflowX: "auto", scrollbarWidth: "none" }}>
        {acts.map((a) => {
          const on = a.id === sel;
          return (
            <button key={a.id} onClick={() => setSel(a.id)} style={{ flex: "none", display: "inline-flex", alignItems: "center", gap: 6, border: on ? "1px solid var(--brand)" : "1px solid var(--border-subtle)", background: on ? "var(--brand)" : "var(--surface-card)", color: on ? "#fff" : "var(--text-body)", fontFamily: "var(--font-sans)", fontWeight: 600, fontSize: 12.5, padding: "7px 12px", borderRadius: "var(--radius-pill)", cursor: "pointer", boxShadow: "var(--shadow-sm)", whiteSpace: "nowrap" }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: on ? "#fff" : _MCATS[a.category].color, flex: "none" }} />
              {a.venue}
            </button>
          );
        })}
      </div>

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
          <button onClick={(e) => { e.stopPropagation(); onSync(selected.id); }} aria-label="加入我的周末" style={{ flex: "none", width: 50, height: 50, borderRadius: "50%", border: "none", cursor: "pointer", background: synced[selected.id] ? "var(--accent)" : "var(--brand)", color: synced[selected.id] ? "#06241B" : "#fff", boxShadow: synced[selected.id] ? "var(--shadow-mint)" : "var(--shadow-brand)", display: "inline-flex", alignItems: "center", justifyContent: "center", transition: "all var(--dur-base) var(--ease-spring)" }}>
            <i data-lucide={synced[selected.id] ? "check" : "plus"} style={{ width: 22, height: 22 }} />
          </button>
        </div>
      </div>
    </div>
  );
}

window.GorgonApp = Object.assign(window.GorgonApp || {}, { MapScreen });
})();
