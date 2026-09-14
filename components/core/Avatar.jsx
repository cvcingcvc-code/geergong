import React from "react";

const SIZES = { xs: 24, sm: 32, md: 40, lg: 56, xl: 72 };

/** User avatar — image, or initials fallback on a brand-tinted surface. */
export function Avatar({ src = null, name = "", size = "md", ring = false, style = {}, ...rest }) {
  const dim = SIZES[size] || SIZES.md;
  const initials = (name || "").trim().slice(0, 2) || "·";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: dim,
        height: dim,
        borderRadius: "50%",
        background: src ? "var(--bg-sunken)" : "var(--brand-soft)",
        color: "var(--brand-strong)",
        fontFamily: "var(--font-display)",
        fontWeight: "var(--weight-bold)",
        fontSize: dim * 0.36,
        overflow: "hidden",
        flex: "none",
        boxShadow: ring ? "0 0 0 2px var(--surface-card), 0 0 0 4px var(--brand)" : "none",
        ...style,
      }}
      {...rest}
    >
      {src ? <img src={src} alt={name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : initials}
    </span>
  );
}
