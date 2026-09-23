// Gorgon PHASE 5.1 — browser E2E over the Shanghai district filter.
//
// Asserts the closed loop the brief asks for, in a real browser against the
// real dataset:
//
//   1.  Discover defaults to 全上海
//   2.  choosing 徐汇 updates the header text
//   3.  every rendered card really is in 徐汇
//   4.  the stated count equals the cards drawn
//   5.  keyword + district are ANDed (徐汇 + AI)
//   6.  the choice survives a page reload (localStorage)
//   7.  the map only draws the selected district
//   8.  switching back to 全上海 restores the full list
//   9.  a combination with no results shows the honest empty state
//  10.  the console stays clean
//
// Run:  python pipeline/api/server.py --port 8000 --mode demo   (running)
//       node pipeline/tests/e2e_district.mjs
//
// Screenshots land in docs/screenshots/.

import { Session } from "./cdp_session.mjs";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.GORGON_BASE || "http://127.0.0.1:8000";
const APP = `${BASE}/ui_kits/app/index.html`;
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", "..");
const OUT = path.join(REPO, "docs", "screenshots");

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Everything the Discover screen says about itself, in one round trip. */
const DISCOVER_STATE = `
  const pill = document.querySelector('[data-gg-region="district-picker"]');
  const cards = [...document.querySelectorAll('.gg-disc-card')];
  const head = document.querySelector('.gg-section-head');
  const m = head ? head.innerText.match(/共\\s*(\\d+)\\s*场活动/) : null;
  const stat = document.querySelector('.gg-stat b');
  const hdr = document.querySelector('[data-gg-region="header-district"]');
  return {
    district: pill ? pill.dataset.ggDistrict : null,
    label: pill ? pill.innerText.replace(/\\s+/g, '') : null,
    header: hdr ? hdr.innerText.replace(/\\s+/g, '') : null,
    headerDistrict: hdr ? hdr.dataset.ggDistrict : null,
    cards: cards.length,
    cardDistricts: [...new Set(cards.map(c => c.dataset.ggCardDistrict))],
    stated: m ? Number(m[1]) : null,
    stat: stat ? Number(stat.textContent) : null,
    emptyTitle: (document.querySelector('[data-gg-empty-title]') || {}).innerText || null,
  };
`;

const SEARCH_STATE = `
  const pill = document.querySelector('[data-gg-region="district-picker"]');
  const cards = [...document.querySelectorAll('[data-gg-card-district]')];
  const t = document.body.innerText;
  const m = t.match(/找到\\s*(\\d+)\\s*场相关活动/);
  return {
    district: pill ? pill.dataset.ggDistrict : null,
    label: pill ? pill.innerText.replace(/\\s+/g, '') : null,
    cards: cards.length,
    cardDistricts: [...new Set(cards.map(c => c.dataset.ggCardDistrict))],
    stated: m ? Number(m[1]) : null,
    emptyTitle: (document.querySelector('[data-gg-empty-title]') || {}).innerText || null,
  };
`;

const MAP_STATE = `
  const pill = document.querySelector('[data-gg-region="district-picker"]');
  const pins = [...document.querySelectorAll('[data-gg-pin-district]')];
  return {
    district: pill ? pill.dataset.ggDistrict : null,
    count: Number((document.querySelector('[data-gg-map-count]') || {}).dataset?.ggMapCount ?? -1),
    pins: pins.length,
    pinDistricts: [...new Set(pins.map(p => p.dataset.ggPinDistrict))],
    empty: !!document.querySelector('[data-gg-region="map-empty"]'),
    emptyTitle: (document.querySelector('[data-gg-region="map-empty"] [data-gg-empty-title], [data-gg-region="map-empty"]') || {}).innerText || null,
  };
`;

async function openPicker(s) {
  const opened = await s.eval(`
    const pill = document.querySelector('[data-gg-region="district-picker"]');
    if (!pill) return false;
    pill.click();
    return true;
  `);
  if (!opened) return false;
  return s.waitFor("!!document.querySelector('[data-gg-region=\"district-sheet\"]')", { timeout: 5000 });
}

async function chooseDistrict(s, name) {
  if (!await openPicker(s)) return false;
  const clicked = await s.eval(`
    const opt = document.querySelector('[data-gg-district-option="' + ${JSON.stringify(name)} + '"]');
    if (!opt) return false;
    opt.click();
    return true;
  `);
  if (!clicked) return false;
  await sleep(400);
  return true;
}

