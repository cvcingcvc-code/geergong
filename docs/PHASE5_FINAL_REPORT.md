# Gorgon PHASE 5 — FINAL REPORT

**From demo to a real information-retrieval product.**

Everything below was produced by running the real retrieval loop against the
live internet, then asserting on the result in a real browser. No fixture is
involved in any figure marked REAL.

---

## BRANCH / COMMIT

| | |
|---|---|
| Branch | `feature/human-review-loop` |
| Main landing | `79e7399` feat(search): real web retrieval + event images + desktop search/detail UI |
| Relevance / Meetup / image fixes | `d6cdd69` fix(search): real-source relevance, Meetup provider, image provenance |
| Detail-page copy (D-1, D-2) | `7b87b93` |
| Image contract, headline count, this report (D-3, D-4) | `b7bcaec` |
| Source bullet stars (D-5) | `0e3e31b` |
| `.git` backup | `~/.workbuddy/gorgon-git-safe/phase5-quality-*` |

HEAD at the time of writing: `fab4ba8`. Working tree clean; every commit verified
by `git rev-parse HEAD` **and** by reading the ref file back, because this machine
silently drops writes to `.git/refs`.

---

## REAL SEARCH

Two families, behind one `SearchProvider.search(query)` contract, so nothing
downstream knows or cares which produced a hit.

| Provider | Kind | Key | This run |
|---|---|---|---|
| `events:meetup` | event platform | none | **available**, 9 hits |
| `events:segmentfault` | event platform | none | available, 0 hits |
| `events:douban` | event platform | none | available, 0 hits |
| `events:huodongxing` | event platform | none | **blocked** (anti-bot wall) |
| web search (Brave/Bing/Serper/SearXNG) | open web | `SEARCH_API_KEY` | not configured |

- **No silent fallback.** With `SEARCH_API_KEY` missing the run reports
  `web_search_not_configured` and uses only the platforms' own public pages;
  every result is still a real web page. `providerMode: "real"`,
  `DEMO_DATA: null`.
- **No invented query.** Meetup is queried with keywords the planner derived
  from the request (`上海 AI 活动 本周末`, `上海 Agent Meetup 本周末`, …).
- **A blocked source degrades honestly**: 活动行 is reported
  `available: false, reason: "blocked"`, the run emits a `provider_degraded`
  warning, and the remaining sources are returned. Nothing is faked to fill
  the gap. This is why the result count legitimately varies between runs
  (30 → 13 → 12) — the sources themselves are intermittent, and the pipeline
  says so rather than hiding it.

## PAGE FETCHER

`pipeline/search/fetcher.py` — stdlib only, one fetch, fully isolated:

- 12 s per-request timeout, 1.5 MB response cap, **4 redirects max**
- Desktop Chrome 124 User-Agent (Beijing/HK-platform pages serve different
  HTML to an unknown client)
- Every failure becomes a *reason*, never an exception:
  `timeout` / `redirect_loop` / `http_error` / `too_large` / `binary` /
  `blocked` (anti-bot wall detected and *not* parsed as content)
- Fetches run 4-way parallel under a 30 s budget, capped at 14 pages per
  search, and the budget is respected — rows that miss the cut still leave
  with a consistent image triple (below).

## EVENT EXTRACTOR

`pipeline/search/extract.py` — deliberately conservative, stdlib-only:

1. `og:` / `twitter:` meta → 2. JSON-LD `Event` nodes → 3. platform-embedded
   state (活动行 `__INITIAL_STATE__`, Meetup Apollo cache) → 4. visible markup.

Reports what the page SAYS; everything absent stays `null` and the UI renders
**待定** rather than guessing. Records the *provenance of each field*
(`fieldSources`: `embedded` / `meta` / `listing` / `og:image`).

**Prose is normalised, never rewritten.** `pipeline/search/textnorm.py` removes
the typewriter syntax a reader was never meant to see — Meetup bodies are
Markdown (`**Bringing Dubai AI**`, `## What this event is about`) — while
keeping **every word the source wrote**. `<br>`/`</p>` become real newlines, so
paragraph structure survives into the detail page.

## IMAGE EXTRACTION

Priority is fixed and recorded per candidate, so the UI can always answer
*"where did this picture come from?"*:

| Priority | Source | `imageType` |
|---|---|---|
| 100 | `og:image` / `og:image:secure_url` | `remote` |
| 90 | `twitter:image` | `remote` |
| 80 | JSON-LD `Event.image` | `remote` |
| 60 | main hero `<img>` in the body | `remote` |
| 50 | search-engine thumbnail / listing image | `thumbnail` |
| 0 | generated category placeholder | `placeholder` |

