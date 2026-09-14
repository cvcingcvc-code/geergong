import React from "react";

const TONES = {
  neutral: { bg: "var(--bg-sunken)", fg: "var(--text-body)" },
  brand: { bg: "var(--brand-soft)", fg: "var(--brand-strong)" },
  mint: { bg: "var(--accent-soft)", fg: "var(--accent-strong)" },
  warning: { bg: "var(--warning-soft)", fg: "#9A6300" },
  danger: { bg: "var(--danger-soft)", fg: "#C42B30" },
  solid: { bg: "var(--brand)", fg: "#fff" },
  ink: { bg: "var(--surface-inverse)", fg: "var(--text-on-inverse)" },
};

/** Pill-shaped tag/chip. Optional dot or leading icon. */
export function Tag({ children, tone = "neutral", size = "md", dotColor = null, leadingIcon = null, style = {}, ...rest }) {
  const t = TONES[tone] || TONES.neutral;
  const sm = size === "sm";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: sm ? 5 : 6,
        background: t.bg,
        color: t.fg,
        fontFamily: "var(--font-sans)",
        fontWeight: "var(--weight-semibold)",
        fontSize: sm ? "var(--text-2xs)" : "var(--text-xs)",
        lineHeight: 1,
        padding: sm ? "5px 9px" : "7px 12px",
        borderRadius: "var(--radius-pill)",
        whiteSpace: "nowrap",
        ...style,
      }}
      {...rest}
    >
      {dotColor && <span style={{ width: 7, height: 7, borderRadius: "50%", background: dotColor, flex: "none" }} />}
      {leadingIcon}
      {children}
    </span>
  );
}
