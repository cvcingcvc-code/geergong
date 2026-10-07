// Gorgon V1 — browser smoke E2E for the new production frontend.
//
// Drives the REAL build (vite preview, dist/) in headless Edge over CDP —
// the same zero-dependency driver the pipeline E2E uses
// (pipeline/tests/cdp_session.mjs). It starts its own servers:
//
//   python pipeline/api/server.py --port 8000 --mode demo   (retrieval API)
//   vite preview --port 4173                                (dist/, proxies /api)
//
// Asserts the Phase-1 acceptance chain: Discover, district filter, Search,
// Natural Search (real POST /api/search through the preview proxy),
// Activity Detail, My Weekend + localStorage persistence across reload,
// Favorites, Map, mobile bottom nav, desktop chrome, and zero console
// errors — at 390 / 768 / 1440 / 1920 widths.
//
// PHASE 2 MIGRATION (§17/§18/§27): the product's default boot screen is now
// the Workbench home. The five legacy capabilities are still fully verified
// by booting every entry into LEGACY MODE via /?legacy=1 — the exact boot
// contract Phase 1 tested. NO test, assertion, or capability was removed;
// only the entry URL changed. Legacy mode renders the same DiscoverScreen
// boot, the same data-gg-nav keys, and the same .gg-disc-card flow.
//
// Run:  node tests/e2e_v1_frontend.mjs        (from app/)
//       GORGON_PYTHON=python3 node tests/e2e_v1_frontend.mjs

import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { Session } from "../../pipeline/tests/cdp_session.mjs";

// The sandbox sits behind an HTTP proxy (HTTP_PROXY/HTTPS_PROXY). Node's
// global fetch — and the Python API server if it ever made outbound calls —
// must NOT route localhost through it, or every 127.0.0.1 request 502s.
// Strip the proxy here and hand the cleaned env to every spawned child.
const CLEAN_ENV = { ...process.env };
for (const k of ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY", "all_proxy"]) {
  delete CLEAN_ENV[k];
}
CLEAN_ENV.NO_PROXY = "127.0.0.1,localhost";
CLEAN_ENV.no_proxy = "127.0.0.1,localhost";

// Also scrub the test process's own env so Node's global fetch (undici)
// never routes localhost through the proxy.
for (const k of ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY", "all_proxy"]) {
  delete process.env[k];
}
process.env.NO_PROXY = "127.0.0.1,localhost";
process.env.no_proxy = "127.0.0.1,localhost";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = path.resolve(APP, "..");
const PYTHON = process.env.GORGON_PYTHON || "python";
const API_PORT = 8000;
const WEB_PORT = 4173;
const BASE = `http://127.0.0.1:${WEB_PORT}`;
const LOG_DIR = path.join(APP, "tests", ".e2e-logs");
fs.mkdirSync(LOG_DIR, { recursive: true });
const OUT = path.join(REPO, "docs", "screenshots");

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── servers ──────────────────────────────────────────────────────────── */

const procs = [];
function start(name, cmd, args, cwd) {
  const log = fs.openSync(path.join(LOG_DIR, `${name}.log`), "w");
  const p = spawn(cmd, args, { cwd, env: CLEAN_ENV, stdio: ["ignore", log, log] });
  procs.push(p);
  return p;
}
async function waitHttp(url, tries = 80) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok || r.status === 404) return true; }
    catch { /* not up yet */ }
    await sleep(250);
  }
  return false;
}

/* ── exact viewport ───────────────────────────────────────────────── */
// --window-size does not guarantee the CSS viewport (scrollbars, window
// chrome, headless quirks all shift it by a few px — and the whole
// tablet/mobile branch decision hangs on a single media query), so pin the
// layout viewport explicitly through CDP. `mobile: false` on purpose: we
// want Edge's normal layout engine with OUR index.html's own viewport
// meta, not Chrome's 980px mobile fallback.
async function setViewport(session, width, height) {
  await session.send("Emulation.setDeviceMetricsOverride", {
    width, height, deviceScaleFactor: 1, mobile: false,
  });
}

/* ── console-error gate ───────────────────────────────────────────────── */
// Only true app errors count. Benign platform noise (favicon, font CDN
// unreachable from a sandboxed network) is reported but not asserted.
function appErrors(session) {
  return session.errors.filter((e) =>
    !/favicon|fonts\.googleapis|fonts\.gstatic|net::ERR_INTERNET_DISCONNECTED/i.test(e));
}

/* ── scenarios ────────────────────────────────────────────────────────── */

