# Gorgon — Web Dashboard UI Kit

Desktop companion to the Gorgon app: a weekend planning console at 1280px.

## Run
Open `index.html`. Loads `../../_ds_bundle.js` and reuses the app's mock dataset
(`../app/data.js`).

## Layout
- **Sidebar** (`Sidebar.jsx`) — logo lockup, primary nav (发现 / 我的周末 / 收藏 / 已报名 /
  关注的主办方), a "This Weekend" sync summary card, and the user chip.
- **Main** — top bar (search + notifications + 发布活动), section header with a time
  segmented control, a four-up stats strip, category filter pills, and a two-column
  `ActivityCard` discover grid.
- **Right rail** — 我的周末: synced activities grouped by 周六 / 周日 as timeline rows,
  plus a 分享我的周末 action.

Composes `components/core` primitives via `window.GorgonDesignSystem_56aa78`.
Icons: Lucide via CDN.
