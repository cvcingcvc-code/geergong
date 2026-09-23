// Gorgon PHASE 5.2 — browser E2E for district Top-K correctness.
//
// The bug: the district used to be applied in the BROWSER, to a list the
// server had already ranked and cut to the city-wide top N. A 徐汇 activity
// that ranked 21st was cut away before the district was ever considered, and
// the screen then honestly reported "徐汇暂无符合条件的活动".
//
// This run proves, in a real browser against the real HTTP API:
//
//   A. the district really travels IN the request the page sends;
//   B. the server's district-scoped answer contains activities that are NOT
//      inside the city-wide top 20 (the old contract could never return
//      those — it only ever filtered the 20 it had already been given);
//   C. "全上海" still means "no district constraint";
//   D. the rendered cards match the server's district-scoped answer, and are
//      all in that district;
//   E. switching back to 全上海 restores the whole list.
//
// Own server, own Edge profile, demo mode, pinned reference date: no network
// retrieval and no cached bundle can make a pass mean the wrong thing.
//
// Run:  node pipeline/tests/e2e_district_topk.mjs

import { Session } from "./cdp_session.mjs";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const REPO = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  "..", "..");
const OUT = path.join(REPO, "docs", "screenshots");

const PYTHON = process.env.PYTHON_BIN || "python";
const PORT = Number(process.env.GORGON_PORT || 8137);
const BASE = `http://127.0.0.1:${PORT}`;
const APP = `${BASE}/ui_kits/app/index.html`;

// pipeline/search/demo.py::DEMO_TODAY — pins the ranking, and therefore
// pins WHICH 徐汇 activities fall outside the city-wide top 20.
const TODAY = "2026-09-15";
const DEMO_QUERY =
  "这个周末上海有什么 AI / Agent / Vibe Coding 的活动？最好免费，徐汇附近，下午开始。";
const DISTRICT = "徐汇";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};

/** Everything the smart screen says about its result list. */
const SMART_STATE = `
  const pill = document.querySelector('[data-gg-region="district-picker"]');
  const cards = [...document.querySelectorAll('article.gg-result')];
  return {
    district: pill ? pill.dataset.ggDistrict : null,
    cards: cards.length,
    cardDistricts: [...new Set(cards.map(c => c.dataset.ggCardDistrict))],
  };
`;

