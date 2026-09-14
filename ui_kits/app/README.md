# Gorgon — Mobile App UI Kit

High-fidelity recreation of the Gorgon weekend-activity app for Shanghai university
students. Five core screens, fully click-through.

## Run
Open `index.html`. It loads the compiled design-system bundle (`../../_ds_bundle.js`),
the mock dataset (`data.js`), and each screen.

## Screens
- **DiscoverScreen** — home feed: greeting header, search, "This Weekend" hero strip,
  category rail, time segmented control, vertical `ActivityCard` feed.
- **ActivityDetailScreen** — hero cover, host, meta grid, description, location map
  snippet, attendees, sticky 同步到我的周末 CTA.
- **SearchScreen** — recent searches, 本周热搜 ranked list, live results (compact cards).
- **MyWeekendScreen** — synced activities grouped by 周六 / 周日 with a stats strip;
  empty state when nothing is synced.
- **MapScreen** — stylized map with category pins, floating search, bottom activity card.

## Composition
Screens compose the shared primitives from `components/core` (`ActivityCard`,
`SearchField`, `SegmentedControl`, `Avatar`, `Tag`, `Button`, `StatBlock`, `Badge`,
`CategoryDot`) via `window.GorgonDesignSystem_56aa78`. `AppShell.jsx` provides the
phone frame, status bar, and bottom tab bar. State (synced set, active tab, detail
overlay, toast) lives in `index.html`.

Icons: Lucide via CDN. Activity images are category-tinted gradient placeholders —
swap in real photos by passing `image` to `ActivityCard`.
