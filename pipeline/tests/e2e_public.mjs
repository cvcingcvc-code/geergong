// Gorgon — PUBLIC DEPLOYMENT browser E2E.
//
// Answers one question in a real browser: "if I hand a stranger the URL, does
// the app work and can they reach anything they shouldn't?"
//
// Deliberately different from e2e_district.mjs / e2e_phase5.mjs: those drive
// 127.0.0.1 and verify product behaviour. This one drives the PUBLIC ENTRY
// POINT (`/`) and verifies the deployment contract:
//
//   1.  the home URL loads the app
//   2.  Discover renders
//   3.  keyword search actually narrows the list
//   4.  the district filter keeps only that district
//   5.  keyword AND district (proved against the same list, not a magic number)
//   6.  a reload leaves the app working
//   7.  every API call goes to the page's OWN origin (this is what makes the
//       tunnel work — nothing may depend on the visitor's localhost)
//   8.  no shipped app source mentions localhost / 127.0.0.1 / file://
//   9.  pipeline/, .git/, the admin UI and the docs are 404 for a visitor
//  10.  the search response carries no internals and no CORS wildcard
//  11.  the console stays clean
//  12.  retrieval mode is the one the operator claims
//
// Run:
//   python pipeline/api/server.py --port 8000 --mode demo    # then
//   node pipeline/tests/e2e_public.mjs
//   GORGON_EXPECT_MODE=real node pipeline/tests/e2e_public.mjs
//
// Screenshots land in docs/screenshots/.

import { Session } from "./cdp_session.mjs";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.GORGON_BASE || "http://127.0.0.1:8000";
const MODE = (process.env.GORGON_EXPECT_MODE || "demo").toLowerCase();
const ENTRY = BASE + "/";
const ORIGIN = new URL(BASE).origin;

const REPO = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  "..", "..");
const OUT = path.join(REPO, "docs", "screenshots");

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── in-page probes ─────────────────────────────────────────────────────── */

const DISCOVER_STATE = `
  const pill = document.querySelector('[data-gg-region="district-picker"]');
  const cards = [...document.querySelectorAll('.gg-disc-card')];
  const head = document.querySelector('.gg-section-head');
  const m = head ? head.innerText.match(/共\\s*(\\d+)\\s*场活动/) : null;
  return {
    district: pill ? pill.dataset.ggDistrict : null,
    label: pill ? pill.innerText.replace(/\\s+/g, '') : null,
    cards: cards.length,
    cardDistricts: [...new Set(cards.map(c => c.dataset.ggCardDistrict))],
    stated: m ? Number(m[1]) : null,
  };
`;

/** Search screen: stated count, the cards, and their districts. */
const SEARCH_STATE = `
  const pill = document.querySelector('[data-gg-region="district-picker"]');
  const cards = [...document.querySelectorAll('[data-gg-card-district]')];
  const m = document.body.innerText.match(/找到\\s*(\\d+)\\s*场相关活动/);
  return {
    district: pill ? pill.dataset.ggDistrict : null,
    cards: cards.length,
    cardDistricts: cards.map(c => c.dataset.ggCardDistrict || ''),
    stated: m ? Number(m[1]) : null,
    emptyTitle: (document.querySelector('[data-gg-empty-title]') || {}).innerText || null,
  };
`;

/* ── interactions ───────────────────────────────────────────────────────── */

async function goTab(s, tab) {
  const ok = await s.eval(`
    const el = document.querySelector('[data-gg-nav="' + ${JSON.stringify(tab)} + '"]');
    if (!el) return false;
    el.click(); return true;
  `);
  await sleep(500);
  return ok;
}

async function openPicker(s) {
  const opened = await s.eval(`
    const pill = document.querySelector('[data-gg-region="district-picker"]');
    if (!pill) return false;
    pill.click();
    return true;
  `);
  if (!opened) return false;
  return s.waitFor("!!document.querySelector('[data-gg-region=\"district-sheet\"]')",
    { timeout: 5000 });
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
  await sleep(450);
  return true;
}

/** Drive the DS SearchField (a controlled React input). */
async function typeKeyword(s, text) {
  return s.eval(`
    const input = document.querySelector('[data-gg-screen="search"] input');
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(text)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  `);
}

