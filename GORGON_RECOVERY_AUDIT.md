# GORGON RECOVERY AUDIT

> Generated during recovery of the **Gorgon / Gorgon Design System** project from a
> Claude data export. Source of truth: the 4 read-only ZIPs in `E:\` (never modified).

---

## 1. Where the Gorgon data actually lived

The export contained 4 ZIPs. Only two carried Gorgon content:

| ZIP | Size | Gorgon content |
|---|---|---|
| `conversations-000.zip` | 3.4 MB | **None.** No Gorgon keyword match. This is general chat history, not the Gorgon build. |
| `design_chats-000.zip` | 458 KB | **Yes — this is the source.** 10 chat JSONs; 6 mention Gorgon keywords. |
| `projects-000.zip` | 446 B | Not Gorgon (a single "智能教案" project stub). |
| `light_metadata-000.zip` | 1 KB | Not Gorgon (login/users metadata). |

Inside `design_chats-000`, the chats break down as:

| Chat file | Project name | Gorgon files? |
|---|---|---|
| **`fe435e89-…json`** | **Gorgon Design System** | **YES — 115 write_file paths, the entire project** |
| `792fec17-…json` | Studio OS 工作室协作平台 | No (references Gorgon *as a design system* only) |
| `fa7d0482-…json` | Studio OS 工作室协作平台 | No (same) |
| `a668b202-…json` | 智能教案 Design System | No — different product (lesson-plan app) |
| `758dbd7d-…json` | STUDIO Design System | No |
| `9b07283d-…json` | Studio OS Design System | No |
| `77f591d6 / a79e3482 / b38ea8bd` | empty | No |

**Conclusion:** all recoverable Gorgon content comes from a single chat,
`fe435e89-…json` (project *"Gorgon Design System"*, 39 messages, 562 KB,
2026-06-14 → 2026-06-15). The other chats only *consume* the Gorgon design system.

---

## 2. How the build was reconstructed

The chat was not plain prose — it was a **tool-driven build**. Claude used real
tool calls whose inputs contained full file contents:

| Tool | Count | What it gave us |
|---|---|---|
| `write_file` | 120 | `content` + `path` — full file bodies |
| `str_replace_edit` | 28 | `old_string`/`new_string` (and `edits[]`) — diffs |
| `dc_html_str_replace` / `dc_js_str_replace` | 4 | diffs against `templates/pitch-deck/PitchDeck.dc.html` |
| `delete_file` | 10 | explicit deletions (mostly scratch PNGs) |
| `read_file` / `grep` / `list_files` | 22 | inspection only |
| `show_html` / `save_screenshot` / `present_fs_item_for_download` / `super_inline_html` | 31 | preview/export only |

**Replay method (Phase 2):** every tool call was replayed in chronological order
per file — `write_file` sets the body, `str_replace_edit`/`dc_*_str_replace`
apply diffs on top, `delete_file` removes from the final tree. Where a `str_replace`
could not match, it was recorded (see uncertainties), not guessed.

---

## 3. Audit findings

1. **Gorgon-related conversations found:** 1 primary (`fe435e89`, 39 messages);
   plus 2 chats that reference Gorgon only as a shared design system (not part of the build).
2. **Earliest / latest activity:** 2026-06-14 10:08 → 2026-06-15 05:44 (UTC).
3. **Recoverable project directory structure (final state):**
   ```
   Gorgon-Recovered/
     readme.md                  本地运行指南.md            styles.css   _ds_bundle.js*
     assets/  (logo-mark / logo-wordmark / logo-wordmark-light .svg)
     tokens/  (base, colors, typography, spacing, effects, fonts .css)
     guidelines/ (brand, colors, spacing, type specimen .html)
     components/
       core/     ActivityCard, Avatar, Badge, Button, CategoryDot, IconButton,
                 Input, SearchField, SegmentedControl, StatBlock, Switch, Tag
                 (+ .jsx / .d.ts / .prompt.md / .card.html each)
       trust/    VerifiedBadge, SourceTag, TrustBanner, FreshnessLabel, ReportSheet
       location/ RoutePlanner, MapAppSheet
     ui_kits/
       app/      AppShell, DiscoverScreen, ActivityDetailScreen, SearchScreen,
                 MyWeekendScreen, MapScreen, data.js, index.html, README.md
       admin/    ReviewConsole, queue.js, index.html, README.md
       dashboard/Sidebar, index.html, README.md
     slides/    title, agenda, bigstat, comparison, quote, closing, index .html
   ```
   `* _ds_bundle.js` is **reconstructed** (see §7), not from the export.
4. **Fully recovered files:** 112 (every `write_file` body, last-write-wins).
5. **Only-partially recoverable:** `templates/pitch-deck/PitchDeck.dc.html`
   — export holds only 4 diffs, not the base file. The 7 individual slide HTMLs
   ARE fully recovered, so the pitch-deck content survives as standalone slides.
6. **Referenced-but-absent (filename only):** none beyond the above. (Every
   `import "./X.jsx"` and every `<script src>` in the recovered files resolves
   to a recovered file.)
7. **Claude's last development state:** a complete, high-fidelity static prototype
   of the Gorgon Design System + Mobile App + Admin (审核后台) + Dashboard +
   Pitch Deck slides, described (by Claude) as "高保真原型 … 活动数据是手工填的样例"
   — i.e. a frontend prototype with **hand-entered sample data, no backend**.
8. **Original tech stack:** React 18 (UMD via CDN), Babel Standalone (in-browser JSX),
   Lucide icons (CDN), plain CSS + CSS variables (design tokens), SVG logos.
   **No build step, no `package.json`, no bundler** — it ran as static files served
   by any HTTP server (`python3 -m http.server`). `deploy/` was an 8 MB inlined
   single-file build (`super_inline_html`).
9. **Original run method:** `cd 项目文件夹 && python3 -m http.server 8000`,
   then open `http://localhost:8000/ui_kits/app/`. Requires internet on first load
   (React / Babel / Lucide come from CDN).
10. **Recovery risks:**
    - `_ds_bundle.js` was a **runtime-generated** file (Claude's design-system
      tooling) and was **never written into the export** → reconstructed (risk:
      the exact original bundle is unrecoverable, but the reconstruction is
      mechanically derived from 100% real component source and was validated).
    - `deploy/index.html` (the 8 MB inlined build) was produced by
      `super_inline_html`; its output was **not stored** → not recoverable verbatim.
    - `PitchDeck.dc.html` base not in export → deck wrapper only partially recoverable.
    - `deploy/README.md` + `deploy/vercel.json` were written then **deleted by
      Claude** in-session → excluded from final tree, but their content exists in
      the export if you want them back.
    - `SKILL.md` (referenced in `readme.md`) is **not in the Gorgon export** —
      the only `SKILL.md` in the export belongs to the unrelated 智能教案 project.
