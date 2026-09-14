import React from "react";

const SIZES = { sm: 34, md: 40, lg: 48 };

/**
 * Square icon-only button. Pass a Lucide <i data-lucide> node or any icon as children.
 */
export function IconButton({
  children,
  size = "md",
  variant = "ghost",
  label,
  active = false,
  style = {},
  ...rest
}) {
  const dim = SIZES[size] || SIZES.md;
  const variants = {
    ghost: { background: "transparent", color: active ? "var(--brand)" : "var(--text-muted)", border: "1px solid transparent" },
    soft: { background: active ? "var(--brand-soft)" : "var(--bg-sunken)", color: active ? "var(--brand)" : "var(--text-body)", border: "1px solid transparent" },
    outline: { background: "var(--surface-card)", color: "var(--text-body)", border: "1px solid var(--border-default)", boxShadow: "var(--shadow-xs)" },
    solid: { background: "var(--brand)", color: "#fff", border: "1px solid transparent", boxShadow: "var(--shadow-brand)" },
  };
  return (
    <button
      aria-label={label}
      title={label}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: dim,
        height: dim,
        borderRadius: "var(--radius-md)",
        cursor: "pointer",
        transition: "background var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out)",
        ...variants[variant],
        ...style,
      }}
      onMouseDown={(e) => (e.currentTarget.style.transform = "scale(0.92)")}
      onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
      onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
      {...rest}
    >
      {children}
    </button>
  );
}
