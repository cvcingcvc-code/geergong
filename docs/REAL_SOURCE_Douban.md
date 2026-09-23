# REAL SOURCE VALIDATION — 豆瓣同城 (上海)

**Status: PHASE 1 — one real source, verified against the live site.**

Everything below was read off the live pages on **2026-09-22** (Asia/Shanghai).
No rule here was written from memory, from an older fixture, or from a guess.
Where the source does not publish a fact, the record keeps `null` and this
document says so.

Legend:

* **CONFIRMED** — seen on the live page and extracted deterministically
* **UNKNOWN** — not established; no rule asserts it
* **UNAVAILABLE** — established that the source does NOT publish it

---

## 1. Entry point

| item | value |
|---|---|
| Listing URL | `https://shanghai.douban.com/events/future-all` |
| HTTP status | `200` |
| Content-Type | `text/html; charset=utf-8` |
| Page size (page 1, decompressed) | ~66 KB |
| `<title>` | `上海近期同城活动_豆瓣` |
| Login required | no (the page is public) |
| Captcha / wall seen during validation | none |

City slug pattern (CONFIRMED for 上海): `https://<slug>.douban.com/events/future-all`.

---

## 2. Pagination

**CONFIRMED.**

| item | value |
|---|---|
| URL structure | `?start=<offset>`, offset = `(page - 1) * 10` |
| Page 1 | bare URL, no query string |
| Page 2 | `?start=10` |
| Page 3 | `?start=20` |
| Rows per page | **10** |
| Total pages (page 1 states it) | `data-total-page="153"` → **153 pages** |
| Last real page | `?start=1520` → 4 rows |
| Out of range | `?start=1530` and `?start=5000` → HTTP 200, **0 rows** |

**Stop-condition trap (CONFIRMED):** an out-of-range offset still returns
HTTP 200 *and still renders a `后页>` next control*. A crawler that trusts the
next control alone would loop forever past the end. The implementation
therefore stops on: no rows, `data-total-page` reached, no new activity URLs,
repeated listing URL, or `--max-pages`.

Evidence (live requests, 2026-09-22):

```
GET /events/future-all            -> 200, 10 rows, data-total-page=153
GET /events/future-all?start=10   -> 200, 10 rows (disjoint ids)
GET /events/future-all?start=20   -> 200, 10 rows (disjoint ids)
GET /events/future-all?start=1520 -> 200,  4 rows
GET /events/future-all?start=1530 -> 200,  0 rows
GET /events/future-all?start=5000 -> 200,  0 rows
```

---

## 3. Activity detail URL

**CONFIRMED.** `https://www.douban.com/event/<numeric-id>/` — HTTP 200, ~124 KB.

Two caveats found on the live page and handled:

1. The main result rows are `<li class="list-entry" itemscope itemtype=
   ".../Event">`. The **sidebar** also contains `<li class="... list-entry">`
   ticket-shop rows **without** `itemscope`, and those same rows repeat
   unchanged on *every* page. Page 1 has 15 `class="list-entry"` nodes but
   only **10** real result rows. Matching on `itemscope` is what keeps the
   sidebar out.
2. Sidebar rows append `?icn=list-shopitem`. The crawler rebuilds the URL from
   the numeric id (`https://www.douban.com/event/<id>/`), so a tracking
   suffix can never create a phantom duplicate.

---

## 4. Fields

| field | status | where it comes from |
|---|---|---|
| activity detail URL | **CONFIRMED** | listing `<a href=".../event/<id>/">` |
| title | **CONFIRMED** | listing `<span itemprop="summary">`; detail `<h1 itemprop="summary">` |
| start date/time | **CONFIRMED** | `<time itemprop="startDate" datetime="2026-10-01T08:00:00">` (listing **and** detail) |
| end date/time | **CONFIRMED** | `<time itemprop="endDate" datetime="...">` (listing **and** detail) |
| city | **CONFIRMED** | 1st token of the listing location title; detail `itemprop="region"` |
| district | **CONFIRMED** | 2nd token of the listing location title (`长宁区` → `长宁`); detail `itemprop="locality"` |
| address | **CONFIRMED** | detail `itemprop="street-address"`; listing tokens 3..n |
| **venue name** | **UNAVAILABLE** | see below |
| price | **CONFIRMED** | listing `<li class="fee">`; detail `itemprop="ticketAggregate"` |
| organizer | **CONFIRMED** | listing `发起：`; detail `主办方： <a itemprop="name">` |
| source URL | **CONFIRMED** | the detail URL itself |
| category (bonus) | **CONFIRMED** | detail `itemprop="eventType"` (旅行 / 展览 / 运动 / 电影 …) |
| latitude / longitude | present on the page, **NOT collected** — PHASE 1 explicitly excludes geocoding |

