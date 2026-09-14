# Gorgon Demo MVP

> **发现你的周末** — 一个 3 分钟可以完整演示的交互原型。
> This is a **DEMO MVP** built on top of the recovered Gorgon design system.
> The original design-system README follows below (unchanged).

## 运行方式

```bash
# 在项目根目录（含 _ds_bundle.js 的那一层）
python -m http.server 8000
```

> 首次加载需要联网（React / Babel / Lucide / 字体来自 CDN）。
> 建议用 `127.0.0.1` 打开，例如 `http://localhost:8000/…`。

## 访问地址

| 界面 | 地址 |
|---|---|
| 📱 移动 App（发现 / 搜索 / 我的周末 / 地图） | `http://localhost:8000/ui_kits/app/` |
| 🛠 审核后台（爬取 → 自动校验 → 人工审核） | `http://localhost:8000/ui_kits/admin/` |
| 🖥 桌面规划台 | `http://localhost:8000/ui_kits/dashboard/` |
| 🎞 Pitch 幻灯片 | `http://localhost:8000/slides/` |

**Demo 模式**：在地址后加 `?demo=1`（例如 `.../ui_kits/app/?demo=1`），角落里会出现一个很淡的
**「重置 Demo」** 按钮，用来一键清空演示状态。

## 演示数据说明

- ⚠️ 当前所有活动都是 **DEMO DATA（演示样例数据，不是真实活动）**，每条都带 `demo: true` 标记，
  `source` 一律以 `DEMO DATA` 开头，App 内也会显示 `DEMO` 角标。
- ⚠️ **当前版本没有真实爬虫，也没有生产数据库。** 后台的「爬取队列」是样例数据。
- 演示中的「我的周末 / 收藏 / 审核结果」保存在**浏览器本地**（localStorage），
  没有登录、没有账号，也不会上传到任何服务器。

## 这一版实现了什么

- 发现：24 条活动、分类筛选、只看免费、按区域筛选、实时数量。
- 搜索：跨标题 / 简介 / 标签 / 分类 / 场馆 / 区域 / 价格，大小写不敏感，带空状态。
- 活动详情：完整信息 + **报名入口** + **加入我的周末** + **在地图查看** + 收藏。
- 我的周末：本地持久化，刷新不丢，可按周六/周日查看，可移除。
- 收藏：本地持久化，可在「我的周末 → 收藏」中查看与移除。
- 地图：示意地图（不接真实地图 SDK），地点列表、选中高亮、从详情跳转定位。
- 审核后台：通过 / 退回 / 拒绝，结果本地持久化，刷新不丢。

> 技术栈保持与恢复版本一致：React 18 (CDN) + Babel Standalone + 纯静态 HTML/JSX/CSS，
> 无构建步骤、无打包工具。

---

# 戈尔贡 · Gorgon Design System

> **发现你的周末** — Discover your weekend.
> The design language for Gorgon, a platform that helps Shanghai university
> students find weekend activities online and sync them to their schedule.

---

## 1 · Company & product context

**上海戈尔贡科技有限公司 (Shanghai Gorgon Technology Co., Ltd.)** builds **Gorgon (戈尔贡)** —
a discovery-and-sync platform for 上海 college students. Students browse weekend
activities aggregated from across the web (club events, markets, sports meetups,
exhibitions, workshops, live shows), then **sync** the ones they like into a personal
"我的周末 / My Weekend" schedule that lives on their phone.

The two verbs that define the product are **发现 (discover)** and **同步 (sync)**.
Everything in the brand reinforces this: the mark is an open ring (discover) closed
by a mint dot (synced); the signature gradient runs indigo→mint (browse→saved).

**Surfaces in this system**
- **Mobile app** (primary) — Discover feed, Activity detail, Search & filters, My Weekend, Map.
- **Web dashboard** — a desktop companion for planning the week and managing saved activities.
- **Slide template** — branded deck for pitches and campus partnerships.

**Sources provided:** none. There was no attached codebase, Figma, or existing brand.
This system was designed from scratch against the company brief above. If a real
codebase or Figma exists, re-attach it via the Import menu and this system should be
reconciled against it.

---

