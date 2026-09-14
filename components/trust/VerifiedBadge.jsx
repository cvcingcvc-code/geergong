import React from "react";

const LEVELS = {
  verified: { bg: "var(--accent-soft)", fg: "var(--accent-strong)", icon: "badge-check", label: "已认证" },
  official: { bg: "var(--brand-soft)", fg: "var(--brand-strong)", icon: "shield-check", label: "官方" },
  aggregated: { bg: "var(--bg-sunken)", fg: "var(--text-muted)", icon: "rss", label: "聚合来源" },
  unverified: { bg: "var(--warning-soft)", fg: "#9A6300", icon: "alert-triangle", label: "待核实" },
};

/**
 * Trust level badge for a host or listing. Mint = verified (the reward color),
 * amber = unverified. Pairs with the brand's semantic color system.
 */
export function VerifiedBadge({ level = "verified", size = "md", showLabel = true, label, style = {}, ...rest }) {
  const l = LEVELS[level] || LEVELS.verified;
  const sm = size === "sm";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: sm ? 4 : 5,
        background: l.bg,
        color: l.fg,
        fontFamily: "var(--font-sans)",
        fontWeight: "var(--weight-semibold)",
        fontSize: sm ? "var(--text-2xs)" : "var(--text-xs)",
        lineHeight: 1,
        padding: sm ? "5px 9px" : "6px 11px",
        borderRadius: "var(--radius-pill)",
        whiteSpace: "nowrap",
        ...style,
      }}
      {...rest}
    >
      <i data-lucide={l.icon} style={{ width: sm ? 13 : 15, height: sm ? 13 : 15 }} />
      {showLabel && (label || l.label)}
    </span>
  );
}
