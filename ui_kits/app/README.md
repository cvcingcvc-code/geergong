# Gorgon — App UI Kit

High-fidelity recreation of the Gorgon weekend-activity app for Shanghai university
students. Six core screens, fully click-through, and **responsive** from 390px
phones up to 1920px desktops.

## Run
Open `index.html`. It loads the compiled design-system bundle (`../../_ds_bundle.js`),
the mock dataset (`data.js`), and each screen.

The natural-language search screen needs the API server for live retrieval:

```bash
python -m pipeline.api.server --port 8000 --today 2026-09-15
# http://127.0.0.1:8000/ui_kits/app/
```

Without it the screen falls back to the recorded demo result and says so.

## Responsive layout (PHASE 4.1)

One business tree, two chrome treatments. Breakpoints live in exactly one
place — `responsive.css` media queries plus the `useResponsive()` hook in
`responsive.js`; `window.innerWidth` is not read anywhere else.

| | Mobile `< 768px` | Tablet `768–1199px` | Desktop `>= 1200px` |
|---|---|---|---|
| Chrome | phone frame + bottom tab bar | top header + compact 76px icon rail | top header + 240px sidebar |
| Content column | full width | max 1100px | max 1280px, centred |
| Discover cards | 1 column | 2 columns | 3 columns |
| Smart search | stacked, summary first | stacked (2-col results) | results 2fr / context 1fr |

`--gg-gutter` / `--gg-gap` / `--gg-content-max` / `--gg-sidebar-w` are redefined
per breakpoint, so a single component instance adapts with no JS.

Below 480px the phone chassis is dropped and the app goes full-bleed — a phone
mock-up drawn inside a phone makes no sense, and a 402px chassis overflows a
390px viewport. The screens, single-column layout and bottom navigation are
unchanged. Between 480px and 767px the original chassis presentation is kept.

Responsive-only files: `responsive.css` (layout), `responsive.js` (hook).
No screen has a desktop/mobile twin.

## Screens
- **DiscoverScreen** — home feed: greeting header, search, "This Weekend" hero strip,
  category rail, time segmented control, vertical `ActivityCard` feed.
- **ActivityDetailScreen** — hero cover, host, meta grid, description, location map
  snippet, attendees, sticky 同步到我的周末 CTA.
- **SearchScreen** — recent searches, 本周热搜 ranked list, live results (compact cards).
- **MyWeekendScreen** — synced activities grouped by 周六 / 周日 with a stats strip;
  empty state when nothing is synced.
- **NaturalSearchScreen** — one sentence in, a ranked answer out: ask box, retrieval
  summary, 搜索理解 / 检索任务 context, rated result cards, and a clearly separated
  待核验 queue.
- **MapScreen** — stylized map with category pins, floating search, bottom activity
  card; on desktop the venue list becomes a right-hand panel.

## Composition
Screens compose the shared primitives from `components/core` (`ActivityCard`,
`SearchField`, `SegmentedControl`, `Avatar`, `Tag`, `Button`, `StatBlock`, `Badge`,
`CategoryDot`) via `window.GorgonDesignSystem_56aa78`. `AppShell.jsx` provides both
chromes: `PhoneFrame` + `StatusBar` + `TabBar` for mobile, and `AppShell` +
`DesktopHeader` + `DesktopSidebar` for tablet/desktop. `index.html` picks one with
`useResponsive()`; it never renders both. State (synced set, active tab, detail
overlay, toast) lives in `index.html` and is shared by both chromes.

Icons: Lucide via CDN. Activity images are category-tinted gradient placeholders —
swap in real photos by passing `image` to `ActivityCard`.
