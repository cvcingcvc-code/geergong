// Gorgon Workbench — Phase 1 shell E2E.
//
// Drives the REAL production build (vite preview of dist/) in headless
// Edge over CDP, reusing the pipeline CDP driver. Asserts BEHAVIOUR of the
// Workbench shell on top of the untouched legacy app:
//
//   * WorkbenchHome renders (hero / task input / status strip)
//   * creating a task from the home input stores it locally and says so
//   * main navigation switches Workbench surfaces (data-workbench-nav)
//   * 智能搜索 reaches the EXISTING natural-language search (real API)
//   * Tasks: add locally, list shows it, status transitions work
//   * Review Center: demo card visible, approve flips local state
//   * History: events recorded (task creation / approval)
//   * Settings: truthful "Not configured" surfaces, no key inputs
//   * legacy compatibility contract intact (data-gg-nav discover -> cards)
//   * mobile 390: tabbar present, no horizontal overflow, drawer opens
//   * zero app console errors
//
// Selector policy (per spec): data-testid / data-workbench-nav /
// data-gg-nav / aria labels — never visual copy, DOM position, or CSS
// classes for assertions.
//
// Run:  node tests/e2e_workbench_shell.mjs   (from app/)

import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { Session } from "../../pipeline/tests/cdp_session.mjs";

