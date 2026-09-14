import React from "react";

/**
 * Source attribution tag — shows where an aggregated listing came from and links
 * back to the original. "我们说的"永远能回到"他们说的".
 */
export function SourceTag({ source = "来源", href = "#", icon = "link", style = {}, ...rest }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        background: "var(--bg-sunken)",
        color: "var(--text-body)",
        fontFamily: "var(--font-sans)",
        fontWeight: "var(--weight-medium)",
        fontSize: "var(--text-xs)",
        lineHeight: 1,
        padding: "7px 12px",
        borderRadius: "var(--radius-pill)",
        textDecoration: "none",
        border: "1px solid var(--border-subtle)",
        transition: "background var(--dur-fast) var(--ease-out)",
        ...style,
      }}
      {...rest}
    >
      <i data-lucide={icon} style={{ width: 13, height: 13, color: "var(--text-muted)" }} />
      <span style={{ color: "var(--text-muted)" }}>来源</span>
      <span style={{ fontWeight: "var(--weight-semibold)", color: "var(--text-strong)" }}>{source}</span>
      <i data-lucide="arrow-up-right" style={{ width: 13, height: 13, color: "var(--brand)" }} />
    </a>
  );
}
