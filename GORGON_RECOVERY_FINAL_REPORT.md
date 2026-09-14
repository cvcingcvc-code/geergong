# GORGON RECOVERY FINAL REPORT

## PROJECT PATH
`C:\Users\lin\Documents\Gorgon-Recovered`

(All 4 source ZIPs in `E:\` were left **unmodified**; extraction happened in a temp work dir only.)

---

## RECOVERY STATUS

### EXACT FILES
**112 files** restored verbatim from `design_chats-000.zip` → chat `fe435e89` ("Gorgon Design System"),
replayed write→edit→delete in chronological order. Covers:
- `readme.md`, `本地运行指南.md`, `styles.css`
- `assets/` (logo-mark / logo-wordmark / logo-wordmark-light .svg)
- `tokens/` (base, colors, typography, spacing, effects, fonts .css)
- `guidelines/` (brand, colors, spacing, type specimen .html)
- `components/core/` (12 components × .jsx/.d.ts/.prompt.md) + `.card.html`
- `components/trust/` (5 components) + `.card.html`
- `components/location/` (2 components) + `.card.html`
- `ui_kits/app/` (AppShell, DiscoverScreen, ActivityDetailScreen, SearchScreen, MyWeekendScreen, MapScreen, data.js, index.html, README)
- `ui_kits/admin/` (ReviewConsole, queue.js, index.html, README)
- `ui_kits/dashboard/` (Sidebar, index.html, README)
- `slides/` (title, agenda, bigstat, comparison, quote, closing, index .html)

### PARTIAL FILES
- `templates/pitch-deck/PitchDeck.dc.html` — only 4 `dc_*_str_replace` diffs in export; base file never written to history. The 7 individual slide HTMLs are fully recovered, so deck *content* survives; only the master `.dc.html` shell is incomplete.

### MISSING FILES
- `_ds_bundle.js` (original generated runtime bundle) — **reconstructed** (see below), not in export.
- `deploy/index.html` (8 MB inlined single-file build) — output of `super_inline_html` not stored.
- `SKILL.md` — referenced by `readme.md` but absent from the Gorgon export (only the unrelated 智能教案 project has one).
- `deploy/README.md`, `deploy/vercel.json` — written then **deleted by Claude** (msg 18); content still exists in the export if you want them back.

---

## TECH STACK
- **Frontend:** React 18 (UMD via CDN), in-browser JSX via Babel Standalone, plain CSS + CSS custom properties (design tokens), SVG logos.
- **Icons:** Lucide (CDN). **Fonts:** Space Grotesk / Plus Jakarta Sans / Noto Sans SC (Google Fonts CDN).
- **No build step, no `package.json`, no bundler** — runs as static files. Served by any HTTP server.
- **Data:** `ui_kits/app/data.js` exposes `window.GORGON_DATA` (hand-authored sample activities; no backend).
- One generated artifact (`_ds_bundle.js`) was missing from the export and has been **reconstructed** by compiling the real recovered `components/**/*.jsx` with the page's own Babel and exposing their exports on `window.GorgonDesignSystem_56aa78`. Validated headlessly: all 19 sources compile and the namespace populates with all 20 expected exports; `ActivityCard` renders correctly.

---

## APP URL
http://localhost:8000/ui_kits/app/
(running now via `python3 -m http.server 8000` in the project root; first load needs internet for CDNs)

## DASHBOARD URL
http://localhost:8000/ui_kits/dashboard/

## ADMIN URL
http://localhost:8000/ui_kits/admin/

## PITCH DECK
http://localhost:8000/slides/  (standalone slide viewer; individual slides are complete)
Master `PitchDeck.dc.html` is PARTIAL (base missing) — see above.

---

## WORKING FEATURES
- **Design system**: tokens, logos, guideline specimen cards all present.
- **Mobile app** (`ui_kits/app`): Discover feed, Activity detail, Search & filters, My Weekend, Map — all screens recovered; trust + location components wired.
- **Trust layer** (`components/trust`): VerifiedBadge, SourceTag, TrustBanner, FreshnessLabel, ReportSheet.
- **Location layer** (`components/location`): RoutePlanner (transit options), MapAppSheet (deep-link to 高德/百度/腾讯/Apple 地图).
- **Admin 审核后台** (`ui_kits/admin`): ReviewConsole + queue.js (crawl → auto-check → human review → publish).
- **Dashboard** (`ui_kits/dashboard`): desktop weekend planner.
- **Pitch deck slides** (`slides`): 7 branded slides, standalone.
- **Bundle reconstruction**: validated to compile and populate the namespace (so app/admin/dashboard run).

## BROKEN FEATURES
- **`deploy/index.html`** one-file build is not reproducible verbatim (transform output not stored). Use `ui_kits/app/index.html` via the static server instead.
- **`PitchDeck.dc.html`** master deck shell is incomplete (base not in export).
- **Internet required on first load** for React / Babel / Lucide CDNs (unchanged from original design).
- **`SKILL.md`** absent.

## MISSING ASSETS
- No activity photo assets in the export — `data.js` ships `image: null`, so cards use category-gradient fallbacks (by design).
- No webfont binaries (loaded via Google Fonts CDN).
- `deploy/README.md`, `deploy/vercel.json` deleted by Claude (content recoverable from export).
- Original generated `_ds_bundle.js` (replaced by a faithful reconstruction).

---

## CLAUDE LAST KNOWN DEVELOPMENT STATE
A **complete, high-fidelity static prototype** of the Gorgon Design System + Mobile App + Admin + Dashboard + Pitch slides,
described by Claude as: *"高保真原型 … 活动数据是手工填的样例, 还没有自动爬取"* — i.e. a frontend prototype
with **hand-entered sample data and no backend**. Last activity 2026-06-15. Intended next steps (per `本地运行指南.md`):
fill real weekend activities into `data.js` to validate the trust + navigation flow, then add a backend
(scraping + auto-verification) and eventually a WeChat mini-program.

---

## NEXT 5 RECOMMENDED TASKS
1. **Swap in the original `_ds_bundle.js`** if you can export it from Claude's design-system runtime — the current one is a faithful reconstruction, not the original bytes.
2. **Rebuild `deploy/index.html`** (run the inline/concat transform) if you need the single-file double-click distribution.
3. **Reconstruct `PitchDeck.dc.html`** — apply the 4 `dc_*_str_replace` diffs to a base, or assemble the 7 slides into a master deck.
4. **Fill real activities** into `ui_kits/app/data.js` (format in `本地运行指南.md`) and verify the 发现 → 详情 → 我的周末 → 搜索 → 地图 happy path end-to-end in a browser.
5. **Add the backend** (scraping + auto host-verification) and/or the WeChat mini-program mapping described in the run guide; restore `SKILL.md` if it surfaces in another export.
