// Gorgon Workbench — navigation config + legacy mapping layer.
//
// TWO nav vocabularies, deliberately NOT merged into one enum:
//
//   Workbench navigation (data-workbench-nav)     Legacy capabilities (data-gg-nav)
//   ─────────────────────────────────────────     ─────────────────────────────────
//   home / tasks / search / review /              discover / search / smart /
//   history / settings                            weekend / map
//
// The legacy keys are a TEST COMPATIBILITY CONTRACT (e2e_v1_frontend.mjs
// clicks data-gg-nav="discover|search|smart|weekend|map" and asserts the
// tabbar keeps a "搜索" button) — they must keep existing and keep
// resolving to the same screens. Workbench nav is a thin layer on top:
// "search" maps to the legacy "smart" screen (NaturalSearchScreen), the
// other Workbench entries render the new Phase-1 shell screens.
//
// On desktop the sidebar shows Workbench items first and keeps the five
// legacy entries reachable as "专业能力" (legacy capability) items, so no
// E2E path is ever orphaned. On mobile the tabbar shows 工作台 / 搜索 /
// 任务 / 更多, where 更多 exposes the remaining legacy tabs.

export const WORKBENCH_TABS = [
  { key: "home", label: "工作台", icon: "layout-dashboard" },
  { key: "tasks", label: "我的任务", icon: "list-todo" },
  { key: "search", label: "智能搜索", icon: "search" },
  { key: "review", label: "审核中心", icon: "shield-check" },
  { key: "history", label: "工作记录", icon: "history" },
];

export const WORKBENCH_SETTINGS = { key: "settings", label: "模型与设置", icon: "settings" };

// Legacy capability entries — kept as-is for the E2E contract (§16 KEEP).
export const LEGACY_TABS = [
  { key: "discover", label: "发现", icon: "compass" },
  { key: "search", label: "搜索", icon: "search" },
  { key: "smart", label: "智能", icon: "sparkles" },
  { key: "weekend", label: "我的周末", icon: "calendar-heart" },
  { key: "map", label: "地图", icon: "map" },
];

/**
 * Workbench nav -> legacy tab key it renders (for capability reuse).
 * "search" reuses the REAL natural-language search; the shell adds no
 * reimplementation. Home/tasks/review/history/settings are Phase-1 screens.
 */
export const WORKBENCH_TO_LEGACY = {
  search: "smart", // 智能搜索 -> existing NaturalSearchScreen
};

/** Which legacy keys stay directly visible in the Workbench sidebar. */
export const LEGACY_SIDEBAR_KEYS = ["discover", "weekend", "map"];

export const MOBILE_TABS = [
  { key: "home", label: "工作台", icon: "layout-dashboard", workbench: true },
  // The legacy "search" tab label (搜索) is asserted by the mobile E2E via
  // innerText matching — keep both the key and the label.
  { key: "search", label: "搜索", icon: "search", legacy: true },
  { key: "tasks", label: "任务", icon: "list-todo", workbench: true },
  { key: "more", label: "更多", icon: "menu", workbench: true },
];

export const MOBILE_MORE_TABS = [
  { key: "smart", label: "智能找活动", icon: "sparkles", legacy: true },
  { key: "weekend", label: "我的周末", icon: "calendar-heart", legacy: true },
  { key: "map", label: "地图", icon: "map", legacy: true },
  { key: "review", label: "审核中心", icon: "shield-check", workbench: true },
  { key: "history", label: "工作记录", icon: "history", workbench: true },
  { key: "settings", label: "模型与设置", icon: "settings", workbench: true },
];
