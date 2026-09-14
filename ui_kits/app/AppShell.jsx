// Gorgon app shell — phone frame, status bar, bottom tab bar.
(function(){
const { Badge } = window.GorgonDesignSystem_56aa78;

function StatusBar({ dark }) {
  const color = dark ? "#fff" : "var(--ink)";
  return (
    <div style={{ height: 44, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 24px", flex: "none" }}>
      <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 15, color, fontVariantNumeric: "tabular-nums" }}>9:41</span>
      <div style={{ display: "flex", gap: 7, alignItems: "center", color }}>
        <i data-lucide="signal" style={{ width: 16, height: 16 }} />
        <i data-lucide="wifi" style={{ width: 16, height: 16 }} />
        <i data-lucide="battery-full" style={{ width: 22, height: 22 }} />
      </div>
    </div>
  );
}

const TABS = [
  { key: "discover", label: "发现", icon: "compass" },
  { key: "search", label: "搜索", icon: "search" },
  { key: "weekend", label: "我的周末", icon: "calendar-heart" },
  { key: "map", label: "地图", icon: "map" },
];

function TabBar({ active, onChange, syncedCount }) {
  return (
    <div style={{
      flex: "none", display: "flex", padding: "8px 12px 22px",
      background: "color-mix(in oklch, var(--surface-card) 88%, transparent)",
      backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
      borderTop: "1px solid var(--border-subtle)",
    }}>
      {TABS.map((t) => {
        const on = t.key === active;
        return (
          <button key={t.key} onClick={() => onChange(t.key)} style={{
            flex: 1, border: "none", background: "transparent", cursor: "pointer",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
            color: on ? "var(--brand)" : "var(--text-faint)",
          }}>
            <span style={{ position: "relative", display: "inline-flex" }}>
              <i data-lucide={t.icon} style={{ width: 24, height: 24 }} />
              {t.key === "weekend" && syncedCount > 0 && (
                <Badge tone="mint" style={{ position: "absolute", top: -6, right: -10 }}>{syncedCount}</Badge>
              )}
            </span>
            <span style={{ fontSize: 10.5, fontWeight: on ? 700 : 500, fontFamily: "var(--font-sans)" }}>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function PhoneFrame({ children }) {
  return (
    <div style={{
      width: 402, height: 858, borderRadius: 56, padding: 11,
      background: "linear-gradient(160deg,#1b1d27,#0c0d12)",
      boxShadow: "var(--shadow-xl), 0 0 0 2px rgba(255,255,255,0.04) inset",
      flex: "none",
    }}>
      <div style={{
        width: "100%", height: "100%", borderRadius: 46, overflow: "hidden",
        background: "var(--bg-base)", display: "flex", flexDirection: "column", position: "relative",
      }}>
        {children}
      </div>
    </div>
  );
}

window.GorgonApp = Object.assign(window.GorgonApp || {}, { StatusBar, TabBar, PhoneFrame, TABS });
})();