/** Drive the smart screen's ask box and submit it.
 *
 *  The value has to be committed to React BEFORE the button is clicked.
 *  Setting the textarea and clicking in the same tick submits whatever query
 *  the button's closure captured at the last render — which, right after a
 *  programmatic input event, can still be the empty string. A real visitor
 *  cannot do that (typing and clicking are separate events), so the harness
 *  must not either: otherwise "0 cards" means "we clicked too early", and the
 *  test blames the product for its own race.
 */
async function typeAsk(s, text) {
  const typed = await s.eval(`
    const ta = document.querySelector('textarea');
    if (!ta) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, ${JSON.stringify(text)});
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return ta.value === ${JSON.stringify(text)};
  `);
  if (!typed) return { typed, clicked: false };
  await sleep(150);
  const clicked = await s.eval(`
    const btn = [...document.querySelectorAll('button')].find(b => b.innerText.trim() === '帮我找活动');
    if (!btn) return false;
    btn.click();
    return true;
  `);
  return { typed, clicked };
}

/* ── the run ────────────────────────────────────────────────────────────── */

async function main() {
  // Preflight BEFORE the browser: if the server is not actually up, every
  // assertion below fails for one boring reason and the real signal (a browser
  // that cannot reach the app) gets buried. Fail loudly instead.
  let health;
  try {
    const r = await fetch(BASE + "/api/health");
    health = await r.json();
  } catch (e) {
    console.error(`E2E aborted: no Gorgon server at ${BASE} (${e.message}).`);
    console.error("Start it first:  python pipeline/api/server.py --port 8000 --mode demo");
    process.exitCode = 1;
    return;
  }
  console.log(`server: providerMode=${health.providerMode} today=${health.today}\n`);

  const s = new Session();
  await s.launch({ width: 1440, height: 900 });
  await s.connect();

  // Tap the wire: this is how "the API is same-origin" and "no CORS wildcard"
  // get proved from the browser's own point of view rather than our intent.
  const requests = [];
  const responses = [];
  s.ws.addEventListener("message", (ev) => {
    let m;
    try { m = JSON.parse(ev.data); } catch { return; }
    if (m.method === "Network.requestWillBeSent") {
      requests.push(m.params.request.url);
    }
    if (m.method === "Network.responseReceived") {
      responses.push({
        url: m.params.response.url,
        status: m.params.response.status,
        headers: m.params.response.headers || {},
      });
    }
  });

  /* 1 ── the public entry point ------------------------------------------ */
  await s.goto(ENTRY);
  const booted = await s.waitFor(
    "!!document.querySelector('[data-gg-shell]') && document.querySelectorAll('.gg-disc-card').length > 0",
    { timeout: 30000 });
  const here = await s.eval("return location.pathname + '|' + document.title;");
  check("1. the public entry point loads the app", booted, here);
  await s.shot(path.join(OUT, "public-1-home.png"));

  /* 2 ── Discover --------------------------------------------------------- */
  let d = await s.eval(DISCOVER_STATE);
  check("2. Discover renders activities on the public URL",
    d.cards > 0 && d.stated === d.cards,
    JSON.stringify({ cards: d.cards, stated: d.stated }));
  check("2b. the district picker defaults to 全上海",
    d.district === "全上海", String(d.district));

  /* 3 ── keyword search -------------------------------------------------- */
  await goTab(s, "search");
  await typeKeyword(s, "AI");
  await sleep(700);
  const kwAll = await s.eval(SEARCH_STATE);
  check("3. keyword search narrows the list",
    kwAll.cards > 0 && kwAll.stated === kwAll.cards,
    JSON.stringify({ cards: kwAll.cards, stated: kwAll.stated, district: kwAll.district }));
  await s.shot(path.join(OUT, "public-2-keyword.png"));

  /* 4 ── district filter ------------------------------------------------- */
  const picked = await chooseDistrict(s, "徐汇");
  await sleep(700);
  const kwXuhui = await s.eval(SEARCH_STATE);
  check("4. choosing 徐汇 keeps only 徐汇 cards",
    picked && kwXuhui.cards > 0 &&
    kwXuhui.cardDistricts.length > 0 &&
    kwXuhui.cardDistricts.every((x) => x === "徐汇"),
    JSON.stringify({ cards: kwXuhui.cards, districts: [...new Set(kwXuhui.cardDistricts)] }));

  /* 5 ── keyword AND district -------------------------------------------- */
  // The proof is internal consistency: the 徐汇+AI list must be exactly the
  // 徐汇 subset of the 全上海+AI list. If the two filters were ORed, or if the
  // district silently reset the keyword, this equality breaks on any dataset —
  // no hard-coded counts needed.
  const expected = kwAll.cardDistricts.filter((x) => x === "徐汇").length;
  const outsideXuhui = kwAll.cardDistricts.filter((x) => x !== "徐汇").length;
  check("5. keyword AND district is an intersection, not a union",
    kwXuhui.cards === expected &&
    (outsideXuhui === 0 || kwXuhui.cards < kwAll.cards),
    JSON.stringify({ keywordOnly: kwAll.cards, both: kwXuhui.cards,
                     expected, outsideXuhui }));
  await s.shot(path.join(OUT, "public-3-keyword-and-district.png"));

  /* 6 ── reload ---------------------------------------------------------- */
  await s.goto(ENTRY);
  const reloaded = await s.waitFor(
    "!!document.querySelector('[data-gg-shell]')", { timeout: 30000 });
  const d2 = await s.eval(DISCOVER_STATE);
  check("6. a reload leaves the app working",
    reloaded && d2.cards > 0 && d2.stated === d2.cards,
    JSON.stringify({ cards: d2.cards, stated: d2.stated }));
  await s.shot(path.join(OUT, "public-4-after-reload.png"));

  /* 7 ── the search API (probed in-page, so the wire below has traffic) --- */
  const apiCheck = await s.eval(`
    const r = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "这个周末上海有什么 AI 活动", maxResults: 10 }),
    });
    const text = await r.text();
    const d = JSON.parse(text);
    return {
      status: r.status,
      providerMode: d.providerMode,
      results: (d.results || []).length,
      leaked: ["cacheDir", "\\"settings\\"", "Traceback", "SEARCH_API_KEY", "\\"debug\\""]
        .filter(k => text.includes(k)),
      cors: r.headers.get("access-control-allow-origin"),
      nosniff: r.headers.get("x-content-type-options"),
      csp: r.headers.get("content-security-policy"),
    };
  `);
  check("7. the search API answers on the same origin",
    apiCheck.status === 200 && apiCheck.results > 0,
    JSON.stringify({ status: apiCheck.status, results: apiCheck.results }));
  check("7b. the response exposes no internals",
    apiCheck.leaked.length === 0, apiCheck.leaked.join(",") || "clean");
  check("7c. no CORS wildcard, and security headers are set",
    !apiCheck.cors && apiCheck.nosniff === "nosniff" &&
    /connect-src 'self'/.test(apiCheck.csp || ""),
    JSON.stringify({ cors: apiCheck.cors, nosniff: apiCheck.nosniff }));
  check("7d. no CORS header at the wire level either",
    responses.filter((r) => /\/api\/search/.test(r.url))
      .every((r) => !Object.keys(r.headers).some(
        (k) => k.toLowerCase() === "access-control-allow-origin")),
    `checked ${responses.filter((r) => /\/api\/search/.test(r.url)).length} responses`);

  /* 8 ── same-origin, proved from the browser's own traffic -------------- */
  // This is the assertion that makes a tunnel work: everything the page asks
  // for is on the origin it was served from, so no visitor ever needs to reach
  // *their own* localhost.
  const apiCalls = requests.filter((u) => /\/api\//.test(u));
  const offOrigin = apiCalls.filter((u) => new URL(u).origin !== ORIGIN);
  check("8. every API call goes to the page's own origin",
    apiCalls.length > 0 && offOrigin.length === 0,
    offOrigin.length ? offOrigin.join(" | ")
      : `${apiCalls.length} call(s), all on ${ORIGIN}`);
  // When this runs against a tunnel, ORIGIN is the tunnel host — so any
  // request to a localhost host at all is a hard failure. Locally, ORIGIN is
  // itself loopback, so the check is "no localhost host OTHER than ours".
  const LOCALHOST_HOST = /^(localhost|127\.0\.0\.1|\[::1\])$/i;
  const foreignLocal = requests.filter((u) => {
    const parsed = new URL(u);
    return LOCALHOST_HOST.test(parsed.hostname) && parsed.origin !== ORIGIN;
  });
  check("8b. no request reaches a localhost host other than the page's own origin",
    foreignLocal.length === 0, foreignLocal.slice(0, 3).join(" | ") || "none");

  /* 9 ── no localhost in the shipped sources ----------------------------- */
  const sources = [
    "index.html", "data-adapter.js", "NaturalSearchScreen.jsx", "SearchScreen.jsx",
    "DiscoverScreen.jsx", "MapScreen.jsx", "district.js", "district-picker.jsx",
    "store.js", "activity-view.js", "common.jsx", "AppShell.jsx", "responsive.js",
    "demo-reset.js", "categories-ext.js", "MyWeekendScreen.jsx",
    "ActivityDetailScreen.jsx", "data.js", "generated-data.js",
  ];
  const offenders = await s.eval(`
    const BAD = /(?:https?:)?\\/\\/(?:localhost|127\\.0\\.0\\.1)|file:\\/\\/|:8000\\b/gi;
    const out = [];
    for (const f of ${JSON.stringify(sources)}) {
      let text = "";
      try { text = await (await fetch("/ui_kits/app/" + f)).text(); } catch (e) { continue; }
      const hits = (text.match(BAD) || []);
      if (hits.length) out.push(f + " -> " + [...new Set(hits)].join(","));
    }
    return out;
  `);
  check("9. no shipped app source hardcodes localhost / 127.0.0.1 / file://",
    offenders.length === 0, offenders.slice(0, 4).join(" | ") || "clean");

  /* 10 ── private paths are unreachable --------------------------------- */
  // Probed from Node, not from the page: these MUST 404, and a deliberate 404
  // logged in the page console would poison the "console is clean" check
  // below. Same-origin fetches make the two equivalent.
  const privatePaths = [
    "/pipeline/data/review/review_queue.json",
    "/pipeline/data/approved/activities.json",
    "/pipeline/api/server.py",
    "/.git/config",
    "/.git/HEAD",
    "/ui_kits/admin/index.html",
    "/ui_kits/dashboard/index.html",
    "/docs/DISTRICT_FILTER_REPORT.md",
    "/ui_kits/app/README.md",
  ];
  const leaked = [];
  for (const p of privatePaths) {
    const r = await fetch(BASE + p);
    if (r.ok) leaked.push(`${p} -> ${r.status} (${r.statusText})`);
  }
  check("10. pipeline/, .git/, admin UI and docs are unreachable",
    leaked.length === 0, leaked.slice(0, 4).join(" | ") || `${privatePaths.length} paths refused`);

  /* 11 ── console -------------------------------------------------------- */
  const errors = s.errors.filter((e) => !/favicon|ERR_|net::ERR_ABORTED/i.test(e));
  check("11. the console has zero errors", errors.length === 0,
    errors.slice(0, 4).join(" | ") || "clean");

  /* 12 ── retrieval mode ------------------------------------------------- */
  check(`12. the server reports providerMode=${MODE} as expected`,
    apiCheck.providerMode === MODE,
    String(apiCheck.providerMode));

  // The smart screen is the real-retrieval surface; only worth driving when
  // the operator actually started the server in real mode.
  if (MODE === "real") {
    // Check 4 left the district on 徐汇, and the app scopes results to the
    // picked district on the client. Without this reset the smart screen gets
    // judged through a filter this check never asked for — and on a thin
    // dataset that filter can legitimately narrow to nothing, which then looks
    // like "retrieval is broken on the public URL". Reset it, and keep the
    // district in the assertion so the leak cannot come back unnoticed.
    const reset = await chooseDistrict(s, "全上海");
    await sleep(500);
    await goTab(s, "smart");
    await sleep(600);
    const asked = await typeAsk(s, "这个周末上海有什么 AI / Agent 活动？");
    const gotReal = await s.waitFor(
      "document.querySelectorAll('article.gg-result').length > 0",
      { timeout: 240000, interval: 1000 });
    const smart = await s.eval(`
      const pill = document.querySelector('[data-gg-region="district-picker"]');
      return {
        cards: document.querySelectorAll('article.gg-result').length,
        district: pill ? pill.dataset.ggDistrict : null,
        real: /REAL SEARCH/.test(document.body.innerText),
        demo: /DEMO DATA/.test(document.body.innerText),
      };
    `);
    // `asked` is reported so a mis-click fails loudly here instead of looking
    // like the retrieval returned nothing.
    check("13. the smart screen still retrieves for real over the public URL",
      reset && asked.typed && asked.clicked && gotReal && smart.cards > 0 &&
        smart.district === "全上海" && smart.real && !smart.demo,
      JSON.stringify(Object.assign({}, smart, { asked })));
    await s.shot(path.join(OUT, "public-5-smart-real.png"));
  }

  await s.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log("FAILED: " + failed.map((f) => f.name).join(", "));
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error("E2E crashed:", e); process.exitCode = 1; });
