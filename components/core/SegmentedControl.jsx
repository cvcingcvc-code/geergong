import React from "react";

/** Segmented control — tab-like single select for filters/views. */
export function SegmentedControl({ options = [], value, onChange, style = {}, ...rest }) {
  const items = options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
  return (
    <div
      style={{
        display: "inline-flex",
        background: "var(--bg-sunken)",
        borderRadius: "var(--radius-pill)",
        padding: 4,
        gap: 2,
        ...style,
      }}
      {...rest}
    >
      {items.map((it) => {
        const active = it.value === value;
        return (
          <button
            key={it.value}
            onClick={() => onChange && onChange(it.value)}
            style={{
              border: "none",
              background: active ? "var(--surface-card)" : "transparent",
              color: active ? "var(--text-strong)" : "var(--text-muted)",
              fontFamily: "var(--font-sans)",
              fontWeight: "var(--weight-semibold)",
              fontSize: "var(--text-sm)",
              padding: "8px 18px",
              borderRadius: "var(--radius-pill)",
              boxShadow: active ? "var(--shadow-sm)" : "none",
              cursor: "pointer",
              transition: "all var(--dur-fast) var(--ease-out)",
              whiteSpace: "nowrap",
            }}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}
