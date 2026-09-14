// Gorgon dashboard — left sidebar nav.
(function(){
function NavItem({ icon, label, active, badge }) {
  return (
    <button style={{
      display: "flex", alignItems: "center", gap: 12, width: "100%", border: "none", cursor: "pointer",
      padding: "11px 14px", borderRadius: "var(--radius-md)", textAlign: "left",
      background: active ? "var(--brand-soft)" : "transparent",
      color: active ? "var(--brand-strong)" : "var(--text-body)",
      fontFamily: "var(--font-sans)", fontWeight: active ? 700 : 500, fontSize: 14.5,
      transition: "background var(--dur-fast) var(--ease-out)",
    }}>
      <i data-lucide={icon} style={{ width: 20, height: 20 }} />
      <span style={{ flex: 1 }}>{label}</span>
      {badge != null && (
        <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 12, color: active ? "#fff" : "var(--text-on-brand)", background: active ? "var(--brand)" : "var(--slate-400)", minWidth: 20, height: 20, borderRadius: 999, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0 6px" }}>{badge}</span>
      )}
    </button>
  );
}

function Sidebar({ active, onChange, syncedCount }) {
  const nav = [
    { key: "discover", icon: "compass", label: "发现" },
    { key: "weekend", icon: "calendar-heart", label: "我的周末", badge: syncedCount },
    { key: "saved", icon: "bookmark", label: "收藏" },
    { key: "joined", icon: "ticket", label: "已报名" },
    { key: "hosts", icon: "users", label: "关注的主办方" },
  ];
  return (
    <aside style={{ width: 248, flex: "none", height: "100%", borderRight: "1px solid var(--border-subtle)", background: "var(--surface-card)", display: "flex", flexDirection: "column", padding: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "6px 8px 22px" }}>
        <img src="../../assets/logo-mark.svg" width="38" height="38" alt="Gorgon" />
        <div>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 19, color: "var(--text-strong)", lineHeight: 1 }}>Gorgon</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3 }}>发现你的周末</div>
        </div>
      </div>

      <nav style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {nav.map((n) => <NavItem key={n.key} {...n} active={n.key === active} />)}
      </nav>

      <div style={{ marginTop: "auto", padding: 16, borderRadius: "var(--radius-lg)", background: "var(--grad-sync)", color: "#fff", boxShadow: "var(--shadow-brand)" }}>
        <div style={{ fontFamily: "var(--font-display)", textTransform: "uppercase", letterSpacing: "0.1em", fontSize: 10.5, fontWeight: 600, opacity: 0.9 }}>This Weekend</div>
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 30, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{syncedCount} 场</div>
        <div style={{ fontSize: 12.5, opacity: 0.92, marginTop: 2 }}>已同步到你的周末</div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 16, padding: "8px 6px" }}>
        <span style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--brand-soft)", color: "var(--brand-strong)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 14 }}>小林</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text-strong)" }}>小林</div>
          <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>上海·杨浦</div>
        </div>
        <i data-lucide="settings" style={{ width: 18, height: 18, color: "var(--text-muted)" }} />
      </div>
    </aside>
  );
}

window.GorgonDash = Object.assign(window.GorgonDash || {}, { Sidebar });
})();
