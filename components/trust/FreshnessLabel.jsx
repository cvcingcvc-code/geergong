import React from "react";

/** Small "last updated / confirmed" timestamp with a clock or check icon. */
export function FreshnessLabel({ time = "刚刚", confirmed = false, style = {}, ...rest }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontFamily: "var(--font-sans)",
        fontSize: "var(--text-xs)",
        color: confirmed ? "var(--accent-strong)" : "var(--text-muted)",
        fontWeight: "var(--weight-medium)",
        ...style,
      }}
      {...rest}
    >
      <i data-lucide={confirmed ? "check-circle-2" : "clock"} style={{ width: 13, height: 13 }} />
      {confirmed ? "主办方已确认" : `${time}更新`}
    </span>
  );
}
