// Gorgon PHASE 5 — browser E2E over the real retrieval loop.
//
//   Desktop 1920x1080:  智能 -> natural language -> REAL SEARCH -> results
//                       -> images -> detail -> sources -> My Weekend
//   Mobile  390x844:    search + detail still work
//
// Asserts on substance (result count, image pixels, source provenance,
// persistence across reload) rather than on presence of markup, and fails
// loudly on any console error. Screenshots land in docs/screenshots/.
//
// Run:  node pipeline/tests/e2e_phase5.mjs
// Needs: python pipeline/api/server.py --port 8000 --mode real  (running)

import { Session } from "./cdp_session.mjs";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.GORGON_BASE || "http://127.0.0.1:8000";
const APP = `${BASE}/ui_kits/app/index.html`;
// Resolved from this file so the script works from any cwd.
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", "..");
const OUT = path.join(REPO, "docs", "screenshots");
const QUERY = "这个周末上海有什么 AI / Agent / Vibe Coding 的活动？最好免费，徐汇附近，下午开始。";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Force every lazy image to actually fetch, then wait for the dust to settle.
 *
 * Card images are `loading="lazy"`, so an untouched page legitimately reports
 * "1 of 30 loaded" — that measures the test, not the product. Scrolling every
 * scrollable container (the app scrolls inner panes, not the window) makes the
 * count mean something: what is left unloaded is genuinely unloadable.
 */
async function settleImages(s, { timeout = 25000 } = {}) {
  await s.eval(`
    const scrollers = [...document.querySelectorAll('*')]
      .filter(el => el.scrollHeight > el.clientHeight + 40 && el.clientHeight > 100);
    for (const el of scrollers) {
      for (let y = 0; y <= el.scrollHeight; y += Math.max(200, el.clientHeight - 60)) {
        el.scrollTop = y;
        await new Promise(r => setTimeout(r, 120));
      }
      el.scrollTop = 0;
    }
    return true;
  `);
  const start = Date.now();
  let state = null;
  do {
    state = await s.eval(`
      const els = [...document.querySelectorAll('img')];
      return {
        total: els.length,
        pending: els.filter(i => !i.complete).length,
        loaded: els.filter(i => i.complete && i.naturalWidth > 0).length,
        broken: els.filter(i => i.complete && i.naturalWidth === 0).length,
      };
    `);
    if (state.pending === 0) break;
    await sleep(500);
  } while (Date.now() - start < timeout);
  return state;
}