The **`imageUrl` / `imageSource` / `imageType` triple is a contract** and must
agree; `Enricher._finalise_image()` guarantees every row leaves with a
consistent triple, so a row can never claim an image it does not have. Renditions
are upgraded where the platform allows (豆瓣 `small` → `large`; Meetup
`highres` → `600`).

REAL, this run: **12 rows, 12 with a real remote photo, 0 placeholders.**

## PIPELINE NUMBERS

Two real runs, minutes apart, same query — shown together because the
difference *is* the finding (a source went from serving to blocking):

| Stage | Run A (full) | Run B (degraded) |
|---|---|---|
| Raw search results | 71 | 33 |
| After merging | 30 | 12 |
| Merged as duplicates | 41 | 21 |
| Normalized | 30 | 12 |
| Canonical | **29** | **11** |
| — approved | 1 | 1 |
| — needs review | 28 | 10 |
| — duplicate candidates | 1 | 1 |
| Rejected | 0 | 0 |
| Returned | **30** | **12** |

**1 approved / 28 needs review is the correct outcome, not a bug.** These are
single-source web hits; the review gate is designed to let them into human
review rather than auto-publish them. A keyless aggregator that approved its own
scrape would be lying.

---

## DESKTOP SEARCH UI

1920×1080: ask hero → `2fr` results / `1fr` context column.

- Natural-language query accepted verbatim; the plan is shown back.
- `REAL SEARCH` badge, driven by `providerMode` — never a silent demo fallback.
- Every card: real image, title, date/time, venue + district, price, trust chip,
  and the score.
- Headline reads *找到 N 条相关信息，为你整理出 M 个活动*, where **M equals the
  number of cards listed** (see D-3 below).
- Context column: source mix, dedupe accounting, provider notices.

## DESKTOP DETAIL UI

1920×1080: main column + 340 px sticky sidebar.

- 16:6 hero; **4-column facts** (时间 / 地点 / 票价 / 主办方).
- **为什么推荐** is rendered from the ranking's real reasons
  (`AI 主题高度匹配`, `位于徐汇`, `活动时间符合下午偏好`) — and the block is
  hidden entirely when there are none.
- Trust card: score, status, and reasons **in Chinese**, caveats first.
- **No fabricated registration link**: either a real outbound `https://` link
  or an explicit 暂未找到报名链接.
- **No invented transit time**: the map area is an explicit placeholder — no
  metro lines, no "12 分钟".
- 活动介绍 renders only what the source published, as readable prose.

## DISCOVER

`发现` is an image-card grid built from the **same view model** as search and
detail (3 / 2 / 1 columns at ≥1200 / 768–1199 / <768). Clicking a card opens the
same Desktop Detail page — there is exactly one detail screen and one
normaliser, so the three surfaces cannot drift apart.

## MY WEEKEND

- Real timeline by day (`周六 9.19`), not a card grid.
- Overlapping activities are flagged **时间冲突** in red; a clear day says
  时间无直接冲突. Naive times never invent a conflict.
- **交通时间尚未计算** — stated plainly, because no routing provider is
  connected. Gorgon does not guess.
- Persists the whole activity snapshot in `localStorage`, so a saved result
  survives a refresh (asserted in E2E).

## SOURCE PROVENANCE

Every result carries one row per contributing source: publisher, URL, trust
label (高/中/低可信), provider, `dataOrigin`, retrieval time and the query that
found it. The detail sidebar links out to each source. A record with no
traceable link says so instead of inventing one.

---

## TESTS

| Suite | Count | Command |
|---|---|---|
| Python (unittest) | **206** | `python -m unittest discover -s pipeline/tests -t .` |
| JS view model | **125** | `node pipeline/tests/ui_view_model.test.mjs` |
| Browser E2E | **35** | `node pipeline/tests/e2e_phase5.mjs` |

New this phase: `test_search_relevance.py` (35), `test_textnorm.py` (20),
`test_trust_labels.py` (3, derives the vocabulary from `trust/scorer.py` and
asserts the UI translates it **exactly** — no gaps, no dead entries).

`fixtures/textnorm_corpus.json` (34 cases) is asserted by **both** the Python and
the JS suite, because the normaliser exists twice (the app also renders legacy
records and localStorage snapshots that never pass through the pipeline). Adding
that corpus immediately exposed three real divergences.

## BROWSER E2E

Real Edge, driven over CDP by `pipeline/tests/cdp_session.mjs` (zero
dependency; no Playwright, no 500 MB download). 1920×1080 full loop, then
390×844.

Asserts on **substance**, not markup: 30/30 result images loaded at ≥600 px
natural width; persistence across reload; zero console errors; and the rendered
*copy* itself (no rule name leaks, no Markdown leaks, headline count equals the
cards). Cache is disabled before the first navigation — a cached bundle would
mean the suite was testing the previous build.

## CONSOLE ERRORS

**0.** Asserted on every run.