## 2 · Content fundamentals (voice & copy)

Gorgon talks like a **smart, upbeat friend who knows what's on this weekend** — never
corporate, never try-hard. The product is bilingual: **Chinese leads, English supports.**

**Language & casing**
- **Chinese is primary.** Headlines, buttons, and body are Chinese first.
- **English appears as an accent layer** — kickers, labels, section tags, numerals,
  the wordmark. Set English in `Space Grotesk`, often UPPERCASE with wide tracking
  (e.g. `THIS WEEKEND`, `42 ACTIVITIES`). This bilingual contrast is a signature.
- Chinese never uses ALL-CAPS (not a thing); emphasis comes from weight/size.

**Person & tone**
- Address the user as **你** (informal "you"), never 您. Warm, peer-to-peer.
- The product refers to itself rarely; when it does it's **Gorgon** or **我们**.
- Imperative and inviting: 「同步到我的周末」「去发现」「这周有空吗？」
- Short. Most UI strings are 2–6 Chinese characters. Headlines under 12.

**Vibe & examples**
- Energetic but not noisy. Confident, a little playful.
- ✅ `本周末 · 38 场活动` · `已同步 ✓` · `就在你附近` · `周六下午有空？`
- ✅ Kicker: `THIS WEEKEND` · CTA: `去发现` / `立即同步`
- ❌ Avoid: 「欢迎使用本平台」「点击此处查看更多详情」 (too formal/clunky).
- Numbers and times are a feature — show them proudly in display/tabular figures
  (`14:30`, `¥0`, `2.1km`, `周六 6.15`).

**Emoji:** sparingly, never as load-bearing UI. Category color-dots and Lucide icons
do the iconographic work instead. An occasional emoji in marketing copy is fine.

---

## 3 · Visual foundations

**Overall feeling:** clean, bright, and modern with a youthful charge. Generous white
space on cool slate; punctuated by electric indigo and a fresh mint. Rounded, friendly,
confident — closer to a well-made consumer product than a utilitarian listings app.

### Color
- **Primary — Electric Indigo `#5B47E0`.** Brand actions, links, focus, the mark.
- **Secondary — Mint `#00C28E`.** "Synced/saved" states, success, the second half of
  the sync gradient. Used as a reward color — it shows up when something good happens.
- **Neutrals — cool Slate.** Backgrounds are `--bg-base #F7F8FB`; cards are pure white.
  Text is near-black ink, not pure black.
- **Category accents** (sport/music/art/food/outdoor/study) give the feed visual variety
  — each activity type carries a consistent hue dot/tag.
- **Accent pops** (coral, amber, pink) used rarely for live/hot/trending flags.
- Two brand colors maximum on any one screen. Let mint be a moment, not a wash.

### Typography
- **Display — `Space Grotesk`.** Headlines, big numerals, times, kickers. Geometric,
  slightly quirky, techy-young. Tight tracking on large sizes.
- **Sans — `Plus Jakarta Sans` → `Noto Sans SC`.** UI + body. Latin renders in Jakarta,
  CJK falls through to Noto Sans SC automatically.
- **Mono/numerals** reuse Space Grotesk with tabular figures (`.tnum`) for times/prices.
- Hierarchy comes from size + weight contrast, not many fonts. Big confident headlines,
  calm readable body.

### Spacing & layout
- **4px base grid.** Comfortable, airy density — this is a browse-and-feel app, not a
  dashboard crammed with data.
- Mobile frame is `420px`. Content has generous 20–24px side gutters.
- Cards stack with 12–16px gaps; sections separated by 24–32px.

### Backgrounds
- Mostly flat `--bg-base` slate or white. **No busy textures or patterns.**
- **Gradients are reserved for hero moments** — the indigo→mint `--grad-sync`, the
  indigo `--grad-brand`, and the dusk gradient for big marketing/empty states.
  Never gradient body backgrounds wholesale (avoid AI-slop purple wash).
- Activity imagery is full-bleed inside rounded cards, warm and lively (real photos of
  events/places), with a subtle bottom protection gradient when text overlays.

