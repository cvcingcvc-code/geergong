// Gorgon — Map view.
// Demo MVP: dynamic pin layout for any number of activities, live count,
// a tappable location list, and support for focusing a specific activity (from detail).
//
// PHASE 5.1: the map renders ONLY the activities inside the current district
// selection — the pins, the chip rail, the "附近 N 场" badge and the selected
// card all come from the same filtered array. No district means 全上海, i.e.
// the whole dataset, so nothing changes by default. An empty selection renders
// an empty state rather than silently falling back to other districts.
(function(){
const { SearchField, Tag } = window.GorgonDesignSystem_56aa78;
const C = window.GorgonCommon;
const D = window.GorgonDistrict;
const _MCATS = window.GorgonDesignSystem_56aa78.CATEGORIES;
const DistrictPicker = (window.GorgonApp && window.GorgonApp.DistrictPicker) || function () { return null; };

function catColor(key) {
  const c = _MCATS[key];
  return (c && c.color) || "var(--brand)";
}

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
  const c = catColor(a.category);
  return (
    <button data-gg-pin-district={a.__district || ""} onClick={onClick} style={{ position: "absolute", left: `${a._x}%`, top: `${a._y}%`, transform: "translate(-50%,-100%)", border: "none", background: "transparent", cursor: "pointer", zIndex: selected ? 5 : 2 }}>
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

function MapEmpty({ district, onClear }) {
  return (
    <div data-gg-region="map-empty" style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, zIndex: 12 }}>
      <div style={{ width: "min(420px, 100%)", background: "var(--surface-card)", borderRadius: "var(--radius-xl)", boxShadow: "var(--shadow-xl)", padding: 4 }}>
        <C.NoticeBlock
          icon="map-pin-off" tone="warning"
          title={D.emptyTitle(district, false)}
          body={"当前地区没有可显示的活动。地图只画筛选后范围内的活动，不会用其他区域的结果把它填满。"}
          action={D.isAll(district) ? null : (
            <button className="gg-chip" onClick={onClear}>查看全上海</button>
          )}
        />
      </div>
    </div>
  );
}

function MapScreen({ synced, onSync, onOpen, focusId, district, onDistrictChange }) {
  // ONE filtered dataset for the whole screen.
  const acts = React.useMemo(
    () => D.filter(window.GORGON_DATA.activities, district)
      .map((a) => Object.assign({}, a, { __district: D.districtOf(a) })),
    [district]
  );
  const pos = React.useMemo(() => layout(acts.length), [acts.length]);
  const placed = acts.map((a, i) => Object.assign({}, a, { _x: pos[i].x, _y: pos[i].y }));

  const [sel, setSel] = React.useState(null);
  const selected = placed.find((a) => a.id === sel) || placed[0] || null;

  // A district change re-scopes the set: keep the focus only when it survived
  // the filter, otherwise fall back to the first pin in range.
  React.useEffect(() => {
    if (focusId && placed.some((a) => a.id === focusId)) setSel(focusId);
    else if (!placed.some((a) => a.id === sel)) setSel(placed[0] ? placed[0].id : null);
  }, [focusId, district]);

  React.useEffect(() => { window.lucide && window.lucide.createIcons(); }, [district, acts.length]);

  return (
    <div data-gg-screen="map" style={{ flex: 1, minHeight: 0, position: "relative", overflow: "hidden", background: "#eaeef6" }}>
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

      {/* Floating search + the shared district picker */}
      <div className="gg-map-search">
        <div style={{ flex: 1 }}><SearchField placeholder="在地图上找活动" readOnly /></div>
        <button style={{ width: 48, height: 48, borderRadius: "var(--radius-pill)", border: "1px solid var(--border-subtle)", background: "var(--surface-card)", boxShadow: "var(--shadow-sm)", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flex: "none" }}>
          <i data-lucide="locate-fixed" style={{ width: 20, height: 20, color: "var(--brand)" }} />
        </button>
      </div>

      {/* Legend — live count of the FILTERED set, next to the same picker the
          other screens use, so the region is visible and changeable here. */}
      <div style={{ position: "absolute", top: 70, left: 16, right: 16, zIndex: 9, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span data-gg-map-count={acts.length} style={{ display: "inline-flex" }}>
          <Tag tone="ink" size="sm">{D.isAll(district) ? "附近" : district} {acts.length} 场</Tag>
        </span>
        <DistrictPicker value={district} onChange={onDistrictChange}
          activities={window.GORGON_DATA.activities} size="sm" />
      </div>

      {acts.length === 0 && <MapEmpty district={district} onClear={() => onDistrictChange(D.ALL)} />}

      {/* Pins */}
      {placed.map((a) => <MapPin key={a.id} a={a} selected={a.id === sel} onClick={() => setSel(a.id)} />)}

      {/* Location list — chip rail on mobile, right-hand panel on desktop */}
      <div className="gg-map-list">
        {placed.map((a) => {
          const on = a.id === sel;
          return (
            <button key={a.id} onClick={() => setSel(a.id)} style={{ flex: "none", display: "inline-flex", alignItems: "center", gap: 6, border: on ? "1px solid var(--brand)" : "1px solid var(--border-subtle)", background: on ? "var(--brand)" : "var(--surface-card)", color: on ? "#fff" : "var(--text-body)", fontFamily: "var(--font-sans)", fontWeight: 600, fontSize: 12.5, padding: "7px 12px", borderRadius: "var(--radius-pill)", cursor: "pointer", boxShadow: "var(--shadow-sm)", whiteSpace: "nowrap" }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: on ? "#fff" : catColor(a.category), flex: "none" }} />
              {a.venue}
            </button>
          );
        })}
      </div>

      {/* Bottom card — docks bottom on mobile, bottom-left on desktop.
          Nothing selected (empty district) means no card at all. */}
      {selected && (
        <div className="gg-map-card">
          <div data-gg-map-selected={selected.id} onClick={() => onOpen(selected)} style={{ cursor: "pointer", background: "var(--surface-card)", borderRadius: "var(--radius-xl)", boxShadow: "var(--shadow-xl)", padding: 14, display: "flex", gap: 14, alignItems: "center" }}>
            <div style={{ width: 84, height: 84, borderRadius: "var(--radius-lg)", flex: "none", background: `linear-gradient(150deg, color-mix(in oklch, ${catColor(selected.category)} 88%, #fff), color-mix(in oklch, ${catColor(selected.category)} 60%, var(--indigo-800)))` }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: catColor(selected.category) }} />
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
      )}
    </div>
  );
}

window.GorgonApp = Object.assign(window.GorgonApp || {}, { MapScreen });
})();
