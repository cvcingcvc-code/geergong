// Vendored from components/core/ActivityCard.jsx — ONLY edit:
// `<i data-lucide="...">` -> <Icon name="..." /> (4 occurrences).
//
// Why a copy instead of editing the original: the legacy app still compiles
// components/core/*.jsx in the browser via _ds_bundle.js + Babel
// Standalone, and that runtime cannot resolve an npm import like
// "lucide-react". Editing the shared source would break the legacy build.
// Once the legacy app is retired, this file goes away and the original
// takes the same change.

import React from "react";
import { CATEGORIES } from "../../../../components/core/CategoryDot.jsx";
import { Tag } from "../../../../components/core/Tag.jsx";
import { Icon } from "../Icon.jsx";

/**
 * Gorgon's signature activity card. Full-bleed image (or category-tinted
 * gradient fallback), category dot, title, time/place meta, price, and a
 * sync toggle that flips to the mint "已同步 ✓" reward state.
 */
export function ActivityCard({
  title = "活动标题",
  category = "music",
  date = "周六 6.15",
  time = "19:30",
  location = "上海·静安",
  distance = null,
  price = "免费",
  image = null,
  tags = [],
  synced = false,
  hot = false,
  onSync,
  compact = false,
  style = {},
  ...rest
}) {
  const cat = CATEGORIES[category] || CATEGORIES.music;
  const catColor = cat.color;
  const cover = image
    ? { backgroundImage: `url(${image})`, backgroundSize: "cover", backgroundPosition: "center" }
    : { background: `linear-gradient(150deg, color-mix(in oklch, ${catColor} 90%, #fff) 0%, color-mix(in oklch, ${catColor} 65%, var(--indigo-700)) 100%)` };

  const SyncBtn = (
    <button
      onClick={(e) => { e.stopPropagation(); onSync && onSync(!synced); }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        border: "none",
        cursor: "pointer",
        fontFamily: "var(--font-sans)",
        fontWeight: "var(--weight-semibold)",
        fontSize: "var(--text-sm)",
        padding: compact ? "8px 12px" : "9px 16px",
        borderRadius: "var(--radius-pill)",
        background: synced ? "var(--accent)" : "var(--brand)",
        color: synced ? "#06241B" : "#fff",
        boxShadow: synced ? "var(--shadow-mint)" : "var(--shadow-brand)",
        transition: "all var(--dur-base) var(--ease-spring)",
        whiteSpace: "nowrap",
      }}
    >
      <Icon name={synced ? "check" : "plus"} style={{ width: 16, height: 16 }} />
      {synced ? "已同步" : "同步"}
    </button>
  );

  if (compact) {
    return (
      <div
        style={{
          display: "flex",
          gap: 14,
          alignItems: "center",
          background: "var(--surface-card)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-lg)",
          padding: 12,
          boxShadow: "var(--shadow-sm)",
          ...style,
        }}
        {...rest}
      >
        <div style={{ width: 76, height: 76, borderRadius: "var(--radius-md)", flex: "none", ...cover }} />
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: catColor, flex: "none" }} />
            <span style={{ fontFamily: "var(--font-display)", fontSize: "var(--text-xs)", textTransform: "uppercase", letterSpacing: "var(--tracking-wide)", color: "var(--text-muted)" }}>{date} · {time}</span>
          </div>
          <h4 style={{ fontSize: "var(--text-md)", fontFamily: "var(--font-sans)", fontWeight: "var(--weight-bold)", color: "var(--text-strong)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</h4>
          <div style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--text-muted)", fontSize: "var(--text-xs)" }}>
            <Icon name="map-pin" style={{ width: 13, height: 13 }} />
            <span>{location}{distance ? ` · ${distance}` : ""}</span>
          </div>
        </div>
        {SyncBtn}
      </div>
    );
  }

  return (
    <div
      style={{
        background: "var(--surface-card)",
        borderRadius: "var(--radius-lg)",
        overflow: "hidden",
        boxShadow: "var(--shadow-sm)",
        border: "1px solid var(--border-subtle)",
        display: "flex",
        flexDirection: "column",
        ...style,
      }}
      {...rest}
    >
      <div style={{ position: "relative", height: 168, ...cover }}>
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(12,13,18,0) 45%, rgba(12,13,18,0.55) 100%)" }} />
        <div style={{ position: "absolute", top: 12, left: 12, display: "flex", gap: 6 }}>
          <Tag tone="ink" size="sm" dotColor={catColor}>{cat.label}</Tag>
          {hot && <Tag tone="danger" size="sm">🔥 热门</Tag>}
        </div>
        <div style={{ position: "absolute", bottom: 12, left: 14, color: "#fff", display: "flex", alignItems: "center", gap: 6 }}>
          <Icon name="calendar" style={{ width: 15, height: 15 }} />
          <span style={{ fontFamily: "var(--font-display)", fontWeight: "var(--weight-semibold)", fontSize: "var(--text-sm)", letterSpacing: "var(--tracking-wide)" }}>{date} · {time}</span>
        </div>
      </div>

      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        <h3 style={{ fontSize: "var(--text-lg)", fontFamily: "var(--font-sans)", fontWeight: "var(--weight-bold)", color: "var(--text-strong)", lineHeight: 1.3 }}>{title}</h3>

        <div style={{ display: "flex", alignItems: "center", gap: 14, color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <Icon name="map-pin" style={{ width: 15, height: 15 }} />{location}
          </span>
          {distance && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <Icon name="navigation" style={{ width: 14, height: 14 }} />{distance}
            </span>
          )}
        </div>

        {tags.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {tags.map((t) => <Tag key={t} tone="neutral" size="sm">{t}</Tag>)}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 2 }}>
          <span style={{ fontFamily: "var(--font-display)", fontWeight: "var(--weight-bold)", fontSize: "var(--text-lg)", color: price === "免费" ? "var(--accent-strong)" : "var(--text-strong)" }}>{price}</span>
          {SyncBtn}
        </div>
      </div>
    </div>
  );
}