### Corner radii & cards
- Friendly, generously rounded: chips/tags `pill`, buttons `14px`, cards `20px`,
  sheets/hero `28–36px`. App icon squircle `22–32px`.
- **Cards** = white surface, `--radius-lg (20px)`, `--shadow-sm` resting, a hairline
  `--border-subtle` only when on white-on-white. No colored left-border accents.
- Image cards: full-bleed photo top, content below, whole card rounded and clipped.

### Shadows & elevation
- Soft, **indigo-tinted** layered shadows (cool, never neutral-gray).
- Resting cards `--shadow-sm`; raised/sheets `--shadow-md/lg`; primary buttons get a
  colored `--shadow-brand` glow; mint CTAs get `--shadow-mint`.
- Elevation increases with interactivity, not decoration.

### Borders & dividers
- Hairline `1px` `--border-subtle` slate. Dividers are low-contrast.
- Inputs use a `1px` default border that thickens/recolors to indigo on focus + ring.

### Motion
- **Easing:** `--ease-out` for entrances, `--ease-spring` for playful confirmations
  (e.g. the "synced ✓" pop). `--dur-base 200ms` default; `120ms` for hovers.
- Fades + small upward transl(8–12px) for content; scale-in for the sync confirmation.
- No infinite decorative loops. Respect `prefers-reduced-motion`.

### Interaction states
- **Hover:** primary → darker brand (`--brand-strong`) + slight lift; ghost → `--bg-sunken`.
- **Press:** scale to `0.97`, shadow softens. Tactile, quick.
- **Focus:** `3px` `--focus-ring` indigo halo, `2px` offset. Always visible.
- **Selected/synced:** mint fill or mint check; the reward color.
- **Disabled:** 45% opacity, no shadow, `not-allowed`.

### Transparency & blur
- Sticky top bars and the bottom tab bar use a translucent white with `backdrop-blur`
  so content scrolls under them. Use blur only for floating chrome over content —
  never as a body texture.

---

## 4 · Iconography

