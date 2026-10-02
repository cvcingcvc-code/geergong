// Vendored from components/core/SearchField.jsx — ONLY edit:
// `<i data-lucide="search">` -> <Icon name="search" />.
//
// Why a copy instead of editing the original: the legacy app still compiles
// components/core/*.jsx in the browser via _ds_bundle.js + Babel
// Standalone, and that runtime cannot resolve an npm import like
// "lucide-react". Editing the shared source would break the legacy build.
// Once the legacy app is retired, this file goes away and the original
// takes the same one-line change.

import React from "react";
import { Icon } from "../Icon.jsx";

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
      <Icon name="search" style={{ width: 20, height: 20, color: "var(--text-muted)", flex: "none" }} />
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
