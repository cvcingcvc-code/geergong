// Gorgon Demo MVP — additive category extension.
//
// WHY THIS FILE EXISTS
// --------------------
// The recovered design system ships 6 categories (sport/music/art/food/outdoor/study)
// in components/core/CategoryDot.jsx. The demo needs a few more activity types
// (科技 / 黑客松 / 展览 / 市集 / 讲座 / 社交 / 校园 / 公益).
//
// To keep the recovery baseline intact, we DO NOT edit the recovered component or
// token files. Instead we extend the design-system namespace at runtime, exactly the
// way a DS would gain a new category, and inject the matching `--cat-*` CSS variables
// so inline `var(--cat-xxx)` references (Discover rail, dashboard rail) resolve.
//
// Load order: AFTER `_ds_bundle.js` (so CATEGORIES exists), BEFORE the screens render.

(function () {
  var DS = window.GorgonDesignSystem_56aa78;
  if (!DS || !DS.CATEGORIES) {
    console.warn("[categories-ext] design-system namespace not ready; skipping extension");
    return;
  }

  var EXTRA = {
    ai:         { color: "#1E88E5", label: "科技" },
    hackathon:  { color: "#8E24AA", label: "黑客松" },
    exhibition: { color: "#D81B60", label: "展览" },
    market:     { color: "#F4511E", label: "市集" },
    talk:       { color: "#00897B", label: "讲座" },
    social:     { color: "#FB8C00", label: "社交" },
    campus:     { color: "#3949AB", label: "校园" },
    charity:    { color: "#43A047", label: "公益" }
  };

  var rootStyle = document.documentElement.style;
  for (var key in EXTRA) {
    if (!Object.prototype.hasOwnProperty.call(EXTRA, key)) continue;
    if (!DS.CATEGORIES[key]) DS.CATEGORIES[key] = EXTRA[key];
    // exposes var(--cat-<key>) for any inline style that builds the name dynamically
    rootStyle.setProperty("--cat-" + key, EXTRA[key].color);
  }

  console.log("[categories-ext] extended CATEGORIES ->", Object.keys(DS.CATEGORIES).join(", "));
})();
