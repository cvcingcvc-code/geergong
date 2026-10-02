// Gorgon — additive category extension.
//
// Migrated from ui_kits/app/categories-ext.js. Same rule, same reason:
// the recovered design system ships 6 categories (sport/music/art/food/
// outdoor/study) in components/core/CategoryDot.jsx; the demo needs a few
// more (科技 / 黑客松 / 展览 / 市集 / 讲座 / 社交 / 校园 / 公益).
//
// To keep the recovery baseline intact we DO NOT edit the recovered
// component or token files — we extend the CATEGORIES map at startup and
// inject the matching `--cat-*` CSS variables so inline `var(--cat-xxx)`
// references (Discover rail, dashboard rail) resolve.
//
// Call applyCategoryExtensions() ONCE before the first render.

import { CATEGORIES } from "./ds.js";

const EXTRA = {
  ai:         { color: "#1E88E5", label: "科技" },
  hackathon:  { color: "#8E24AA", label: "黑客松" },
  exhibition: { color: "#D81B60", label: "展览" },
  market:     { color: "#F4511E", label: "市集" },
  talk:       { color: "#00897B", label: "讲座" },
  social:     { color: "#FB8C00", label: "社交" },
  campus:     { color: "#3949AB", label: "校园" },
  charity:    { color: "#43A047", label: "公益" },
};

export function applyCategoryExtensions() {
  const rootStyle = document.documentElement.style;
  for (const key of Object.keys(EXTRA)) {
    if (!CATEGORIES[key]) CATEGORIES[key] = EXTRA[key];
    // exposes var(--cat-<key>) for any inline style that builds the name dynamically
    rootStyle.setProperty("--cat-" + key, EXTRA[key].color);
  }
}