### Why `venueName` is always null

豆瓣 publishes **one** 地点 string, split by microdata into
`region` + `locality` + `street-address`:

```html
<div class="event-detail" itemprop="location" itemscope itemtype=".../Organization">
  <span class="pl">地点:&nbsp;</span>
  <span itemprop="address" itemscope itemtype=".../Address">
    <span itemprop="region">上海&nbsp;</span>
    <span itemprop="locality">长宁区&nbsp;</span>
    <span itemprop="street-address">虹桥路地铁站3口</span>
```

There is no venue field separate from the address. `street-address` sometimes
holds a venue-like name (`SFC上影影城(港汇永华IMAX激光店)`) and sometimes a
meeting point (`虹桥路地铁站3口`); splitting “venue” out of it would be a
guess, so:

* `address` ← `street-address` (verbatim)
* `venueName` ← `null`, and `missingVenue` is expected to equal the event count

### District rule (no guessing)

The listing location title is a space-separated triple, e.g.
`上海 长宁区 虹桥路地铁站3口`. The 2nd token is promoted to `district`
**only** when the project's existing `normalize_district()` recognises it as a
real Shanghai district; otherwise it stays part of the address and
`district` is null. A district is never inferred from the title text, the
venue, or the city.

---

## 5. Sample of a real extracted record

```json
{
  "title": "悠游海盐：走进余华笔下的江南小镇沈荡，打卡许三观卖血记里胜利饭店",
  "startTime": "2026-10-01T08:00:00",
  "endTime": "2026-12-24T19:00:00",
  "city": "上海",
  "district": "长宁",
  "venueName": null,
  "address": "虹桥路地铁站3口",
  "price": "178元(活动费)",
  "organizer": "互助网周末活动",
  "sourceName": "豆瓣同城",
  "sourceUrl": "https://www.douban.com/event/36988401/",
  "sourceEventId": "36988401"
}
```

---

## 6. Access limits encountered

| limit | observed |
|---|---|
| Captcha / 安全验证 | none during the validation sweep; **hit later** — see §7.3 |
| Login wall | none for the listing and detail pages we read (the RSVP buttons on a detail page point at `/register?reason=visit` for anonymous visitors; we never touch them) |
| HTTP 403 / 429 | none during the validation sweep; **403 after sustained crawling** — see §7.3 |
| robots / rate limit policy | **UNKNOWN** — not probed. The crawler relies on `PageFetcher`'s built-in 0.4 s per-host politeness delay and stops on the first 403 / 429 / verification wall. |

The crawler **never** solves a captcha, never logs in, and never works around
an access limit: a wall is recorded as `stopReason=blocked` and the run ends.

---

## 7. PHASE 1 acceptance run (2026-09-22)

Command:

```
python -m pipeline.crawlers.run --source douban --city 上海 --max-pages 10
```

### 7.1 Result

| counter | value |
|---|---|
| pagesFetched | **10** |
| activitiesDiscovered | **100** |
| uniqueActivityUrls | **100** |
| detailsFetched | **100** |
| success | **100** |
| failed | **0** |
| missingDate | 0 |
| missingVenue | **100** (by design — §4) |
| missingAddress | 0 |
| stopReason | `max_pages` |
| failures | none |
| wall clock | 63 s |

100 % of fields came from the activity detail page
(`rawData.fieldSources` = `detail` for all 100 records).

