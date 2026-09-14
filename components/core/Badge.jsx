import React from "react";

const TONES = {
  brand: { bg: "var(--brand)", fg: "#fff" },
  mint: { bg: "var(--accent)", fg: "#06241B" },
  danger: { bg: "var(--danger)", fg: "#fff" },
  amber: { bg: "var(--amber-500)", fg: "#3D2A00" },
  neutral: { bg: "var(--slate-600)", fg: "#fff" },
};

/** Small status badge / count. Use `dot` for a bare notification dot. */
export function Badge({ children, tone = "brand", dot = false, style = {}, ...rest }) {
  const t = TONES[tone] || TONES.brand;
  if (dot) {
    return <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: "50%", background: t.bg, boxShadow: "0 0 0 2px var(--surface-card)", ...style }} {...rest} />;
  }
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 18,
        height: 18,
        padding: "0 6px",
        background: t.bg,
        color: t.fg,
        fontFamily: "var(--font-display)",
        fontSize: "var(--text-2xs)",
        fontWeight: "var(--weight-bold)",
        borderRadius: "var(--radius-pill)",
        lineHeight: 1,
        fontVariantNumeric: "tabular-nums",
        ...style,
      }}
      {...rest}
    >
      {children}
    </span>
  );
}