async function startServer() {
  // A clean environment: an inherited PORT would make the server bind every
  // interface, and an inherited proxy would only confuse the child's own
  // (unused) outbound requests.
  const env = Object.assign({}, process.env);
  for (const key of Object.keys(env)) {
    if (/^(http|https|all)_proxy$/i.test(key)) delete env[key];
  }
  delete env.PORT;
  const proc = spawn(PYTHON,
    ["pipeline/api/server.py", "--port", String(PORT), "--mode", "demo",
     "--today", TODAY],
    { cwd: REPO, stdio: ["ignore", "ignore", "pipe"], env });
  for (let i = 0; i < 160; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return proc;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  try { proc.kill(); } catch { /* best effort */ }
  throw new Error("the API server never became ready on " + BASE);
}

function stopServer(proc) {
  if (!proc || !proc.pid) return;
  try { spawn("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { stdio: "ignore" }); }
  catch { /* best effort */ }
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
  await sleep(500);
  return true;
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

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await startServer();
  const s = new Session();

  // Every POST /api/search body the page sends, captured at the wire.
  const posts = [];
  try {
    await s.launch();
    await s.connect();
    s.ws.addEventListener("message", (ev) => {
      const m = JSON.parse(ev.data);
      if (m.method !== "Network.requestWillBeSent") return;
      const req = m.params.request || {};
      if (req.method === "POST" && /\/api\/search$/.test(req.url || "")) {
        posts.push(req.postData || "");
      }
    });
    await s.send("Emulation.setDeviceMetricsOverride",
      { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });

    await s.goto(APP);
    await s.waitFor("!!document.querySelector('[data-gg-nav=\"smart\"]')", { timeout: 30000 });
    await sleep(1200);

    await s.eval(`
      const el = document.querySelector('[data-gg-nav="smart"]');
      if (el) el.click();
      return true;
    `);
    await sleep(600);

    // ── the search itself ───────────────────────────────────────────────────
    await typeAsk(s, DEMO_QUERY);
    const got = await s.waitFor("document.querySelectorAll('article.gg-result').length > 0",
      { timeout: 90000, interval: 500 });
    check("0. the smart screen returned results to scope", got);
    if (!got) throw new Error("no results — nothing to scope");
    await sleep(700);
    const all = await s.eval(SMART_STATE);
    check("0b. the unscoped list spans more than one district",
      all.cardDistricts.length > 1, JSON.stringify(all.cardDistricts));

    // ── B/C: the HTTP contract, exercised from inside the page ──────────────
    const probe = await s.eval(`
      const post = (body) => fetch('/api/search', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(body)}).then(r => r.json());
      const q = ${JSON.stringify(DEMO_QUERY)};
      const plain = await post({query: q, maxResults: 20});
      const scoped = await post({query: q, district: ${JSON.stringify(DISTRICT)}, maxResults: 20});
      // The same request with a budget the whole corpus fits into: whatever
      // the district really holds. A server that ignores the district cannot
      // make these two agree, because maxResults would then be the only
      // thing shaping the answer.
      const full = await post({query: q, district: ${JSON.stringify(DISTRICT)}, maxResults: 50});
      const wide = await post({query: q, district: '全上海', maxResults: 20});
      // Every 徐汇 activity the corpus holds, asked for WITHOUT the district
      // and with a budget that fits all of it — the ground truth the
      // district-scoped answer has to be measured against.
      const corpus = await post({query: q, maxResults: 50});
      const ids = (r) => (r.results || []).map(x => x.id);
      const inDistrict = (r, d) => (r.results || [])
        .filter(x => ((x.activity || {}).district) === d).map(x => x.id);
      return {
        plainIds: ids(plain),
        plainXuhui: inDistrict(plain, ${JSON.stringify(DISTRICT)}),
        corpusXuhui: inDistrict(corpus, ${JSON.stringify(DISTRICT)}),
        scopedIds: ids(scoped),
        fullIds: ids(full),
        scopedDistricts: [...new Set((scoped.results || [])
          .map(x => (x.activity || {}).district))],
        wideIds: ids(wide),
        requestDistrict: (scoped.request || {}).district,
        requestLocation: (scoped.request || {}).locationPreference,
        echoed: scoped.district,
      };
    `);

    const beyond = probe.scopedIds.filter((id) => probe.plainXuhui.indexOf(id) < 0);
    check("B1. the district-scoped answer contains only that district",
      probe.scopedDistricts.length === 1 && probe.scopedDistricts[0] === DISTRICT,
      JSON.stringify(probe.scopedDistricts));
    // Not merely "some extra ids came back" — they must be THIS district's
    // ids. A server ignoring the district also returns extra ids; they are
    // other districts', and that is exactly what this rules out.
    const beyondAreXuhui = beyond.length > 0 &&
      beyond.every((id) => probe.corpusXuhui.indexOf(id) >= 0);
    check("B2. THE REGRESSION — district hits outside the city-wide top 20 come back",
      beyondAreXuhui,
      `scoped=${probe.scopedIds.length}, inside top-20=${probe.plainXuhui.length}, beyond=${JSON.stringify(beyond)}`);
    check("B3. the scoped answer is strictly larger than what filtering the top 20 could yield",
      probe.scopedIds.length > probe.plainXuhui.length &&
      probe.scopedIds.length >= probe.plainXuhui.length + beyond.length,
      `${probe.scopedIds.length} > ${probe.plainXuhui.length}`);
    check("B4. maxResults does not decide WHICH district activities come back",
      JSON.stringify(probe.scopedIds) === JSON.stringify(probe.fullIds),
      `mr=20 -> ${probe.scopedIds.length}, mr=50 -> ${probe.fullIds.length}`);
    check("C1. 全上海 is not a district filter",
      JSON.stringify(probe.wideIds) === JSON.stringify(probe.plainIds),
      `wide=${probe.wideIds.length}, plain=${probe.plainIds.length}`);
    check("C2. the district reaches the SearchRequest, not just the echo",
      probe.requestDistrict === DISTRICT && probe.requestLocation === DISTRICT &&
      probe.echoed === DISTRICT,
      JSON.stringify({ request: probe.requestDistrict, location: probe.requestLocation }));

    // ── A/D: the page itself ────────────────────────────────────────────────
    const expected = probe.scopedIds.length;
    const switched = await chooseDistrict(s, DISTRICT);
    check("A0. the district picker can be driven on the smart screen", switched);

    let sawPost = false;
    for (let i = 0; i < 120; i++) {
      if (posts.some((b) => b.indexOf(`"district":"${DISTRICT}"`) >= 0)) { sawPost = true; break; }
      await sleep(250);
    }
    check("A1. the page sends the district IN THE REQUEST BODY",
      sawPost, posts.length ? posts[posts.length - 1].slice(0, 120) : "no POST captured");

    const settled = await s.waitFor(
      `document.querySelectorAll('article.gg-result[data-gg-card-district="${DISTRICT}"]').length === ${expected}`,
      { timeout: 60000, interval: 500 });
    const scoped = await s.eval(SMART_STATE);
    check("D1. every rendered card is in the selected district",
      scoped.cardDistricts.length === 1 && scoped.cardDistricts[0] === DISTRICT,
      JSON.stringify(scoped.cardDistricts));
    check("D2. the card count equals the server's district-scoped answer",
      scoped.cards === expected && settled,
      `cards=${scoped.cards}, server=${expected}`);
    check("D3. the district-scoped list is not a subset of the city-wide top 20",
      scoped.cards > probe.plainXuhui.length,
      `${scoped.cards} > ${probe.plainXuhui.length}`);
    await s.shot(path.join(OUT, "desktop-district-topk-xuhui.png"));

    // ── E: switching back ───────────────────────────────────────────────────
    await chooseDistrict(s, "全上海");
    const restored = await s.waitFor(
      `document.querySelectorAll('article.gg-result').length === ${all.cards}`,
      { timeout: 60000, interval: 500 });
    const back = await s.eval(SMART_STATE);
    check("E1. 全上海 restores the whole result list",
      restored && back.cards === all.cards,
      `back=${back.cards}, before=${all.cards}`);
    check("E2. and it spans more than one district again",
      back.cardDistricts.length > 1, JSON.stringify(back.cardDistricts));

    const errors = s.errors.filter((e) => !/favicon|ERR_/i.test(e));
    check("F. the console stays clean", errors.length === 0,
      errors.slice(0, 4).join(" | ") || "clean");
  } finally {
    await s.close();
    stopServer(server);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log("FAILED: " + failed.map((f) => f.name).join(", "));
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error("E2E crashed:", e); process.exitCode = 1; });