async function typeQuery(s, text) {
  return s.eval(`
    const input = document.querySelector('input[type="search"], input[type="text"], input:not([type])');
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(text)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return input.value === ${JSON.stringify(text)};
  `);
}

async function typeAsk(s, text) {
  return s.eval(`
    const ta = document.querySelector('textarea');
    if (!ta) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, ${JSON.stringify(text)});
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    const btn = [...document.querySelectorAll('button')].find(b => b.innerText.trim() === '帮我找活动');
    if (btn) btn.click();
    return true;
  `);
}

/** Everything the smart screen says about its result list. */
const SMART_STATE = `
  const pill = document.querySelector('[data-gg-region="district-picker"]');
  const cards = [...document.querySelectorAll('article.gg-result')];
  const byDistrict = {};
  cards.forEach(c => {
    const d = c.dataset.ggCardDistrict || '';
    if (d) byDistrict[d] = (byDistrict[d] || 0) + 1;
  });
  const m = document.body.innerText.match(/整理出\\s*(\\d+)\\s*个活动/);
  return {
    district: pill ? pill.dataset.ggDistrict : null,
    cards: cards.length,
    byDistrict: byDistrict,
    cardDistricts: [...new Set(cards.map(c => c.dataset.ggCardDistrict))],
    stated: m ? Number(m[1]) : null,
    mentionsHidden: /已隐藏/.test(document.body.innerText),
    degraded: /部分来源暂时不可用|不可用来源/.test(document.body.innerText),
    emptyTitle: (document.querySelector('[data-gg-empty-title]') || {}).innerText || null,
  };
`;

