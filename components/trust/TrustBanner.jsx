import React from "react";

const STATES = {
  confirmed: { bg: "var(--accent-soft)", fg: "var(--accent-strong)", icon: "shield-check", title: "信息已确认", desc: "主办方已核对此活动的时间与地点。" },
  unverified: { bg: "var(--warning-soft)", fg: "#9A6300", icon: "alert-triangle", title: "信息待核实", desc: "来自网络聚合,尚未经主办方确认,请以原始来源为准。" },
  changed: { bg: "var(--warning-soft)", fg: "#9A6300", icon: "history", title: "信息有变更", desc: "时间或地点近期被更新,请重新确认。" },
  cancelled: { bg: "var(--danger-soft)", fg: "#C42B30", icon: "x-circle", title: "活动已取消", desc: "主办方已取消此活动。" },
};

/** Full-width trust status banner for an activity detail header. */
export function TrustBanner({ state = "confirmed", title, desc, action, onAction, style = {}, ...rest }) {
  const s = STATES[state] || STATES.confirmed;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        background: s.bg,
        borderRadius: "var(--radius-md)",
        padding: "13px 15px",
        ...style,
      }}
      {...rest}
    >
      <i data-lucide={s.icon} style={{ width: 20, height: 20, color: s.fg, flex: "none", marginTop: 1 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: "var(--font-sans)", fontWeight: "var(--weight-bold)", fontSize: "var(--text-sm)", color: s.fg }}>{title || s.title}</div>
        <div style={{ fontSize: "var(--text-xs)", color: "var(--text-body)", lineHeight: 1.5, marginTop: 2 }}>{desc || s.desc}</div>
      </div>
      {action && (
        <button onClick={onAction} style={{ flex: "none", border: "none", background: "transparent", color: s.fg, fontFamily: "var(--font-sans)", fontWeight: "var(--weight-semibold)", fontSize: "var(--text-xs)", cursor: "pointer", textDecoration: "underline", padding: 0, marginTop: 2 }}>{action}</button>
      )}
    </div>
  );
}
