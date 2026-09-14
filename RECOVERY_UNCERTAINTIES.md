# RECOVERY UNCERTAINTIES

Every item below is something that could **not** be recovered verbatim from the export.
No content was guessed or invented to fill these gaps — they are recorded honestly.

---

## U1 — `_ds_bundle.js` was runtime-generated, not exported
**Severity: High (blocks app/admin/dashboard from running as-exported).**
The entry HTMLs (`ui_kits/app|admin|dashboard/index.html`) load `../../_ds_bundle.js`,
which populates `window.GorgonDesignSystem_56aa78` with all core/trust/location
components + `CATEGORIES`. That file is produced by Claude's design-system runtime and
was **never written into the chat history**, so its exact original bytes are unrecoverable.

**How it was handled:** reconstructed (not invented) at `Gorgon-Recovered/_ds_bundle.js`.
It compiles the **real recovered** `components/**/*.jsx` with the page's own Babel and
exposes their exports on the namespace, using the same import/export → global glue the
original generator performed. Validated headlessly: all 19 sources compile and the
namespace populates with all 20 expected exports (`ActivityCard` renders correctly).
If you later obtain the original generated file, drop it in to replace this one.

## U2 — `deploy/index.html` (8 MB inlined build) not stored
**Severity: Medium.** Produced by `super_inline_html` (3 calls, msg 14/26/28) from
`ui_kits/app/index.html`. The **output** of that transform was never stored in the
export, so the exact inlined single-file build cannot be reproduced verbatim.
The source `ui_kits/app/index.html` it was built from **is** recovered and runs
directly under a static server, so this only affects the "double-click one file" path,
not the dev/serve path.

## U3 — `templates/pitch-deck/PitchDeck.dc.html` base missing
**Severity: Medium.** The export contains 4 `dc_html_str_replace` / `dc_js_str_replace`
diffs targeting this file, but **no `write_file` for its base content**. So only the
diffs survive; the full `.dc.html` (Claude's "design canvas" deck wrapper) is not
recoverable. The 7 individual slide HTMLs (`slides/*.html`) **are** fully recovered,
so the pitch-deck *content* is preserved as standalone slides; only the master `.dc.html`
deck shell is missing.

## U4 — `deploy/README.md` and `deploy/vercel.json` deleted by Claude
**Severity: Low.** Both were written early, then explicitly `delete_file`'d at msg 18.
They are therefore **excluded from the final tree** (faithful to Claude's last state).
Their content still exists in the export's earlier `write_file` calls; re-add them if
you want deployment docs/config back.

## U5 — 3 `write_file` calls with no filename in the export
**Severity: Low.** At msg 3, 22, 23 the export recorded a `write_file` with `content`
but **no `path`** (Claude's export dropped the path field). Their content corresponds
to already-recovered files:
- msg 3 → a `Map view` component using `window.GorgonDesignSystem_56aa78` (matches `ui_kits/app/MapScreen.jsx`)
- msg 22 → deep-link builders for CN/Apple maps (matches `components/location/RoutePlanner.jsx`)
- msg 23 → a `Route & Navigation` design-system card (matches `components/location/location.card.html`)

No filename was invented for these; they appear to be earlier versions of files we
already have verbatim. Listed for completeness.

## U6 — `SKILL.md` referenced but absent from Gorgon export
**Severity: Low.** `readme.md` lists `SKILL.md` as a root file ("Agent-Skill wrapper"),
but no `SKILL.md` exists in the Gorgon chat. The only `SKILL.md` in the entire export
belongs to the unrelated **智能教案** project. So Gorgon's `SKILL.md` is genuinely
missing from the recoverable data.

## U7 — Runtime dependency on public CDNs
**Severity: Low (operational).** The recovered HTMLs load React, Babel Standalone and
Lucide from `unpkg.com`. The recovered code is complete, but **first load needs
internet** for those CDNs (per `本地运行指南.md`). This is unchanged from the original
design, not a recovery defect.

---

## What was deliberately NOT done
- No file was invented to "complete" the project.
- No `git reset`/`git clean`/disk cleanup was run.
- The 4 source ZIPs in `E:\` were **never modified** (only extracted to a temp work dir).
- Recovered output went to a **new directory** (`C:\Users\lin\Documents\Gorgon-Recovered`),
  not over any existing project.