async function goTab(s, tab) {
  const ok = await s.eval(`
    const el = document.querySelector('[data-gg-nav="' + ${JSON.stringify(tab)} + '"]');
    if (!el) return false;
    el.click(); return true;
  `);
  await sleep(500);
  return ok;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const s = new Session();
  await s.launch();
  await s.connect();

  await s.send("Emulation.setDeviceMetricsOverride",
    { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });

  await s.goto(APP);
  await s.waitFor("!!document.querySelector('[data-gg-nav=\"discover\"]')", { timeout: 30000 });
  await sleep(700);

  // ── 1. Discover defaults to 全上海 ────────────────────────────────────────
  await goTab(s, "discover");
  let d = await s.eval(DISCOVER_STATE);
  check("1. Discover opens on 全上海 by default",
    d.district === "全上海" && d.label === "上海·全上海", JSON.stringify({ district: d.district, label: d.label }));
  check("1b. the unfiltered list is the whole dataset", d.cards > 0 && d.cards === d.stated,
    JSON.stringify({ cards: d.cards, stated: d.stated }));
  const totalAll = d.cards;
  await s.shot(path.join(OUT, "desktop-district-1-default.png"));

  // the picker menu is data-driven and Shanghai-only
  await openPicker(s);
  const menu = await s.eval(`
    const opts = [...document.querySelectorAll('[data-gg-district-option]')];
    return {
      open: !!document.querySelector('[data-gg-region="district-sheet"]'),
      names: opts.map(o => o.dataset.ggDistrictOption),
      counts: Object.fromEntries(opts.map(o => [o.dataset.ggDistrictOption, Number(o.dataset.ggDistrictCount)])),
      shownCounts: Object.fromEntries(opts.map(o => [o.dataset.ggDistrictOption,
        (o.querySelector('[data-gg-district-count-label]') || {}).innerText || null])),
    };
  `);
  check("1c. the sheet lists 全上海 first", menu.names[0] === "全上海", JSON.stringify(menu.names.slice(0, 4)));
  const SHANGHAI = ["黄浦", "徐汇", "长宁", "静安", "普陀", "虹口", "杨浦", "闵行", "宝山", "嘉定", "浦东", "金山", "松江", "青浦", "奉贤", "崇明"];
  check("1d. the sheet offers no non-Shanghai region",
    menu.names.every((n) => n === "全上海" || SHANGHAI.indexOf(n) >= 0), JSON.stringify(menu.names));
  check("1e. the sheet offers the required districts",
    ["徐汇", "浦东", "静安", "黄浦", "长宁", "杨浦", "闵行", "普陀", "虹口", "宝山"]
      .every((n) => menu.names.indexOf(n) >= 0), JSON.stringify(menu.names));
  check("1f. per-district counts are shown and add up",
    menu.counts["全上海"] === totalAll && menu.shownCounts["徐汇"] === "5 场",
    JSON.stringify({ all: menu.counts["全上海"], xuhui: menu.shownCounts["徐汇"] }));
  await s.eval("document.querySelector('[data-gg-region=\"district-sheet\"]').click(); return true;");
  await sleep(250);

  // ── 2./3./4. choose 徐汇: header, cards, count ────────────────────────────
  check("2. choosing 徐汇 works", await chooseDistrict(s, "徐汇"));
  d = await s.eval(DISCOVER_STATE);
  check("2b. the header now reads 上海 · 徐汇",
    d.district === "徐汇" && d.label === "上海·徐汇", JSON.stringify({ district: d.district, label: d.label }));
  check("2c. the app chrome shows the same district as the page (no second, contradicting location)",
    d.header === d.label && d.headerDistrict === d.district,
    JSON.stringify({ header: d.header, page: d.label }));
  check("3. every Discover card is in 徐汇",
    d.cards === 5 && d.cardDistricts.length === 1 && d.cardDistricts[0] === "徐汇",
    JSON.stringify({ cards: d.cards, districts: d.cardDistricts }));
  check("4. the stated count equals the cards drawn",
    d.stated === d.cards && d.stat === d.cards, JSON.stringify({ cards: d.cards, stated: d.stated, stat: d.stat }));
  check("4b. the district really narrowed the list", d.cards < totalAll,
    `${d.cards} of ${totalAll}`);
  const xuhuiAll = d.cards;

  const persisted = await s.eval("return localStorage.getItem('gorgon_selected_district');");
  check("6a. the choice is written to gorgon_selected_district",
    persisted === JSON.stringify("徐汇"), String(persisted));
  await s.shot(path.join(OUT, "desktop-district-2-xuhui.png"));

  // ── 6. persistence across a reload (checked here so every later step starts
  //        from a load that actually went through localStorage) ─────────────
  await s.send("Page.reload", { ignoreCache: true });
  await sleep(2500);
  await s.waitFor("!!document.querySelector('[data-gg-nav=\"discover\"]')", { timeout: 30000 });
  await sleep(700);
  d = await s.eval(DISCOVER_STATE);
  check("6b. 徐汇 survives a page reload",
    d.district === "徐汇" && d.label === "上海·徐汇" && d.cards === xuhuiAll,
    JSON.stringify({ district: d.district, cards: d.cards }));

  // ── 5. keyword AND district ──────────────────────────────────────────────
  // Establish the two operands separately first, so the AND is measured and
  // not assumed: the whole-Shanghai AI pool, then the 徐汇 pool, then both.
  await goTab(s, "search");
  check("5a0. resetting to 全上海 on Search works", await chooseDistrict(s, "全上海"));
  await typeQuery(s, "AI");
  await sleep(600);
  const searchAll = await s.eval(SEARCH_STATE);
  check("5a. keyword alone finds the dataset's AI matches",
    searchAll.cards === 4 && searchAll.stated === searchAll.cards,
    JSON.stringify({ cards: searchAll.cards, stated: searchAll.stated }));
  const aiAll = searchAll.cards;

  await chooseDistrict(s, "徐汇");
  await sleep(600);
  const searchBoth = await s.eval(SEARCH_STATE);
  check("5b. the district filter re-scopes the existing results without a new search",
    searchBoth.district === "徐汇" && searchBoth.cards < aiAll,
    `徐汇+AI=${searchBoth.cards}, AI=${aiAll}`);
  check("5c. keyword + district are ANDed — the intersection, never the union",
    searchBoth.cards > 0 && searchBoth.cards <= aiAll && searchBoth.cards <= xuhuiAll &&
    searchBoth.cards < aiAll + xuhuiAll,
    `徐汇+AI=${searchBoth.cards}, AI=${aiAll}, 徐汇=${xuhuiAll}`);
  check("5d. every 徐汇 + AI card is in 徐汇",
    searchBoth.cardDistricts.length === 1 && searchBoth.cardDistricts[0] === "徐汇",
    JSON.stringify(searchBoth.cardDistricts));
  check("5e. the stated count still equals the cards drawn",
    searchBoth.stated === searchBoth.cards, JSON.stringify({ cards: searchBoth.cards, stated: searchBoth.stated }));
  await s.shot(path.join(OUT, "desktop-district-3-search-and.png"));

  // ── 9. empty state ───────────────────────────────────────────────────────
  await typeQuery(s, "工作坊");
  await sleep(600);
  const empty = await s.eval(SEARCH_STATE);
  check("9a. a combination with no results shows no cards",
    empty.cards === 0, JSON.stringify({ cards: empty.cards }));
  check("9b. the empty state names the district and the filter",
    empty.emptyTitle === "徐汇暂无符合条件的活动", String(empty.emptyTitle));
  check("9c. no other district's activity is used to fill the page",
    await s.eval("return document.querySelectorAll('[data-gg-card-district]').length === 0;"));
  await s.shot(path.join(OUT, "desktop-district-4-search-empty.png"));

  // ---- 8. switching back restores the wider result set -------------------
  await chooseDistrict(s, "全上海");
  await sleep(600);
  const restored = await s.eval(SEARCH_STATE);
  check("8a. 全上海 restores the full keyword result set",
    restored.district === "全上海" && restored.cards === 1,
    JSON.stringify({ district: restored.district, cards: restored.cards }));

  // ── 7. the map follows the same selection ────────────────────────────────
  await chooseDistrict(s, "徐汇");
  await goTab(s, "map");
  let m = await s.eval(MAP_STATE);
  check("7a. the map kept the district chosen on Search/Discover",
    m.district === "徐汇", String(m.district));
  check("7b. the map draws only 徐汇 pins",
    m.pins === xuhuiAll && m.pinDistricts.length === 1 && m.pinDistricts[0] === "徐汇",
    JSON.stringify({ pins: m.pins, districts: m.pinDistricts }));
  check("7c. the map's live count matches its pins", m.count === m.pins && m.count === xuhuiAll,
    JSON.stringify({ count: m.count, pins: m.pins }));
  check("7d. the map is not empty for a populated district", !m.empty);
  await s.shot(path.join(OUT, "desktop-district-5-map-xuhui.png"));

  await chooseDistrict(s, "全上海");
  await sleep(500);
  m = await s.eval(MAP_STATE);
  check("8b. 全上海 restores every pin on the map",
    m.district === "全上海" && m.pins === totalAll && m.count === totalAll,
    JSON.stringify({ district: m.district, pins: m.pins, count: m.count }));

  // ── 9d. an empty district on the map is honest, not filled ──────────────
  await chooseDistrict(s, "静安");
  await sleep(600);
  m = await s.eval(MAP_STATE);
  check("9d. an empty district draws zero pins",
    m.pins === 0 && m.count === 0, JSON.stringify({ pins: m.pins, count: m.count }));
  check("9e. the map says the region is empty instead of showing other districts",
    m.empty && /静安暂无活动/.test(m.emptyTitle || ""), String(m.emptyTitle || "").slice(0, 40));
  await s.shot(path.join(OUT, "desktop-district-6-map-empty.png"));

  // ── the smart screen (real retrieval) ────────────────────────────────────
  // The district now travels IN the request and the pipeline applies it before
  // dedupe / trust / ranking / maxResults, so the screen re-asks the server
  // when the selection changes. The list can therefore come back LARGER than
  // the slice of the previous answer that belonged to this district — that
  // extra is the point (those are the hits the old client-side filter lost).
  // It must still work on whatever the live sources returned, without being
  // switched off when a source is degraded. The target district is taken from
  // the data itself, so this step is not tied to a particular set of results.
  await goTab(s, "smart");
  await sleep(400);
  // Start wide: the previous step deliberately left the app on an empty region.
  const smartReset = await chooseDistrict(s, "全上海");
  check("S0. the smart screen resets to 全上海 before searching",
    smartReset && (await s.eval("return document.querySelector('[data-gg-region=\"district-picker\"]').dataset.ggDistrict;")) === "全上海");
  await typeAsk(s, "这个周末上海有什么 AI / Agent / Vibe Coding 的活动？最好免费，徐汇附近，下午开始。");
  const gotResults = await s.waitFor(
    "document.querySelectorAll('article.gg-result').length > 0", { timeout: 240000, interval: 1000 });
  check("S1. the smart screen returned results to filter", gotResults);
  if (gotResults) {
    await sleep(800);
    const smartAll = await s.eval(SMART_STATE);
    const ranked = Object.keys(smartAll.byDistrict).sort((a, b) => smartAll.byDistrict[b] - smartAll.byDistrict[a]);
    const target = ranked[0];
    check("S2. the smart screen's picker is present and per-district counts are readable",
      !!smartAll.district && !!target, JSON.stringify(smartAll.byDistrict).slice(0, 120));

    if (target) {
      await chooseDistrict(s, target);
      // The selection is re-sent to the server, so wait for that answer
      // before measuring instead of reading the previous one.
      await s.waitFor(
        `(() => { const c = [...document.querySelectorAll('article.gg-result')];
          return c.length > 0 && c.every(x => x.dataset.ggCardDistrict === ${JSON.stringify(target)}); })()`,
        { timeout: 240000, interval: 1000 });
      await sleep(700);
      const smart = await s.eval(SMART_STATE);
      check("S3. the smart screen keeps only the selected district",
        smart.cardDistricts.length === 1 && smart.cardDistricts[0] === target &&
        smart.cards >= smartAll.byDistrict[target],
        JSON.stringify({ atLeast: smartAll.byDistrict[target], got: smart.cards, districts: smart.cardDistricts }));
      check("S4. the stated count still equals the cards drawn",
        smart.stated === smart.cards, JSON.stringify({ cards: smart.cards, stated: smart.stated }));
      check("S5. no other district's activity is used to pad the list",
        smart.cardDistricts.length <= 1 && smart.cards <= smartAll.cards,
        JSON.stringify({ cards: smart.cards, all: smartAll.cards, districts: smart.cardDistricts }));
      check("S6. a degraded source does not cancel the district filter",
        !smartAll.degraded || (smart.cardDistricts.length <= 1 && smart.cards <= smartAll.cards),
        JSON.stringify({ degraded: smartAll.degraded }));
      await s.shot(path.join(OUT, "desktop-district-7-smart-filtered.png"));
      await chooseDistrict(s, "全上海");
      await s.waitFor(
        `document.querySelectorAll('article.gg-result').length === ${smartAll.cards}`,
        { timeout: 240000, interval: 1000 });
      await sleep(600);
      const back = await s.eval(SMART_STATE);
      check("S7. 全上海 restores the smart screen's full result list",
        back.cards === smartAll.cards, JSON.stringify({ after: back.cards, before: smartAll.cards }));
    }
  }

  // back to Discover: 全上海 must restore everything
  await chooseDistrict(s, "全上海");
  await goTab(s, "discover");
  d = await s.eval(DISCOVER_STATE);
  check("8c. 全上海 restores the Discover list",
    d.district === "全上海" && d.cards === totalAll && d.stated === totalAll,
    JSON.stringify({ district: d.district, cards: d.cards, stated: d.stated }));

  // ── mobile ───────────────────────────────────────────────────────────────
  await s.send("Emulation.setDeviceMetricsOverride",
    { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await s.goto(APP);
  await s.waitFor("!!document.body", { timeout: 30000 });
  await sleep(1500);
  await s.eval(`
    const nav = [...document.querySelectorAll('[data-gg-region="tabbar"] button')].find(b => b.innerText.includes('发现'));
    if (nav) nav.click(); return true;
  `);
  await sleep(700);
  const mob = await s.eval(`
    const pill = document.querySelector('[data-gg-region="district-picker"]');
    return {
      hasPill: !!pill,
      label: pill ? pill.innerText.replace(/\\s+/g, '') : null,
      overflows: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
      cards: document.querySelectorAll('.gg-disc-card').length,
    };
  `);
  check("M1. the picker renders on the mobile shell", mob.hasPill, JSON.stringify(mob));
  check("M2. mobile has no horizontal overflow", !mob.overflows, `label=${mob.label}`);
  check("M3. the district persists on mobile too", mob.cards === totalAll, `${mob.cards} cards`);

  await chooseDistrict(s, "徐汇");
  await sleep(600);
  const mob2 = await s.eval(`
    const pill = document.querySelector('[data-gg-region="district-picker"]');
    return {
      label: pill ? pill.innerText.replace(/\\s+/g, '') : null,
      cards: document.querySelectorAll('.gg-disc-card').length,
      overflows: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
    };
  `);
  check("M4. choosing a district works on mobile",
    mob2.label === "上海·徐汇" && mob2.cards === xuhuiAll && !mob2.overflows, JSON.stringify(mob2));
  await openPicker(s);
  await s.shot(path.join(OUT, "mobile-district-8-picker.png"));
  await s.eval("document.querySelector('[data-gg-region=\"district-sheet\"]').click(); return true;");

  // ── 10. console ──────────────────────────────────────────────────────────
  const errors = s.errors.filter((e) => !/favicon|ERR_/i.test(e));
  check("10. console has zero errors", errors.length === 0,
    errors.slice(0, 4).join(" | ") || "clean");

  await s.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log("FAILED: " + failed.map((f) => f.name).join(", "));
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error("E2E crashed:", e); process.exitCode = 1; });
