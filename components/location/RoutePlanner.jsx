import React from "react";

const MODE_META = {
  metro:  { icon: "train-front", label: "地铁" },
  bus:    { icon: "bus", label: "公交" },
  bike:   { icon: "bike", label: "骑行" },
  walk:   { icon: "footprints", label: "步行" },
  drive:  { icon: "car-front", label: "驾车" },
  taxi:   { icon: "car-taxi-front", label: "打车" },
};

function RouteOption({ opt, recommended }) {
  const m = MODE_META[opt.mode] || MODE_META.metro;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 13, padding: "12px 14px",
      borderRadius: "var(--radius-md)",
      border: recommended ? "1.5px solid var(--brand)" : "1px solid var(--border-subtle)",
      background: recommended ? "var(--brand-soft)" : "var(--surface-card)",
    }}>
      <span style={{ width: 38, height: 38, borderRadius: "var(--radius-sm)", flex: "none", background: recommended ? "var(--surface-card)" : "var(--bg-sunken)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
        <i data-lucide={m.icon} style={{ width: 19, height: 19, color: recommended ? "var(--brand)" : "var(--text-body)" }} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ fontFamily: "var(--font-sans)", fontWeight: "var(--weight-bold)", fontSize: "var(--text-base)", color: "var(--text-strong)" }}>{opt.line || m.label}</span>
          {recommended && <span style={{ fontFamily: "var(--font-display)", fontSize: "var(--text-2xs)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--brand)", background: "var(--surface-card)", padding: "3px 7px", borderRadius: "var(--radius-pill)" }}>推荐</span>}
        </div>
        <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{opt.detail}</div>
      </div>
      <div style={{ textAlign: "right", flex: "none" }}>
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "var(--text-md)", color: "var(--text-strong)", fontVariantNumeric: "tabular-nums" }}>{opt.time}</div>
        {opt.cost != null && <div style={{ fontSize: "var(--text-2xs)", color: "var(--text-faint)" }}>{opt.cost}</div>}
      </div>
    </div>
  );
}

/**
 * Route planner — distance/ETA summary + transit options from the user to a
 * venue. Pass a `transit` array; the first option (or any with recommended:true)
 * is highlighted. Hook the navigate button to a MapAppSheet.
 */
export function RoutePlanner({ from = "我的位置", venue = "目的地", distance = "", transit = [], onNavigate, style = {}, ...rest }) {
  const recIndex = Math.max(0, transit.findIndex((t) => t.recommended));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, ...style }} {...rest}>
      {/* From → To */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", background: "var(--bg-sunken)", borderRadius: "var(--radius-md)" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: "none", paddingTop: 3 }}>
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--brand)" }} />
          <span style={{ width: 2, height: 20, background: "var(--border-default)", margin: "2px 0" }} />
          <i data-lucide="map-pin" style={{ width: 15, height: 15, color: "var(--accent-strong)" }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{from}</div>
          <div style={{ height: 9 }} />
          <div style={{ fontSize: "var(--text-sm)", fontWeight: 700, color: "var(--text-strong)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{venue}</div>
        </div>
        {distance && (
          <div style={{ textAlign: "right", flex: "none" }}>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "var(--text-lg)", color: "var(--brand)", fontVariantNumeric: "tabular-nums" }}>{distance}</div>
            <div style={{ fontSize: "var(--text-2xs)", color: "var(--text-faint)" }}>直线距离</div>
          </div>
        )}
      </div>

      {/* Options */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {transit.map((opt, i) => <RouteOption key={i} opt={opt} recommended={i === recIndex} />)}
      </div>

      {/* Navigate CTA */}
      <button onClick={onNavigate} style={{
        display: "flex", alignItems: "center", justifyContent: "center", gap: 9, width: "100%",
        border: "none", borderRadius: "var(--radius-md)", padding: "14px",
        background: "var(--brand)", color: "#fff", cursor: "pointer",
        fontFamily: "var(--font-sans)", fontWeight: "var(--weight-semibold)", fontSize: "var(--text-base)",
        boxShadow: "var(--shadow-brand)",
      }}>
        <i data-lucide="navigation" style={{ width: 18, height: 18 }} />
        用导航软件打开
      </button>
    </div>
  );
}
