import React from "react";

/** Text input with label + optional leading icon. Indigo focus ring. */
export function Input({ label = null, hint = null, leadingIcon = null, invalid = false, style = {}, id, ...rest }) {
  const [focus, setFocus] = React.useState(false);
  const fid = id || React.useId();
  const borderColor = invalid ? "var(--danger)" : focus ? "var(--brand)" : "var(--border-default)";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%" }}>
      {label && (
        <label htmlFor={fid} style={{ fontFamily: "var(--font-sans)", fontSize: "var(--text-sm)", fontWeight: "var(--weight-semibold)", color: "var(--text-body)" }}>
          {label}
        </label>
      )}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: "var(--surface-card)",
          border: `1px solid ${borderColor}`,
          borderRadius: "var(--radius-md)",
          padding: "0 14px",
          height: 48,
          transition: "border-color var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out)",
          boxShadow: focus ? "0 0 0 3px var(--focus-ring)" : "none",
          ...style,
        }}
      >
        {leadingIcon && <span style={{ color: "var(--text-muted)", display: "inline-flex" }}>{leadingIcon}</span>}
        <input
          id={fid}
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
          {...rest}
        />
      </div>
      {hint && (
        <span style={{ fontSize: "var(--text-xs)", color: invalid ? "var(--danger)" : "var(--text-muted)" }}>{hint}</span>
      )}
    </div>
  );
}
