import React from "react";

export const CATEGORIES = {
  sport: { color: "var(--cat-sport)", label: "运动" },
  music: { color: "var(--cat-music)", label: "音乐" },
  art: { color: "var(--cat-art)", label: "艺术" },
  food: { color: "var(--cat-food)", label: "美食" },
  outdoor: { color: "var(--cat-outdoor)", label: "户外" },
  study: { color: "var(--cat-study)", label: "学习" },
};

/** Colored category indicator dot, optionally with its label. */
export function CategoryDot({ category = "sport", showLabel = false, size = 10, style = {}, ...rest }) {
  const c = CATEGORIES[category] || CATEGORIES.sport;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7, ...style }} {...rest}>
      <span style={{ width: size, height: size, borderRadius: "50%", background: c.color, flex: "none", boxShadow: `0 0 0 3px color-mix(in oklch, ${c.color} 18%, transparent)` }} />
      {showLabel && (
        <span style={{ fontFamily: "var(--font-sans)", fontSize: "var(--text-sm)", fontWeight: "var(--weight-medium)", color: "var(--text-body)" }}>
          {c.label}
        </span>
      )}
    </span>
  );
}