async function desktopChain(width, height, tag) {
  const s = new Session({ port: 9333 + (width % 100) });
  await s.launch({ width, height });
  await s.connect();
  await setViewport(s, width, height);
  try {
    await s.goto(BASE + "/?legacy=1");
    const shell = await s.waitFor(`!!document.querySelector('[data-gg-shell]')`);
    check(`${tag}: app boots`, shell);

    // 1. Discover renders with activity cards
    const discover = await s.waitFor(`document.querySelectorAll('.gg-disc-card').length > 0`);
    check(`${tag}: Discover renders cards`, discover);
    const countAll = await s.eval(`
      const m = document.querySelector('.gg-section-head').innerText.match(/共\\s*(\\d+)\\s*场活动/);
      return m ? +m[1] : -1;`);
    check(`${tag}: Discover count > 0`, countAll > 0, `${countAll} 场`);

    // 2-3. district filter updates the count honestly
    await s.click(`document.querySelector('[data-gg-region="district-picker"]')`);
    await s.waitFor(`!!document.querySelector('[data-gg-district-option="徐汇"]')`);
    const expected = await s.eval(`
      return +document.querySelector('[data-gg-district-count-label="徐汇"]').innerText.match(/(\\d+)/)[1];`);
    await s.click(`document.querySelector('[data-gg-district-option="徐汇"]')`);
    await sleep(400);
    const after = await s.eval(`
      const m = document.querySelector('.gg-section-head').innerText.match(/共\\s*(\\d+)\\s*场活动/);
      const cards = document.querySelectorAll('.gg-disc-card').length;
      return { n: m ? +m[1] : -1, cards };`);
    check(`${tag}: district filter narrows to 徐汇`, after.n === expected && after.cards === expected,
      `${countAll} -> ${after.n} (picker said ${expected})`);
    const allInDistrict = await s.eval(`
      return [...document.querySelectorAll('.gg-disc-card')]
        .every(c => c.getAttribute('data-gg-card-district') === '徐汇');`);
    check(`${tag}: every card really is in 徐汇`, allInDistrict);

    // 4-5. Search: keyword narrows the same list
    await s.click(`document.querySelector('[data-gg-nav="search"]')`);
    await s.waitFor(`!!document.querySelector('[data-gg-screen="search"] input')`);
    await s.eval(`
      const input = document.querySelector('[data-gg-screen="search"] input');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'AI');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;`);
    await sleep(400);
    const searchN = await s.eval(`return document.querySelectorAll('[data-gg-screen="search"] .gg-card-grid--two > div').length;`);
    check(`${tag}: keyword search returns results (scoped to 徐汇)`, searchN > 0, `${searchN} 条`);

    // 6-8. Natural Search: real POST /api/search via the preview proxy
    await s.click(`document.querySelector('[data-gg-nav="smart"]')`);
    await s.waitFor(`!!document.querySelector('[data-gg-screen="smart"]')`);
    await s.click(`[...document.querySelectorAll('button')].find(b => b.innerText.includes('试试示例问题'))`);
    const gotResults = await s.waitFor(
      `document.querySelectorAll('[data-gg-screen="smart"] .gg-result').length > 0`,
      { timeout: 60000 });
    check(`${tag}: Natural Search returns result cards`, gotResults);
    const headline = await s.text();
    check(`${tag}: retrieval headline present`,
      headline.includes("找到") && headline.includes("条相关信息"),
      "body contains 找到 N 条相关信息");

    // 9-10. Activity Detail: trust + provenance blocks render.
    // NOTE: the result <article> itself is NOT clickable — the explicit
    // 详情 button opens the overlay (see ResultCard in NaturalSearchScreen).
    await s.click(`[...document.querySelectorAll('[data-gg-screen="smart"] .gg-result button')]
      .find(b => b.innerText.trim() === '详情')`);
    const detailUp = await s.waitFor(`!!document.querySelector('.gg-detail')`);
    check(`${tag}: detail opens`, detailUp);
    const detailText = await s.text();
    check(`${tag}: trust status block`, detailText.includes("可信状态"));
    check(`${tag}: source provenance block`, detailText.includes("信息来源"));
    check(`${tag}: honest transit statement`, detailText.includes("交通时间尚未计算"));

    // 11. add to My Weekend
    await s.click(`[...document.querySelectorAll('.gg-detail-bar-actions button')].find(b => b.innerText.includes('加入我的周末'))`);
    await sleep(400);

    // 12-13. reload -> My Weekend persists (localStorage)
    await s.goto(BASE + "/?legacy=1");
    await s.waitFor(`document.querySelectorAll('.gg-disc-card').length > 0`);
    await s.click(`document.querySelector('[data-gg-nav="weekend"]')`);
    await s.waitFor(`!!document.querySelector('[data-gg-screen="weekend"]')`);
    const weekendText = await s.text();
    check(`${tag}: My Weekend survives reload`, /已加入|时间无直接冲突|时间冲突/.test(weekendText));

    // 14. favorites: seed a REAL dataset id (so it resolves against
    // GORGON_DATA.activities), reload so App reads it, then open the 收藏 tab.
    // The 收藏 tab lives on the weekend screen, but the card ids are only on
    // the Discover/Search/Smart cards — so hop to Discover first to grab one.
    await s.click(`document.querySelector('[data-gg-nav="discover"]')`);
    await s.waitFor(`document.querySelectorAll('.gg-disc-card').length > 0`);
    const favId = await s.eval(`
      const el = document.querySelector('[data-gg-card-id]');
      return el ? el.getAttribute('data-gg-card-id') : null;`);
    await s.eval(`
      localStorage.setItem('gorgon_favorites', JSON.stringify([${JSON.stringify(favId)}]));`);
    await s.goto(BASE + "/?legacy=1");
    await s.waitFor(`document.querySelectorAll('.gg-disc-card').length > 0`);
    await s.click(`document.querySelector('[data-gg-nav="weekend"]')`);
    await s.waitFor(`!!document.querySelector('[data-gg-screen="weekend"]')`);
    await s.click(`[...document.querySelectorAll('[data-gg-screen="weekend"] button')].find(b => b.innerText.trim() === '收藏')`);
    await sleep(400);
    const favText = await s.text();
    check(`${tag}: favorites render`, favText.includes("共收藏"), favId ? `id=${favId}` : "no card id");

    // 15. Map renders without crashing
    await s.click(`document.querySelector('[data-gg-nav="map"]')`);
    await s.waitFor(`!!document.querySelector('[data-gg-screen="map"]')`);
    const mapCount = await s.eval(`
      const el = document.querySelector('[data-gg-map-count]');
      return el ? +el.getAttribute('data-gg-map-count') : -1;`);
    check(`${tag}: Map renders (district-scoped count)`, mapCount >= 0, `${mapCount} pins`);

    // 17. desktop chrome
    const chrome = await s.eval(`
      return !!document.querySelector('[data-gg-region="sidebar"]')
          && !!document.querySelector('[data-gg-region="header"]');`);
    check(`${tag}: desktop sidebar + header`, chrome);

    await s.shot(path.join(OUT, `v1-${tag}.png`));

    // 18. console errors
    const errs = appErrors(s);
    check(`${tag}: console errors = 0`, errs.length === 0, errs.slice(0, 2).join(" | ").slice(0, 200));
  } finally {
    await s.close();
  }
}

