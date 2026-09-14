import React from "react";

/* Deep-link builders for China map apps. These URIs open the native app if
   installed, else fall back to web. NOTE: coordinate systems differ — Amap &
   Tencent use GCJ-02, Baidu uses BD-09, Apple/GPS use WGS-84. In production,
   convert the stored coordinate to each provider's system before linking. */
function buildLinks(lng, lat, name) {
  const n = encodeURIComponent(name || "目的地");
  return {
    amap:   `https://uri.amap.com/navigation?to=${lng},${lat},${n}&mode=bus&policy=1&src=gorgon&coordinate=gaode&callnative=1`,
    baidu:  `https://api.map.baidu.com/direction?destination=latlng:${lat},${lng}|name:${n}&mode=transit&region=上海&output=html&src=gorgon`,
    tencent:`https://apis.map.qq.com/uri/v1/routeplan?type=bus&to=${n}&tocoord=${lat},${lng}&referer=gorgon`,
    apple:  `https://maps.apple.com/?daddr=${lat},${lng}&dirflg=r`,
  };
}

const APPS = [
  { key: "amap", name: "高德地图", sub: "Amap", color: "#00A0E9", icon: "navigation-2" },
  { key: "baidu", name: "百度地图", sub: "Baidu", color: "#2932E1", icon: "map" },
  { key: "tencent", name: "腾讯地图", sub: "Tencent", color: "#06B14F", icon: "map-pinned" },
  { key: "apple", name: "Apple 地图", sub: "iOS", color: "#1C1C1E", icon: "compass" },
];

/**
 * Bottom sheet that hands navigation off to the user's own map app via deep
 * links (高德 / 百度 / 腾讯 / Apple). Render conditionally on `open`; includes its
 * own scrim. Mount inside a position:relative container (e.g. the phone frame).
 */
export function MapAppSheet({ open = false, onClose, coord = {}, venue = "目的地", apps, style = {}, ...rest }) {
  if (!open) return null;
  const list = apps || APPS;
  const links = buildLinks(coord.lng ?? 121.47, coord.lat ?? 31.23, venue);

  return (
    <div
      onClick={onClose}
      style={{ position: "absolute", inset: 0, zIndex: "var(--z-modal)", background: "rgba(12,13,18,0.45)", display: "flex", alignItems: "flex-end", backdropFilter: "blur(2px)" }}
      {...rest}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", background: "var(--surface-card)", borderRadius: "var(--radius-2xl) var(--radius-2xl) 0 0", padding: "12px 20px 26px", boxShadow: "0 -8px 30px rgba(28,20,78,0.18)", ...style }}
      >
        <div style={{ width: 40, height: 5, borderRadius: 3, background: "var(--slate-300)", margin: "0 auto 16px" }} />

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <i data-lucide="navigation" style={{ width: 20, height: 20, color: "var(--brand)" }} />
          <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "var(--text-xl)", color: "var(--text-strong)" }}>选择导航软件</h3>
        </div>
        <p style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", marginBottom: 18 }}>
          前往 <b style={{ color: "var(--text-strong)" }}>{venue}</b> · 在你常用的地图里自行导航
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {list.map((app) => (
            <a
              key={app.key}
              href={links[app.key]}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => { setTimeout(() => onClose && onClose(), 200); }}
              style={{
                display: "flex", alignItems: "center", gap: 12, textDecoration: "none",
                border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)",
                padding: "13px 14px", background: "var(--surface-card)",
                transition: "background var(--dur-fast) var(--ease-out)",
              }}
            >
              <span style={{ width: 40, height: 40, borderRadius: "var(--radius-sm)", flex: "none", background: app.color, display: "inline-flex", alignItems: "center", justifyContent: "center", boxShadow: "var(--shadow-xs)" }}>
                <i data-lucide={app.icon} style={{ width: 20, height: 20, color: "#fff" }} />
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: "var(--text-base)", color: "var(--text-strong)" }}>{app.name}</div>
                <div style={{ fontSize: "var(--text-2xs)", color: "var(--text-faint)", fontFamily: "var(--font-display)", letterSpacing: "0.04em" }}>{app.sub}</div>
              </div>
            </a>
          ))}
        </div>

        <button onClick={onClose} style={{ width: "100%", marginTop: 14, border: "none", background: "var(--bg-sunken)", color: "var(--text-body)", borderRadius: "var(--radius-md)", padding: "13px", fontFamily: "var(--font-sans)", fontWeight: 600, fontSize: "var(--text-base)", cursor: "pointer" }}>
          取消
        </button>
      </div>
    </div>
  );
}