- **Library: [Lucide](https://lucide.dev)** — loaded from CDN
  (`https://unpkg.com/lucide@latest`). Clean `2px` stroke, rounded line caps/joins;
  matches Gorgon's friendly-geometric feel. This is a **substitution** chosen for the
  from-scratch brand — swap for a bespoke set if one is commissioned.
- Default icon stroke is `2px`, sized 18–24px in UI; color inherits `currentColor`
  (usually `--text-muted`, or `--brand` when active).
- **Category dots, not category icons, carry primary meaning** — each activity type maps
  to a `--cat-*` color. Icons are wayfinding (search, map, calendar, heart, share),
  not decoration.
- **Emoji:** not used as UI. Unicode glyphs are avoided as icons. Use Lucide.
- **Logo assets** in `assets/`: `logo-mark.svg` (squircle G + mint sync dot),
  `logo-wordmark.svg` (mark + 戈尔贡 lockup), `logo-wordmark-light.svg` (for dark bg).

---

## 5 · Index / manifest

**Root**
- `styles.css` — global entry (imports only). Consumers link this.
- `readme.md` — this file. · `SKILL.md` — Agent-Skill wrapper.

**`tokens/`** — `fonts.css`, `colors.css`, `typography.css`, `spacing.css`, `effects.css`, `base.css`

**`assets/`** — `logo-mark.svg`, `logo-wordmark.svg`, `logo-wordmark-light.svg`

**`guidelines/`** — foundation specimen cards (Type, Colors, Spacing, Brand) shown in the Design System tab.

**`components/core/`** — reusable primitives:
`Button`, `IconButton`, `Tag`, `CategoryDot`, `Badge`, `Avatar`, `Input`, `SearchField`,
`Switch`, `SegmentedControl`, `ActivityCard`, `StatBlock` — each with `.jsx` + `.d.ts` + `.prompt.md`, plus card HTML.

**`components/trust/`** — trust & verification primitives:
`VerifiedBadge`, `SourceTag`, `TrustBanner`, `FreshnessLabel`, `ReportSheet` — the UI for
信息真实性 (see §6). Same file pattern, plus `trust.card.html`.

**`components/location/`** — location & navigation primitives:
`RoutePlanner` (transit options: 地铁/公交/骑行/步行/驾车 + ETA) and `MapAppSheet`
(deep-link hand-off to 高德 / 百度 / 腾讯 / Apple 地图). See §7. Plus `location.card.html`.

**`ui_kits/`**
- `app/` — mobile app (Discover, Activity detail, Search, My Weekend, Map).
- `dashboard/` — web planning dashboard.
- `admin/` — 审核后台 (review console): 爬取→自动校验→人工审核→发布. The human-in-the-loop
  surface that gates information authenticity (see §6).

**`slides/`** — branded sample slides (title, agenda, big-stat, comparison, quote, closing).

---

## 6 · Trust & information authenticity · 可信度设计原则

Gorgon aggregates weekend activities from across the web, so **information trust is
the product's核心命题**. Every listing must let a student answer: *is this real, current,
and from a source I can check?* The system encodes this in four layers, each with
dedicated UI in `components/trust/`.

**1 · Source provenance · 来源可溯**
Every aggregated listing keeps its origin and links back. `SourceTag` renders
「来源 · <出处> ↗」 and opens the original. "我们说的"永远能回到"他们说的".

**2 · Host verification · 主办方认证** — `VerifiedBadge`, four levels:
- `verified` (mint) — submitted credentials / official campus partner.
- `official` (indigo) — verified venue or brand account.
- `aggregated` (grey) — machine-scraped, not yet confirmed by the host.
- `unverified` (amber) — user-submitted; flagged 待核实 until corroborated.

**3 · Freshness & change · 时效与变更**
`FreshnessLabel` shows 「<时间>更新」 or 「主办方已确认」. `TrustBanner` sits atop the
detail view with a status: `confirmed` (mint) / `unverified` · `changed` (amber) /
`cancelled` (coral). Aggregated listings never masquerade as confirmed.

**4 · Community signal · 社群反馈**
`ReportSheet` lets any student flag bad info (时间/地点有误, 已取消, 票价不符, 重复, 虚假).
Reports + 到场率 + 「我去过」 feed back into a listing's trust level. The crowd keeps
aggregated data honest.

**Color discipline:** trust states reuse the semantic palette exactly — mint = confirmed
(the reward color), amber = needs-check (warning), coral = cancelled (danger). No new
colors are introduced; trust *is* the semantic system applied to information quality.

**Copy rules:** never overclaim. An unconfirmed listing says 「来自网络聚合，尚未经主办方确认，
请以原始来源为准」 — honest, not alarming. Confirmation is earned language, reserved for
genuinely verified data.

---

## 7 · Location & navigation · 到达方式与导航

Discovery is only useful if students can actually *get there*. Every activity carries a
full `address`, a `coord` { lng, lat }, and a `transit` array, surfaced in the detail
view's **到达方式** section via two components in `components/location/`.

**`RoutePlanner`** — a from→venue summary (straight-line distance) plus ranked transit
options. Each option has a `mode` (`metro` / `bus` / `bike` / `walk` / `drive` / `taxi`),
a line label, a step detail, an ETA, and optional cost; the recommended option is
highlighted in brand indigo. Ends with a single **「用导航软件打开」** button.

**`MapAppSheet`** — the hand-off. Rather than building an in-app turn-by-turn engine,
Gorgon respects the map app students already use: a bottom sheet deep-links to
**高德 / 百度 / 腾讯 / Apple 地图**, opening the native app (web fallback) with the
destination prefilled. Students navigate in their tool of choice.

> **Coordinate caveat:** providers use different geodetic systems — Amap & Tencent
> GCJ-02, Baidu BD-09, Apple/GPS WGS-84. The prototype links raw coordinates; production
> must convert per provider or pins will be offset by ~50–700m.

**Why hand-off, not in-app nav:** building reliable routing for all of 上海 is out of
scope and students trust their existing map app's live traffic. Gorgon's job is accurate
*discovery + the right deep-link*, not re-inventing 高德.

---

*Webfont note: Space Grotesk, Plus Jakarta Sans, and Noto Sans SC are loaded from the
Google Fonts CDN rather than self-hosted binaries. For production, self-host licensed
files and update `tokens/fonts.css`.*
