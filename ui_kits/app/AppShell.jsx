// Gorgon app shell — responsive chrome around ONE business tree.
//
//   Mobile  (< 768px)                 Tablet (768–1199) / Desktop (>= 1200)
//   ─────────────────────────────     ────────────────────────────────────
//   PhoneFrame                        AppShell
//     StatusBar                         DesktopHeader  (full width)
//     <screen>                          DesktopSidebar (left rail)
//     TabBar (bottom nav)               <screen>
//
// The screens themselves are identical in both shells — PHASE 4.1 only
// changes chrome and layout, never business logic. Below 768px nothing
// about the original phone mock-up changed.
(function(){
const { Badge, Avatar } = window.GorgonDesignSystem_56aa78;

/* ── Mobile chrome (unchanged from the original design) ───────────── */

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
  { key: "smart", label: "智能", icon: "sparkles" },
  { key: "search", label: "搜索", icon: "search" },
  { key: "weekend", label: "我的周末", icon: "calendar-heart" },
  { key: "map", label: "地图", icon: "map" },
];

function TabBar({ active, onChange, syncedCount }) {
  return (
    <div data-gg-region="tabbar" style={{
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

/** The mobile chassis. Below 480px the chassis is dropped entirely
 *  (responsive.css) so the app is full-bleed on a real phone — a phone
 *  mock-up drawn inside a phone makes no sense. The screen content, the
 *  single-column layout and the bottom navigation are unchanged. */
function PhoneFrame({ children }) {
  return (
    <div className="gg-phone" data-gg-shell="mobile" style={{
      width: 402, height: 858, borderRadius: 56, padding: 11,
      background: "linear-gradient(160deg,#1b1d27,#0c0d12)",
      boxShadow: "var(--shadow-xl), 0 0 0 2px rgba(255,255,255,0.04) inset",
      flex: "none",
    }}>
      <div className="gg-phone-inner" style={{
        width: "100%", height: "100%", borderRadius: 46, overflow: "hidden",
        background: "var(--bg-base)", display: "flex", flexDirection: "column", position: "relative",
      }}>
        {children}
      </div>
    </div>
  );
}

/* ── Tablet / desktop chrome ──────────────────────────────────────── */

/** Sidebar brand tile. Always the same tree, so lucide's <i> → <svg>
 *  swap can never hit a React sibling swap. */
function BrandTile({ size }) {
  return (
    <span style={{
      width: size, height: size, borderRadius: Math.round(size * 0.3),
      background: "var(--grad-brand)", flex: "none",
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      boxShadow: "var(--shadow-brand)",
    }}>
      <i data-lucide="hexagon" style={{ width: Math.round(size * 0.55), height: Math.round(size * 0.55), color: "#fff" }} />
    </span>
  );
}

function NotifyButton({ hasDot }) {
  return (
    <button aria-label="通知" style={{
      position: "relative", width: 38, height: 38, borderRadius: "var(--radius-md)",
      border: "1px solid var(--border-subtle)", background: "var(--surface-card)",
      display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flex: "none",
    }}>
      <i data-lucide="bell" style={{ width: 18, height: 18, color: "var(--text-body)" }} />
      {hasDot && <span style={{ position: "absolute", top: 8, right: 9, width: 8, height: 8, borderRadius: "50%", background: "var(--danger)", boxShadow: "0 0 0 2px var(--surface-card)" }} />}
    </button>
  );
}

/** Full-width top bar: wordmark + tagline · city · notifications + avatar.
 *  Deliberately contains NO fake device chrome (no 9:41 / signal / wifi /
 *  battery) — that belongs to the mobile mock-up only.
 *
 *  The location chip mirrors the SHARED district selection rather than the
 *  user's static profile campus: once the district is a real, changeable
 *  filter, a chrome chip that never moves would be a second, contradicting
 *  location display on the same screen. Changing it happens in the content
 *  (the picker), so this stays a label. */
function DesktopHeader({ district }) {
  const { user } = window.GORGON_DATA;
  const D = window.GorgonDistrict;
  const text = D ? D.label(district) : user.campus;
  return (
    <header className="gg-header" data-gg-region="header">
      <div className="gg-header-inner">
        <div style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
          <BrandTile size={30} />
          <span className="gg-wordmark">GORGON</span>
          <span className="gg-wordmark-sub">发现你的周末</span>
        </div>

        <div style={{ flex: 1, minWidth: 0 }} />

        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span data-gg-region="header-district" data-gg-district={district || ""}
            title="当前地区筛选（在页面中修改）"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: "var(--text-body)", whiteSpace: "nowrap" }}>
            <i data-lucide="map-pin" style={{ width: 15, height: 15, color: "var(--brand)" }} />
            {text}
          </span>
          <NotifyButton hasDot />
          <Avatar name={user.name} size="sm" ring />
        </div>
      </div>
    </header>
  );
}

function NavGlyph({ name }) {
  return <i data-lucide={name} style={{ width: 20, height: 20, flex: "none" }} />;
}

function DesktopSidebar({ active, onChange, syncedCount, onSettings }) {
  const item = (t) => {
    const on = t.key === active;
    return (
      <button
        key={t.key}
        data-gg-nav={t.key}
        className={"gg-nav-item" + (on ? " is-active" : "")}
        aria-current={on ? "page" : undefined}
        onClick={() => onChange(t.key)}
      >
        <span style={{ position: "relative", display: "inline-flex", flex: "none" }}>
          <NavGlyph name={t.icon} />
          {t.key === "weekend" && syncedCount > 0 && (
            <Badge tone="mint" style={{ position: "absolute", top: -7, right: -10 }}>{syncedCount}</Badge>
          )}
        </span>
        <span className="gg-nav-label">{t.label}</span>
      </button>
    );
  };

  return (
    <nav className="gg-sidebar" data-gg-region="sidebar" aria-label="主导航">
      {TABS.map(item)}
      <div className="gg-nav-spacer" />
      <div className="gg-sidebar-divider" />
      <button className="gg-nav-item" data-gg-nav="settings" onClick={onSettings} title="设置">
        <NavGlyph name="settings" />
        <span className="gg-nav-label">设置</span>
      </button>
    </nav>
  );
}

/** The tablet/desktop frame. The screen keeps its own scroll container,
 *  so there is exactly ONE scroller (no nested scrollbars). */
function AppShell({ tab, onTab, syncedCount, onSettings, district, children }) {
  return (
    <div className="gg-app" data-gg-shell="wide">
      <DesktopHeader district={district} />
      <div className="gg-body">
        <DesktopSidebar active={tab} onChange={onTab} syncedCount={syncedCount} onSettings={onSettings} />
        <div className="gg-main">
          <div className="gg-frame">
            <div className="gg-container">{children}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

window.GorgonApp = Object.assign(window.GorgonApp || {}, {
  StatusBar, TabBar, PhoneFrame, TABS, AppShell, DesktopSidebar, DesktopHeader,
});
})();