## SCREENSHOTS

| File | Size |
|---|---|
| `docs/screenshots/desktop-1-smart-search.png` | 1920×1080 |
| `docs/screenshots/desktop-2-search-results.png` | 1920×1080 |
| `docs/screenshots/desktop-3-event-detail.png` | 1920×1080 |
| `docs/screenshots/desktop-4-my-weekend.png` | 1920×1080 |
| `docs/screenshots/mobile-5-search.png` | 390×844 |
| `docs/screenshots/mobile-6-detail.png` | 390×844 |

---

## DEFECTS FOUND AND FIXED THIS PHASE

Each was found by *reading the output* rather than by a test — which is why the
tests now cover them.

**D-1 — the trust card printed pipeline internals.** A reader saw
`cross_source_conflict`. Cause: `trustReasons` were passed through verbatim.
Now translated (`多个来源信息存在冲突`), caveats first, with a test that derives
the scorer's vocabulary and fails if a new rule has no label.

**D-2 — the description was rendered verbatim.** Meetup Markdown reached the
page, half-stripped: `**19:30–21:30 … hidden gem**21:30`, with `##` stranded
mid-line. Cause: no prose normalisation, and the upstream cleaner flattened
newlines so line-anchored rules could never match. Now: shared
`textnorm.plain_text`, newlines preserved, `##` handled mid-line, and a leftover
sweep so no `**`/`__` marker can survive.

The organiser's own **single** `*` bullets are treated narrowly: a star that
follows sentence punctuation or a line start (`closes. *19:30`, `）: *Item`) is
markup and goes. A star sitting between a word and a space (`group * 21:30`) is
left alone, because that position is **structurally identical to `5 * 3`** —
there is no rule that removes the first without destroying the second. See
limitation 9.

**D-3 — the headline count contradicted the list.** It stated
`summary.canonical` (11) above 13 rendered cards. Cause: canonical counts
deduped entities; the list also renders suspected duplicates. Now the headline
states what is listed, and the E2E asserts **equality** instead of merely
`> 0` — the loose assertion had been hiding it.

---

## KNOWN LIMITATIONS

1. **No general web search.** Without `SEARCH_API_KEY` the product only sees
   event-platform pages, so recall is bounded by those platforms. The pipeline
   says so (`web_search_not_configured`) rather than pretending otherwise.
2. **Source availability is intermittent.** 活动行 served 19 hits earlier today
   and hit an anti-bot wall (`verify.huodongxing.com/gt3`) later. Same code,
   same query, different universe. Handled as a reported degradation — but it
   means result counts are not reproducible run to run.
3. **豆瓣同城 has no keyword search interface** (its search/category URLs 404),
   so it can only be browsed. Recall from it is structurally thin. Its image CDN
   rejects an empty `Referer`, so `referrerpolicy="no-referrer"` must never be
   added to those `<img>` tags.
4. **Single-source records all land in human review** (1 approved / 28 needs
   review). Correct by design, but the "approved" shelf will stay nearly empty
   until a second corroborating source or a review pass exists.
5. **A suspected duplicate renders as 存在冲突.** The card shows the conflict
   chip for `duplicateOf`; there is no distinct 疑似重复 state. Defensible (two
   records claiming to be one event *are* in conflict) but arguably the wrong
   word. Left as product decision — see next tasks.
6. **The desktop detail page renders the same description twice** — once as the
   header lead, once in 活动介绍. Harmless but visibly redundant.
7. **No routing provider**, so transit time and travel-aware conflict detection
   are absent by design, and the UI says so.
8. Meetup returns 429 under sustained probing; the provider treats it as a
   degraded source rather than retrying.
9. **A source's own single `*` bullets can still appear.** Across the 12 rows of
   the reported run, 59 asterisks in the raw text normalise to 28 — and every
   survivor sits in the one position that cannot be disambiguated from
   multiplication (word, space, `*`, space). Removing them would also delete the
   `*` in `5 * 3`, so they are kept deliberately. Zero `**` / `](` / `\n` leaks
   remain; this is only about lone asterisks, which read as list bullets to a
   human anyway.

## NEXT 3 TASKS

1. **Give suspected duplicates their own state.** Add 疑似重复 to the trust
   vocabulary, mark the card, and make the DuplicateCandidates bucket legible
   instead of borrowing 存在冲突. Decide whether a duplicate row belongs in the
   results list at all.
2. **Close the single-source review gap.** Either add a corroborating keyless
   source (a second event platform with a working search interface), or build
   the review-pass that promotes trusted single-source records — so `approved`
   stops being a shelf of one.
3. **Make the header lead a real lead.** Truncate the detail header to the first
   paragraph (or a character budget) and keep 活动介绍 as the full text, so the
   page stops printing the same 2000 characters twice.
