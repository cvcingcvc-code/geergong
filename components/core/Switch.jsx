import React from "react";

/** Toggle switch. Mint when on (the brand's "active/synced" reward color). */
export function Switch({ checked = false, onChange, disabled = false, size = "md", style = {}, ...rest }) {
  const w = size === "sm" ? 38 : 46;
  const h = size === "sm" ? 22 : 28;
  const knob = h - 6;
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange && onChange(!checked)}
      style={{
        width: w,
        height: h,
        borderRadius: "var(--radius-pill)",
        border: "none",
        padding: 3,
        background: checked ? "var(--accent)" : "var(--slate-300)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition: "background var(--dur-base) var(--ease-out)",
        display: "inline-flex",
        alignItems: "center",
        ...style,
      }}
      {...rest}
    >
      <span
        style={{
          width: knob,
          height: knob,
          borderRadius: "50%",
          background: "#fff",
          boxShadow: "var(--shadow-sm)",
          transform: checked ? `translateX(${w - knob - 6}px)` : "translateX(0)",
          transition: "transform var(--dur-base) var(--ease-spring)",
        }}
      />
    </button>
  );
}