### 7.2 Ten real activities

| title | date | district | address (source `street-address`) | sourceUrl |
|---|---|---|---|---|
| 悠游海盐：走进余华笔下的江南小镇沈荡，打卡许三观卖血记里胜利饭店 | 2026-10-01 | 长宁 | 虹桥路地铁站3口 | https://www.douban.com/event/36988401/ |
| 浦东美术馆指定单日票【乔治·莫兰迪：独白】 | 2026-08-09 | 浦东 | 浦东美术馆-乔治.莫兰迪大展 滨江大道2777号 | https://www.douban.com/event/37611085/ |
| 周末不知道做什么，一起周末约打球吧 | 2026-10-01 | 静安 | 汶水路地铁站 | https://www.douban.com/event/36947253/ |
| 中秋假期抢先看《小猪佩奇·完美假期》超前观影｜奇妙观影团·上海站 | 2026-09-26 | 徐汇 | SFC上影影城(港汇永华IMAX激光店) | https://www.douban.com/event/38067941/ |
| 徒步醉美秋景南黄古道，探访隋朝古刹国清寺（2天1晚活动） | 2026-10-01 | 长宁 | 虹桥路地铁站3口 | https://www.douban.com/event/36737403/ |
| 爬杭州“小富士山”，走甘岭水库 | 2026-10-01 | 浦东 | 龙阳路地铁站 | https://www.douban.com/event/37485604/ |
| 走进指南村，赏华东醉美秋色（上海1天活动） | 2026-10-02 | 长宁 | 虹桥路地铁站3口 | https://www.douban.com/event/36737272/ |
| 天平山赏红枫，打卡木渎古镇 | 2026-10-01 | 浦东 | 龙阳路地铁站 | https://www.douban.com/event/37497883/ |
| 相约长乐林场，一起走甘岭水库，探寻醉美秋色（1天） | 2026-10-04 | 长宁 | 虹桥路地铁站3口 | https://www.douban.com/event/36737390/ |
| Norah/71/油百万领衔 普通话/沪语/英文脱口秀 by SpicyComedy | 2026-09-22 | 黄浦 | SpicyComedy-新天地时尚一期店 兴业路123弄… | https://www.douban.com/event/36977803/ |

District spread over the 100 records:
浦东 28 · 长宁 27 · 黄浦 19 · 静安 9 · 徐汇 7 · 虹口 6 · 普陀 2 · 宝山 1 · 杨浦 1.

### 7.3 The source does rate-limit — observed, and handled

After the acceptance run (~110 page requests in ~1 minute on top of the
validation sweep, all from one IP with one User-Agent), 豆瓣 started
answering **HTTP 403 → `https://sec.douban.com/b?r=...`** for every request,
listing pages included. This is the site's own anti-bot wall.

Re-running the crawler against the blocked source produces, verbatim:

```
stopReason = blocked
pagesFetched = 0
failures = [{"stage": "listing",
             "url": "https://shanghai.douban.com/events/future-all",
             "reason": "blocked", "detail": "HTTP 403"}]
```

It does **not** retry, does **not** swap User-Agents, does **not** solve the
challenge and does **not** parse the wall into activities. It stops and
records. (Covered by unit tests `test_403_stops_immediately`,
`test_429_stops_immediately`, `test_captcha_page_is_not_parsed`.)

Consequence for PHASE 1 planning: one full sweep of a city costs roughly
110 requests and trips the wall shortly afterwards. A production index needs
either a much slower schedule or a source that tolerates bulk crawling.

---

## 8. Known UNKNOWNs

* Whether `events/future-all` covers *all* 豆瓣同城 categories or a subset.
* Whether deep paging is capped by the site beyond what `data-total-page`
  reports (verified 10 pages plus the last page; the middle was not swept).
* Whether `startTime`/`endTime` are local Asia/Shanghai (the datetime has no
  timezone suffix and the site does not state one) — values are stored
  verbatim and never shifted.
* How many of the 153 pages are genuinely single-date events: many rows are
  long-running ticket listings (one row spanned 2026-10-01 → 2026-12-24).
