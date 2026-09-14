import React from "react";

/** Rounded search field — the app's primary discovery entry point. */
export function SearchField({ placeholder = "搜索活动、地点、标签", value, onChange, size = "md", style = {}, ...rest }) {
  const [focus, setFocus] = React.useState(false);
  const h = size === "lg" ? 56 : 48;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        background: "var(--surface-card)",
        border: `1px solid ${focus ? "var(--brand)" : "var(--border-subtle)"}`,
        borderRadius: "var(--radius-pill)",
        padding: size === "lg" ? "0 20px" : "0 16px",
        height: h,
        boxShadow: focus ? "0 0 0 3px var(--focus-ring)" : "var(--shadow-sm)",
        transition: "border-color var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out)",
        ...style,
      }}
      {...rest}
    >
      <i data-lucide="search" style={{ width: 20, height: 20, color: "var(--text-muted)", flex: "none" }} />
      <input
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        style={{
          border: "none",
          outline: "none",
          background: "transparent",
          width: "100%",
          fontFamily: "var(--font-sans)",
          fontSize: "var(--text-base)",
          color: "var(--text-strong)",
        }}
      />
    </div>
  );
}