async function mobileChain() {
  const s = new Session({ port: 9390 });
  await s.launch({ width: 390, height: 844 });
  await s.connect();
  await setViewport(s, 390, 844);
  try {
    await s.goto(BASE + "/?legacy=1");
    const boot = await s.waitFor(`!!document.querySelector('[data-gg-shell="mobile"]')`);
    check("mobile 390: mobile shell", boot);
    const cards = await s.waitFor(`document.querySelectorAll('.gg-disc-card').length > 0`);
    check("mobile 390: Discover renders", cards);
    // 16. bottom nav works
    const tabbar = await s.waitFor(`!!document.querySelector('[data-gg-region="tabbar"]')`);
    check("mobile 390: bottom tab bar present", tabbar);
    await s.click(`[...document.querySelectorAll('[data-gg-region="tabbar"] button')].find(b => b.innerText.includes('搜索'))`);
    const searchUp = await s.waitFor(`!!document.querySelector('[data-gg-screen="search"]')`);
    check("mobile 390: bottom nav switches screens", searchUp);
    await s.shot(path.join(OUT, "v1-mobile-390.png"));
    const errs = appErrors(s);
    check("mobile 390: console errors = 0", errs.length === 0, errs.slice(0, 2).join(" | ").slice(0, 200));
  } finally {
    await s.close();
  }
}

/* ── main ─────────────────────────────────────────────────────────────── */

console.log("[e2e] starting API server (demo mode) + vite preview ...");
start("api", PYTHON, ["pipeline/api/server.py", "--host", "127.0.0.1", "--port", String(API_PORT), "--mode", "demo"], REPO);
start("web", process.execPath,
  [path.join(APP, "node_modules", "vite", "bin", "vite.js"), "preview",
   "--host", "127.0.0.1", "--port", String(WEB_PORT), "--strictPort"], APP);

try {
  const apiUp = await waitHttp(`http://127.0.0.1:${API_PORT}/api/health`);
  const webUp = await waitHttp(BASE + "/");
  check("servers up (api + preview)", apiUp && webUp);
  if (!apiUp || !webUp) throw new Error("servers did not start");

  // the preview proxy really reaches the API
  const proxied = await fetch(BASE + "/api/health").then((r) => r.json()).catch(() => null);
  check("preview proxies /api -> 127.0.0.1:8000", proxied && proxied.status === "ok",
    proxied ? `providerMode=${proxied.providerMode}` : "no response");

  await desktopChain(1440, 900, "desktop-1440");
  await desktopChain(1920, 1080, "desktop-1920");
  await desktopChain(768, 1024, "tablet-768");
  await mobileChain();
} finally {
  for (const p of procs) { try { p.kill(); } catch { /* gone */ } }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n[e2e] ${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
