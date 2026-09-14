import React from "react";

/** Big display-figure stat block. Used for counts, prices, distances, times. */
export function StatBlock({ value, label, sub = null, accent = "ink", align = "start", style = {}, ...rest }) {
  const colors = { ink: "var(--text-strong)", brand: "var(--brand)", mint: "var(--accent-strong)" };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, alignItems: align === "center" ? "center" : "flex-start", ...style }} {...rest}>
      <span
        style={{
          fontFamily: "var(--font-display)",
          fontWeight: "var(--weight-bold)",
          fontSize: "var(--text-3xl)",
          lineHeight: 1,
          letterSpacing: "var(--tracking-tight)",
          color: colors[accent] || colors.ink,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </span>
      <span style={{ fontFamily: "var(--font-sans)", fontSize: "var(--text-sm)", fontWeight: "var(--weight-medium)", color: "var(--text-muted)" }}>{label}</span>
      {sub && <span style={{ fontSize: "var(--text-xs)", color: "var(--text-faint)" }}>{sub}</span>}
    </div>
  );
}