const CLEAN_ENV = { ...process.env };
for (const k of ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY", "all_proxy"]) {
  delete CLEAN_ENV[k];
}
CLEAN_ENV.NO_PROXY = "127.0.0.1,localhost";
CLEAN_ENV.no_proxy = "127.0.0.1,localhost";
for (const k of ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY", "all_proxy"]) {
  delete process.env[k];
}
process.env.NO_PROXY = "127.0.0.1,localhost";
process.env.no_proxy = "127.0.0.1,localhost";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = path.resolve(APP, "..");
const PYTHON = process.env.GORGON_PYTHON || "python";
// The vite preview proxy hardcodes /api -> 127.0.0.1:8000 (vite.config.js),
// so the demo API must listen there. Runs are sequential; the legacy E2E
// also uses 8000 but never overlaps with this one.
const API_PORT = 8000;
const WEB_PORT = 4175;
const BASE = `http://127.0.0.1:${WEB_PORT}`;
const LOG_DIR = path.join(APP, "tests", ".e2e-logs");
fs.mkdirSync(LOG_DIR, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

async function setViewport(session, width, height) {
  await session.send("Emulation.setDeviceMetricsOverride", {
    width, height, deviceScaleFactor: 1, mobile: false,
  });
}

function appErrors(session) {
  return session.errors.filter((e) =>
    !/favicon|fonts\.googleapis|fonts\.gstatic|net::ERR_INTERNET_DISCONNECTED/i.test(e));
}

/** Clear the workbench-local storage so runs are deterministic. */
const RESET_WB = `
  localStorage.removeItem('gorgon_workbench_tasks');
  localStorage.removeItem('gorgon_workbench_review');
  localStorage.removeItem('gorgon_workbench_log');
  return true;`;

const TYPE_IN = (sel, text) => `
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return false;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(el, ${JSON.stringify(text)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;`;

const TYPE_IN_INPUT = (sel, text) => `
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return false;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, ${JSON.stringify(text)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;`;

async function gotoHome(session) {
  await session.goto(BASE + "/");
  await session.waitFor(`!!document.querySelector('[data-gg-shell]')`);
  await session.eval(RESET_WB);
  await session.goto(BASE + "/");
  await session.waitFor(`!!document.querySelector('[data-gg-shell]')`);
}

async function desktopChain() {
  const s = new Session({ port: 9343 });
  await s.launch({ width: 1440, height: 900 });
  await s.connect();
  await setViewport(s, 1440, 900);
  try {
    // ── legacy contract first: boot tab is still discover ──────────
    await s.goto(BASE + "/");
    await s.waitFor(`!!document.querySelector('[data-gg-shell]')`);
    const legacyCards = await s.waitFor(`document.querySelectorAll('.gg-disc-card').length > 0`);
    check("boot tab still renders legacy Discover cards (contract)", legacyCards);
    const navs = await s.eval(`
      return ['discover','search','smart','weekend','map'].every(k =>
        !!document.querySelector('[data-gg-nav="' + k + '"]'));`);
    check("all five legacy data-gg-nav entries exist", navs);

    // ── workbench home ─────────────────────────────────────────────
    await gotoHome(s);
    await s.click(`document.querySelector('[data-workbench-nav="home"]')`);
    const homeUp = await s.waitFor(`!!document.querySelector('[data-gg-screen="workbench-home"]')`);
    check("WorkbenchHome renders via workbench nav", homeUp);
    const hero = await s.waitFor(`!!document.querySelector('[data-testid="workbench-hero"]')`);
    check("hero present", hero);
    const statusOk = await s.eval(`
      const el = document.querySelector('[data-testid="workbench-status-ai"]');
      return !!el && el.innerText.includes('Not connected');`);
    check("status strip truthfully shows AI Engine: Not connected", statusOk);

    // task creation from the home input
    await s.eval(TYPE_IN('[data-gg-screen="workbench-home"] textarea', "帮我寻找本周值得参加的 AI 活动"));
    await s.click(`[...document.querySelectorAll('[data-gg-screen="workbench-home"] button')].find(b => b.innerText.includes('开始任务'))`);
    const notice = await s.waitFor(`!!document.querySelector('[data-testid="workbench-task-notice"]')`);
    check("home input creates a local task and shows an honest notice", notice);
    const inRecent = await s.waitFor(`
      (() => {
        const box = document.querySelector('[data-testid="workbench-recent"]');
        return !!box && box.innerText.includes('帮我寻找本周值得参加的 AI 活动');
      })()`);
    check("recent tasks list shows the created task", inRecent);
    const honestLocal = await s.eval(`
      const box = document.querySelector('[data-testid="workbench-recent"]');
      return !!box && box.innerText.includes('本地任务数据');`);
    check("recent tasks are labelled as local data", honestLocal);

    // ── tasks screen: add + status transition ──────────────────────
    await s.click(`document.querySelector('[data-workbench-nav="tasks"]')`);
    await s.waitFor(`!!document.querySelector('[data-gg-screen="workbench-tasks"]')`);
    await s.eval(TYPE_IN_INPUT('[data-testid="workbench-task-new-input"]', "整理比赛资料"));
    await s.click(`[...document.querySelectorAll('[data-gg-screen="workbench-tasks"] button')].find(b => b.innerText.includes('添加'))`);
    const listed = await s.waitFor(`
      [...document.querySelectorAll('[data-testid="workbench-task-item"]')]
        .some(it => it.innerText.includes('整理比赛资料'))`);
    check("tasks screen lists a locally added task", listed);
    await s.click(`[...document.querySelectorAll('[data-testid="workbench-task-item"]')]
      .find(it => it.innerText.includes('整理比赛资料'))
      .querySelector('[data-testid="workbench-task-next"]')`);
    const statusChanged = await s.waitFor(`
      [...document.querySelectorAll('[data-testid="workbench-task-item"]')]
        .some(it => it.innerText.includes('整理比赛资料') && it.querySelector('[data-testid="workbench-task-status"]').innerText.includes('等待执行'))`);
    check("task status transitions draft -> ready", statusChanged);
    // filter excludes non-matching tasks — poll, React re-renders async
    const filterWorks = await s.waitFor(`
      (() => {
        const btn = document.querySelector('[data-testid="workbench-task-filter-draft"]');
        if (btn && !btn.dataset.wbClicked) { btn.dataset.wbClicked = "1"; btn.click(); }
        const items = [...document.querySelectorAll('[data-testid="workbench-task-item"]')];
        return items.length > 0 && items.every(it => it.innerText.includes('帮我寻找本周值得参加的 AI 活动'));
      })()`);
    check("status filter excludes tasks not matching", filterWorks);
    await s.click(`document.querySelector('[data-testid="workbench-task-filter-all"]')`);

    // ── smart search reaches the REAL natural search ───────────────
    await s.click(`document.querySelector('[data-workbench-nav="search"]')`);
    const smartUp = await s.waitFor(`!!document.querySelector('[data-gg-screen="smart"]')`);
    check("智能搜索 maps onto the existing natural search screen", smartUp);
    await s.click(`[...document.querySelectorAll('button')].find(b => b.innerText.includes('试试示例问题'))`);
    const gotResults = await s.waitFor(
      `document.querySelectorAll('[data-gg-screen="smart"] .gg-result').length > 0`,
      { timeout: 60000 });
    check("natural search still returns real results from workbench nav", gotResults);

    // ── review center ──────────────────────────────────────────────
    await s.click(`document.querySelector('[data-workbench-nav="review"]')`);
    await s.waitFor(`!!document.querySelector('[data-gg-screen="workbench-review"]')`);
    const cardUp = await s.waitFor(`!!document.querySelector('[data-testid="workbench-review-card"]')`);
    check("review center shows a pending demo card", cardUp);
    const marked = await s.eval(`
      const el = document.querySelector('[data-gg-screen="workbench-review"]');
      return !!el && el.innerText.includes('DEMO / PREVIEW');`);
    check("review card is clearly marked DEMO / PREVIEW", marked);
    await s.click(`document.querySelector('[data-testid="workbench-review-approve"]')`);
    const decided = await s.waitFor(`!!document.querySelector('[data-testid="workbench-review-decided"]')`);
    check("approve flips the card to decided (local state)", decided);

    // ── history reflects what happened ─────────────────────────────
    await s.click(`document.querySelector('[data-workbench-nav="history"]')`);
    await s.waitFor(`!!document.querySelector('[data-gg-screen="workbench-history"]')`);
    const hasCreate = await s.waitFor(`
      [...document.querySelectorAll('[data-testid="workbench-history-item"]')]
        .some(it => it.innerText.includes('创建任务'))`);
    check("history records task creation", hasCreate);
    const hasApprove = await s.waitFor(`
      [...document.querySelectorAll('[data-testid="workbench-history-item"]')]
        .some(it => it.innerText.includes('用户批准'))`);
    check("history records the approval", hasApprove);

    // ── settings ───────────────────────────────────────────────────
    await s.click(`document.querySelector('[data-workbench-nav="settings"]')`);
    await s.waitFor(`!!document.querySelector('[data-gg-screen="workbench-settings"]')`);
    const noKeyInput = await s.eval(`
      const screen = document.querySelector('[data-gg-screen="workbench-settings"]');
      if (!screen) return false;
      return screen.querySelectorAll('input[type="password"]').length === 0;`);
    check("settings has NO model key inputs", noKeyInput);
    const notConfigured = await s.eval(`
      const screen = document.querySelector('[data-gg-screen="workbench-settings"]');
      return !!screen && screen.innerText.includes('Not configured');`);
    check("settings truthfully shows AI Provider: Not configured", notConfigured);

    // ── legacy deep paths still work after all the shell work ──────
    await s.click(`document.querySelector('[data-gg-nav="discover"]')`);
    const backToDiscover = await s.waitFor(`document.querySelectorAll('.gg-disc-card').length > 0`);
    check("legacy discover still reachable from workbench sidebar", backToDiscover);

    await s.shot(path.join(REPO, "docs", "screenshots", "workbench-desktop-1440.png"));
    const errs = appErrors(s);
    check("desktop: console errors = 0", errs.length === 0, errs.slice(0, 2).join(" | ").slice(0, 200));
  } finally {
    await s.close();
  }
}

async function mobileChain() {
  const s = new Session({ port: 9391 });
  await s.launch({ width: 390, height: 844 });
  await s.connect();
  await setViewport(s, 390, 844);
  try {
    await gotoHome(s);
    // boot tab is still the legacy discover on mobile
    const boot = await s.waitFor(`!!document.querySelector('[data-gg-shell="mobile"]')`);
    check("mobile 390: shell boots", boot);
    const tabbar = await s.waitFor(`!!document.querySelector('[data-gg-region="tabbar"]')`);
    check("mobile 390: tabbar present", tabbar);
    // 搜索 tab (E2E contract label) still switches to the search screen
    await s.click(`[...document.querySelectorAll('[data-gg-region="tabbar"] button')].find(b => b.innerText.includes('搜索'))`);
    const searchUp = await s.waitFor(`!!document.querySelector('[data-gg-screen="search"]')`);
    check("mobile 390: legacy 搜索 tab still switches screens", searchUp);

    // workbench home via the tabbar
    await s.click(`document.querySelector('[data-gg-region="tabbar"] [data-workbench-nav="home"]')`);
    const homeUp = await s.waitFor(`!!document.querySelector('[data-gg-screen="workbench-home"]')`);
    check("mobile 390: workbench home reachable from tabbar", homeUp);

    // drawer exposes more entries
    await s.click(`[...document.querySelectorAll('[data-gg-region="tabbar"] button')].find(b => b.innerText.includes('更多'))`);
    const drawer = await s.waitFor(`!!document.querySelector('[data-testid="workbench-more-drawer"]')`);
    check("mobile 390: 更多 drawer opens", drawer);
    const mapInDrawer = await s.eval(`
      const d = document.querySelector('[data-testid="workbench-more-drawer"]');
      return !!d && !!d.querySelector('[data-gg-nav="map"]');`);
    check("mobile 390: drawer keeps legacy map reachable", mapInDrawer);
    await s.click(`document.querySelector('[data-testid="workbench-more-drawer"] [data-workbench-nav="review"]')`);
    const reviewUp = await s.waitFor(`!!document.querySelector('[data-gg-screen="workbench-review"]')`);
    check("mobile 390: drawer opens review center", reviewUp);

    // no horizontal overflow on workbench home
    await s.click(`document.querySelector('[data-gg-region="tabbar"] [data-workbench-nav="home"]')`);
    await s.waitFor(`!!document.querySelector('[data-gg-screen="workbench-home"]')`);
    await sleep(300);
    const noOverflow = await s.eval(
      `return document.documentElement.scrollWidth <= window.innerWidth + 1;`);
    check("mobile 390: workbench home has no horizontal overflow", noOverflow);

    await s.shot(path.join(REPO, "docs", "screenshots", "workbench-mobile-390.png"));
    const errs = appErrors(s);
    check("mobile 390: console errors = 0", errs.length === 0, errs.slice(0, 2).join(" | ").slice(0, 200));
  } finally {
    await s.close();
  }
}

/* ── main ─────────────────────────────────────────────────────────────── */

console.log("[wb-e2e] starting API server (demo mode) + vite preview ...");
start("api", PYTHON, ["pipeline/api/server.py", "--host", "127.0.0.1", "--port", String(API_PORT), "--mode", "demo"], REPO);
start("web", process.execPath,
  [path.join(APP, "node_modules", "vite", "bin", "vite.js"), "preview",
   "--host", "127.0.0.1", "--port", String(WEB_PORT), "--strictPort"], APP);

try {
  const apiUp = await waitHttp(`http://127.0.0.1:${API_PORT}/api/health`);
  const webUp = await waitHttp(BASE + "/");
  check("servers up (api + preview)", apiUp && webUp);
  if (!apiUp || !webUp) throw new Error("servers did not start");

  await desktopChain();
  await mobileChain();
} finally {
  for (const p of procs) { try { p.kill(); } catch { /* gone */ } }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n[wb-e2e] ${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