/** Wait for one specific image element (by selector) to finish loading. */
async function waitForImage(s, selector, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const ok = await s.eval(`
      const i = document.querySelector(${JSON.stringify(selector)});
      return !!(i && i.complete && i.naturalWidth > 0);
    `);
    if (ok) return true;
    await sleep(400);
  }
  return false;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const s = new Session();
  await s.launch();
  await s.connect();
  // Cache is already disabled by Session.connect() — see cdp_session.mjs for
  // why a cached bundle would invalidate this entire run.

  const desktop = { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false };
  await s.send("Emulation.setDeviceMetricsOverride", desktop);

  await s.goto(APP);
  await s.waitFor("!!document.querySelector('[data-gg-nav=\"smart\"]')", { timeout: 30000 });
  check("app shell renders with desktop sidebar",
    await s.eval("return !!document.querySelector('.gg-sidebar')"));
  check("no iPhone frame on desktop",
    await s.eval("return !document.querySelector('[data-gg-region=\"phone\"], .gg-phone')"));

  // ---- 智能 page ---------------------------------------------------------
  await s.eval("document.querySelector('[data-gg-nav=\"smart\"]').click(); return true;");
  await s.waitFor("document.body.innerText.includes('智能找活动')");
  await sleep(400);
  await s.shot(path.join(OUT, "desktop-1-smart-search.png"));
  check("smart search hero renders",
    await s.eval("return document.body.innerText.includes('智能找活动')"));
  check("topic chips render",
    await s.eval("return document.querySelectorAll('.gg-chip').length >= 5"),
    await s.eval("return String(document.querySelectorAll('.gg-chip').length)"));

  // ---- the real search ---------------------------------------------------
  const typed = await s.eval(`
    const ta = document.querySelector('textarea');
    if (!ta) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, ${JSON.stringify(QUERY)});
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return ta.value.length > 10;
  `);
  check("natural language query accepted", typed);
  await sleep(300);
  await s.eval(`
    const btn = [...document.querySelectorAll('button')].find(b => b.innerText.trim() === '帮我找活动');
    if (!btn) return false;
    btn.click(); return true;
  `);

  // Real retrieval: provider fetches + up to 14 page fetches. Be patient.
  const gotResults = await s.waitFor(
    "document.querySelectorAll('article.gg-result').length > 0", { timeout: 240000, interval: 1000 });
  check("real search returned results", gotResults,
    `${await s.eval("return document.querySelectorAll('article.gg-result').length")} cards`);

  // Reject silently falling back to fixtures behind the user's back.
  const badge = await s.eval("return (document.body.innerText.match(/REAL SEARCH|DEMO DATA/) || [''])[0]");
  check("provider badge states the data origin", badge === "REAL SEARCH", `badge="${badge}"`);

  const stats = await s.eval(`
    const t = document.body.innerText;
    const m = t.match(/整理出\\s*(\\d+)\\s*个活动/) || t.match(/(\\d+)\\s*个活动/);
    return { cards: document.querySelectorAll('article.gg-result').length, stated: m ? Number(m[1]) : null };
  `);
  check("result count is stated in the summary",
    stats.stated !== null && stats.stated > 0, JSON.stringify(stats));

  // ---- images ------------------------------------------------------------
  const imgs = await settleImages(s);
  const firstCardShot = await s.eval(`
    const i = document.querySelector('article.gg-result img');
    return { src: i ? (i.currentSrc || i.src) : null,
             loaded: !!(i && i.complete && i.naturalWidth > 0),
             natural: i ? i.naturalWidth : 0 };
  `);
  check("every result card renders an image", imgs.total >= stats.cards,
    JSON.stringify(imgs).slice(0, 160));
  check("no broken image in the result list", imgs.broken === 0,
    `${imgs.broken} broken of ${imgs.total}`);
  check("result images really load (not just have a src)",
    firstCardShot.loaded && firstCardShot.natural > 0,
    `${imgs.loaded}/${imgs.total} loaded, first=${firstCardShot.natural}px`);
  check("most result images resolve to real pixels",
    imgs.loaded >= Math.ceil(imgs.total * 0.5),
    `${imgs.loaded}/${imgs.total}`);

  await sleep(400);
  await s.shot(path.join(OUT, "desktop-2-search-results.png"));

  // ---- detail ------------------------------------------------------------
  await s.eval(`
    const card = document.querySelector('article.gg-result');
    const btn = [...card.querySelectorAll('button')].find(b => b.innerText.trim() === '详情');
    btn.click(); return true;
  `);
  await s.waitFor("!!document.querySelector('.gg-detail-overlay')");
  await sleep(900);
  // The hero is the one image that defines the page — wait for pixels, not
  // for a src attribute.
  const heroLoaded = await waitForImage(s, ".gg-detail-main img");

  const detail = await s.eval(`
    const o = document.querySelector('.gg-detail-overlay');
    const t = o.innerText;
    const grid = o.querySelector('.gg-detail-2col');
    const cs = grid ? getComputedStyle(grid) : null;
    const hero = o.querySelector('.gg-detail-main img');
    return {
      // "desktop detail" means a real two-column grid, not a phone sheet
      // stretched to 1920px — so assert on the resolved layout, not on markup.
      layout: cs ? cs.display : null,
      columns: cs ? cs.gridTemplateColumns.split(' ').length : 0,
      hasHero: !!hero,
      heroSrc: hero ? (hero.currentSrc || hero.src) : null,
      heroNatural: hero ? hero.naturalWidth : 0,
      sections: ['时间','地点','票价','主办方'].filter(k => t.includes(k)),
      hasWhy: t.includes('为什么推荐'),
      hasSourceHeading: t.includes('信息来源'),
      hasMapPlaceholder: t.includes('地图能力尚未接入'),
    };
  `);
  check("detail opens as a two-column desktop layout",
    detail.layout === "grid" && detail.columns >= 2, JSON.stringify(detail));
  check("detail renders a hero image", detail.hasHero, String(detail.heroSrc).slice(0, 70));
  check("hero image actually loads", heroLoaded && detail.heroNatural > 0,
    `naturalWidth=${detail.heroNatural}`);
  check("four core facts are shown", detail.sections.length >= 3, detail.sections.join("/"));
  check("为什么推荐 uses real reasons", detail.hasWhy);
  check("artificial map claims are absent",
    !(await s.eval("return document.body.innerText.includes('地铁 11 号线')")));

  // ---- the copy a reader actually sees ----------------------------------
  // Two defects were found by reading this screenshot, so the screenshot is
  // now backed by assertions:
  //   1. the trust card printed the scorer's OWN rule names
  //      ("cross_source_conflict") instead of a sentence;
  //   2. the description was rendered verbatim, so a Meetup body's Markdown
  //      ("**Bringing Dubai AI**") reached the page.
  const copy = await s.eval(String.raw`
    const o = document.querySelector('.gg-detail-overlay');
    const main = o.querySelector('.gg-detail-main');
    const t = main ? main.innerText : '';
    // Only the trust-reason list starts a line with "· " — dates and the
    // "上海 · 徐汇" location are inline, so this cannot pick them up.
    const bullets = (o.innerText.match(/^· .+$/gm) || []).map(s => s.slice(2));
    const RULE_NAMES = [
      'has_source_url','has_registration_url','has_organizer','has_explicit_date',
      'has_explicit_time','has_venue','has_district_or_address',
      'confirmed_by_multiple_sources','source_fields_complete','missing_date',
      'missing_place','missing_source','spammy_title','invalid_time_range',
      'time_conflict','cross_source_conflict','location_conflict',
      'price_conflict','conflicts'
    ];
    return {
      bullets,
      leaked: RULE_NAMES.filter(r => o.innerText.includes(r)),
      boldMarkers: (t.match(/\*\*/g) || []).length,
      linkSyntax: (t.match(/\]\(/g) || []).length,
      escapedNewline: (t.match(/\\n/g) || []).length,
    };
  `);
  check("no raw trust-rule name leaks into the UI",
    copy.leaked.length === 0, copy.leaked.join(","));
  check("trust reasons are explained, in Chinese",
    copy.bullets.length === 0 || copy.bullets.some(b => /[\u4e00-\u9fff]/.test(b)),
    JSON.stringify(copy.bullets).slice(0, 160));
  check("no Markdown syntax leaks into the rendered copy",
    copy.boldMarkers === 0 && copy.linkSyntax === 0 && copy.escapedNewline === 0,
    JSON.stringify({ b: copy.boldMarkers, l: copy.linkSyntax, e: copy.escapedNewline }));

  await s.shot(path.join(OUT, "desktop-3-event-detail.png"));

  // ---- sources / provenance ---------------------------------------------
  const prov = await s.eval(`
    const o = document.querySelector('.gg-detail-overlay');
    const links = [...o.querySelectorAll('a')].filter(a => /^https?:/.test(a.href));
    return { heading: o.innerText.includes('信息来源'), outbound: links.length,
             sample: links.slice(0, 2).map(a => a.href) };
  `);
  check("source provenance is listed with outbound links",
    prov.heading && prov.outbound >= 1, JSON.stringify(prov).slice(0, 180));

  // The registration action must be a real outbound link, or openly absent —
  // never a plausible-looking but invented href.
  const reg = await s.eval(`
    const o = document.querySelector('.gg-detail-overlay');
    const t = o.innerText;
    const link = [...o.querySelectorAll('a')].find(a => a.innerText.includes('打开报名链接'));
    return {
      kind: link ? 'link' : 'absent',
      href: link ? link.href : null,
      saysMissing: t.includes('暂未找到报名链接'),
    };
  `);
  check("registration is a real link or openly absent",
    (reg.kind === "link" && /^https?:\/\//.test(reg.href || "")) || reg.saysMissing,
    JSON.stringify(reg));

  // ---- My Weekend --------------------------------------------------------
  await s.eval(`
    const o = document.querySelector('.gg-detail-overlay');
    const btn = [...o.querySelectorAll('button')].find(b => b.innerText.includes('加入我的周末'));
    if (!btn) return false;
    btn.click(); return true;
  `);
  await sleep(700);
  const synced = await s.eval(`
    const o = document.querySelector('.gg-detail-overlay');
    return o ? o.innerText.includes('已加入我的周末') : false;
  `);
  check("detail action flips to 已加入我的周末", synced);

  await s.eval(`
    const o = document.querySelector('.gg-detail-overlay');
    const back = [...o.querySelectorAll('button')].find(b => /返回|关闭|back/i.test(b.getAttribute('aria-label') || '') || b.innerText.trim() === '←');
    if (back) back.click();
    return true;
  `);
  await sleep(400);
  await s.eval("document.querySelector('[data-gg-nav=\"weekend\"]').click(); return true;");
  await s.waitFor("document.body.innerText.includes('我的周末')");
  await sleep(700);
  const weekend = await s.eval(`
    const t = document.body.innerText;
    return { cards: document.querySelectorAll('.gg-timeline-card').length,
             hasConflictCopy: /时间冲突|时间无直接冲突/.test(t),
             honestTransit: t.includes('交通时间尚未计算') };
  `);
  check("My Weekend lists the saved activity", weekend.cards >= 1, JSON.stringify(weekend));
  check("time-conflict status is shown", weekend.hasConflictCopy);
  check("transit time is not claimed", weekend.honestTransit);
  await s.shot(path.join(OUT, "desktop-4-my-weekend.png"));

  // persistence across a reload
  await s.send("Page.reload", { ignoreCache: true });
  await sleep(2500);
  await s.waitFor("!!document.querySelector('[data-gg-nav=\"weekend\"]')", { timeout: 30000 });
  await s.eval("document.querySelector('[data-gg-nav=\"weekend\"]').click(); return true;");
  await sleep(900);
  const persisted = await s.eval(`
    return { cards: document.querySelectorAll('.gg-timeline-card').length };
  `);
  check("My Weekend survives a page reload", persisted.cards >= 1, JSON.stringify(persisted));

  // ---- mobile ------------------------------------------------------------
  // Resize in place first: the responsive hook listens to matchMedia, so the
  // shell should switch to the phone frame without a reload — and without
  // throwing away the search results we just paid for.
  await s.send("Emulation.setDeviceMetricsOverride",
    { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await sleep(1500);
  let onPhoneShell = await s.eval("return !!document.querySelector('.gg-phone')");
  if (!onPhoneShell) {
    // It did not react, so reload and re-run the search: the mobile
    // assertions still need real data to look at.
    await s.goto(APP);
    await s.waitFor("!!document.body", { timeout: 30000 });
    await sleep(1500);
    await s.eval(`
      const nav = document.querySelector('[data-gg-nav="smart"]')
        || [...document.querySelectorAll('button')].find(b => b.innerText.includes('智能'));
      if (nav) nav.click(); return true;
    `);
    await sleep(800);
    await s.eval(`
      const ta = document.querySelector('textarea');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, ${JSON.stringify(QUERY)});
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      const btn = [...document.querySelectorAll('button')].find(b => b.innerText.trim() === '帮我找活动');
      if (btn) btn.click();
      return true;
    `);
    await s.waitFor("document.querySelectorAll('article.gg-result').length > 0",
      { timeout: 240000, interval: 1000 });
    await sleep(600);
    onPhoneShell = await s.eval("return !!document.querySelector('.gg-phone')");
  }
  check("mobile shell switches to the phone frame", onPhoneShell);

  const mobile = await s.eval(`
    return {
      bottomNav: !!document.querySelector('[data-gg-region="tabbar"]'),
      sidebar: !!document.querySelector('.gg-sidebar'),
      w: document.documentElement.clientWidth,
      overflows: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
    };
  `);
  check("mobile uses bottom navigation, not the desktop sidebar",
    mobile.bottomNav && !mobile.sidebar, JSON.stringify(mobile));
  check("mobile has no horizontal overflow", !mobile.overflows, `w=${mobile.w}`);
  await s.shot(path.join(OUT, "mobile-5-search.png"));

  // Mobile detail must stay single-column. Switching the shell into the phone
  // frame remounts the screen, which drops the search results held in its local
  // state — so fall back to My Weekend, which is also the persisted path we
  // want covered anyway.
  const openedVia = await s.eval(`
    const card = document.querySelector('article.gg-result');
    if (card) {
      const b = [...card.querySelectorAll('button')].find(x => x.innerText.trim() === '详情');
      if (b) { b.click(); return 'search'; }
    }
    const tab = [...document.querySelectorAll('[data-gg-region="tabbar"] button')]
      .find(b => b.innerText.includes('周末'));
    if (tab) { tab.click(); return 'weekend-tab'; }
    return 'none';
  `);
  await sleep(1200);
  if (openedVia === "weekend-tab") {
    await s.eval(`
      const card = document.querySelector('.gg-timeline-card')
        || document.querySelector('.gg-timeline-row');
      if (!card) return false;
      const b = card.querySelector('button');
      (b || card).click();
      return true;
    `);
    await sleep(1500);
  }

  const mdet = await s.eval(`
    const o = document.querySelector('.gg-detail-overlay');
    const grid = o ? o.querySelector('.gg-detail-2col') : null;
    return {
      open: !!o,
      // On mobile the same component must resolve to a single column.
      layout: grid ? getComputedStyle(grid).display : null,
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
    };
  `);
  check("mobile detail opens at all", mdet.open, `via ${openedVia}`);
  check("mobile detail is single-column, not the desktop grid",
    mdet.open && mdet.layout !== "grid", JSON.stringify(mdet));
  check("mobile detail fits the viewport",
    mdet.open && mdet.scrollW <= mdet.clientW + 2, JSON.stringify(mdet));
  await s.shot(path.join(OUT, "mobile-6-detail.png"));

  // ---- console -----------------------------------------------------------
  const errors = s.errors.filter((e) => !/favicon|ERR_/i.test(e));
  check("console has zero errors", errors.length === 0,
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
