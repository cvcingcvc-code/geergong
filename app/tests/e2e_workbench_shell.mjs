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

/** Clear the workbench-local storage so runs are deterministic (§31:
    the Phase-1 v1 key is ALSO cleared here — test isolation only; the
    product code itself never deletes it). */
const RESET_WB = `
  localStorage.removeItem('gorgon_workbench_tasks_v2');
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

/** Create a task from the home input and wait for its Task Detail to open. */
async function createTaskAndOpen(session, goal) {
  await session.click(`document.querySelector('[data-workbench-nav="home"]')`);
  await session.waitFor(`!!document.querySelector('[data-gg-screen="workbench-home"]')`);
  await session.eval(TYPE_IN('[data-gg-screen="workbench-home"] textarea', goal));
  await session.click(`[...document.querySelectorAll('[data-gg-screen="workbench-home"] button')].find(b => b.innerText.includes('开始任务'))`);
  await session.waitFor(`!!document.querySelector('[data-gg-screen="workbench-task-detail"]')`, { timeout: 8000 });
}

/** Click the real run button and wait for the task to reach 已完成. */
async function runCurrentTask(session, timeout = 30000) {
  await session.click(`document.querySelector('[data-testid="workbench-detail-run"]')`);
  return session.waitFor(
    `document.querySelector('[data-testid="workbench-detail-status"]').innerText.includes('已完成')`,
    { timeout });
}

async function desktopChain() {
  const s = new Session({ port: 9343 });
  await s.launch({ width: 1440, height: 900 });
  await s.connect();
  await setViewport(s, 1440, 900);
  try {
    // ── Phase 2: workbench is the DEFAULT boot screen ──────────────
    await s.goto(BASE + "/");
    await s.waitFor(`!!document.querySelector('[data-gg-shell]')`);
    const bootHome = await s.waitFor(`!!document.querySelector('[data-gg-screen="workbench-home"]')`);
    check("Phase 2: workbench home is the DEFAULT boot screen", bootHome);
    const noFakeCards = await s.eval(`
      return document.querySelectorAll('.gg-disc-card').length === 0;`);
    check("Phase 2: no fake legacy cards on the workbench boot", noFakeCards);

    // legacy contract: /?legacy=1 still boots discover (§17/§18)
    await s.goto(BASE + "/?legacy=1");
    await s.waitFor(`!!document.querySelector('[data-gg-shell]')`);
    const legacyCards = await s.waitFor(`document.querySelectorAll('.gg-disc-card').length > 0`);
    check("legacy=1 boots the real Discover cards (contract)", legacyCards);
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

    // task creation from the home input -> REAL task + detail navigation
    await s.eval(TYPE_IN('[data-gg-screen="workbench-home"] textarea', "帮我寻找本周值得参加的 AI 活动"));
    await s.click(`[...document.querySelectorAll('[data-gg-screen="workbench-home"] button')].find(b => b.innerText.includes('开始任务'))`);
    // Phase 2: creating a task navigates to its Task Detail
    const detailUp = await s.waitFor(`!!document.querySelector('[data-gg-screen="workbench-task-detail"]')`, { timeout: 8000 });
    check("Phase 2: home input creates a REAL task and opens Task Detail", detailUp);
    const honestWait = await s.eval(`
      const el = document.querySelector('[data-gg-screen="workbench-task-detail"]');
      return !!el && el.innerText.includes('等待任务引擎');`);
    check("Phase 2: Task Detail honestly says 等待任务引擎", honestWait);
    const createdEvent = await s.waitFor(`
      !!document.querySelector('[data-testid="workbench-detail-timeline-list"]')`);
    check("Phase 2: timeline section renders", createdEvent);
    const taskCreatedEv = await s.eval(`
      const box = document.querySelector('[data-testid="workbench-detail-timeline-list"]');
      return !!box && box.innerText.includes('创建任务');`);
    check("Phase 2: timeline records task_created", taskCreatedEv);

    // v2 schema persisted in localStorage
    const envOk = await s.eval(`
      const raw = localStorage.getItem('gorgon_workbench_tasks_v2');
      if (!raw) return false;
      const env = JSON.parse(raw);
      return env.schemaVersion === 2 && env.tasks.length === 1
        && env.tasks[0].goal === '帮我寻找本周值得参加的 AI 活动'
        && env.tasks[0].status === 'created';`);
    check("Phase 2: task persisted in gorgon_workbench_tasks_v2 envelope", envOk);

    // back to the tasks list — the created task must be listed
    await s.click(`document.querySelector('[data-testid="workbench-detail-back"]')`);
    await s.waitFor(`!!document.querySelector('[data-gg-screen="workbench-tasks"]')`);
    const listed = await s.waitFor(`
      [...document.querySelectorAll('[data-testid="workbench-task-item"]')]
        .some(it => it.innerText.includes('帮我寻找本周值得参加的 AI 活动'))`);
    check("Phase 2: created task appears in TasksScreen", listed);

    // ── Task Detail: legal transitions drive the REAL state machine ─
    const openFirst = await s.eval(`
      const item = [...document.querySelectorAll('[data-testid="workbench-task-item"]')]
        .find(it => it.innerText.includes('帮我寻找本周值得参加的 AI 活动'));
      if (!item) return false;
      item.querySelector('[data-testid="workbench-task-open"]').click();
      return true;`);
    check("Phase 2: task row opens detail via 详情 button", openFirst);
    await s.waitFor(`!!document.querySelector('[data-gg-screen="workbench-task-detail"]')`);

    // created -> ready (legal shortcut)
    await s.click(`document.querySelector('[data-testid="workbench-detail-sim-ready"]')`);
    const readyOk = await s.waitFor(`
      document.querySelector('[data-testid="workbench-detail-status"]').innerText.includes('等待执行')`);
    check("Phase 2: legal transition created -> ready works", readyOk);

    // created/ready -> completed is ILLEGAL: the button must not exist
    const illegalGone = await s.eval(`
      return !document.querySelector('[data-testid="workbench-detail-sim-completed"]');`);
    check("Phase 2: illegal ready -> completed button is NOT rendered", illegalGone);

    // ready -> running -> completed (legal chain)
    await s.click(`document.querySelector('[data-testid="workbench-detail-sim-running"]')`);
    await s.waitFor(`document.querySelector('[data-testid="workbench-detail-status"]').innerText.includes('执行中')`);
    await s.click(`document.querySelector('[data-testid="workbench-detail-sim-completed"]')`);
    const doneOk = await s.waitFor(`
      document.querySelector('[data-testid="workbench-detail-status"]').innerText.includes('已完成')`);
    check("Phase 2: legal chain ready -> running -> completed works", doneOk);

    // terminal state: no more transition buttons at all
    const terminal = await s.eval(`
      return ['planning','ready','running','review','completed','failed']
        .every(k => !document.querySelector('[data-testid="workbench-detail-sim-' + k + '"]'));`);
    check("Phase 2: terminal task exposes no transition buttons", terminal);

    // timeline recorded the whole chain
    const tl = await s.eval(`
      const box = document.querySelector('[data-testid="workbench-detail-timeline-list"]');
      if (!box) return false;
      const n = (box.innerText.match(/状态变更/g) || []).length;
      return n >= 3;`);
    check("Phase 2: timeline recorded every status_changed", tl);

    // steps + sources + result on the detail page
    await s.eval(TYPE_IN_INPUT('[data-testid="workbench-detail-step-input"]', "收集本周活动列表"));
    await s.click(`[...document.querySelectorAll('button')].find(b => b.innerText.trim() === '添加步骤')`);
    const stepUp = await s.waitFor(`
      [...document.querySelectorAll('[data-testid="workbench-detail-step"]')]
        .some(it => it.innerText.includes('收集本周活动列表'))`);
    check("Phase 2: step can be added from Task Detail", stepUp);

    await s.eval(TYPE_IN_INPUT('[data-testid="workbench-detail-source-input"]', "活动官网"));
    await s.click(`[...document.querySelectorAll('button')].find(b => b.innerText.trim() === '添加来源')`);
    const srcUp = await s.waitFor(`
      [...document.querySelectorAll('[data-testid="workbench-detail-source"]')]
        .some(it => it.innerText.includes('活动官网'))`);
    check("Phase 2: source can be added from Task Detail", srcUp);

    await s.eval(TYPE_IN_INPUT('[data-testid="workbench-detail-result-input"]', "已确认 2 场目标活动"));
    await s.click(`[...document.querySelectorAll('button')].find(b => b.innerText.trim() === '保存结果')`);
    const resUp = await s.waitFor(`
      !!document.querySelector('[data-testid="workbench-detail-result-view"]')`);
    check("Phase 2: result can be saved from Task Detail", resUp);

    // ── refresh persistence: the task survives a full reload ───────
    await s.goto(BASE + "/");
    await s.waitFor(`!!document.querySelector('[data-gg-shell]')`);
    await s.click(`document.querySelector('[data-workbench-nav="tasks"]')`);
    await s.waitFor(`!!document.querySelector('[data-gg-screen="workbench-tasks"]')`);
    const survived = await s.waitFor(`
      [...document.querySelectorAll('[data-testid="workbench-task-item"]')]
        .some(it => it.innerText.includes('帮我寻找本周值得参加的 AI 活动')
          && it.innerText.includes('已完成'))`);
    check("Phase 2: task + status survive a full page reload", survived);

    // ── tasks screen: add + status transition ──────────────────────
    await s.eval(TYPE_IN_INPUT('[data-testid="workbench-task-new-input"]', "整理比赛资料"));
    await s.click(`[...document.querySelectorAll('[data-gg-screen="workbench-tasks"] button')].find(b => b.innerText.includes('添加'))`);
    const listed2 = await s.waitFor(`
      [...document.querySelectorAll('[data-testid="workbench-task-item"]')]
        .some(it => it.innerText.includes('整理比赛资料'))`);
    check("tasks screen lists a locally added task", listed2);
    await s.click(`[...document.querySelectorAll('[data-testid="workbench-task-item"]')]
      .find(it => it.innerText.includes('整理比赛资料'))
      .querySelector('[data-testid="workbench-task-next"]')`);
    const statusChanged = await s.waitFor(`
      [...document.querySelectorAll('[data-testid="workbench-task-item"]')]
        .some(it => it.innerText.includes('整理比赛资料') && it.querySelector('[data-testid="workbench-task-status"]').innerText.includes('等待执行'))`);
    check("task status transitions created -> ready (state machine)", statusChanged);
    // filter excludes non-matching tasks — poll, React re-renders async.
    // At this point the first task is completed and 整理比赛资料 is ready
    // (= 进行中), so the 进行中 filter must show ONLY the latter.
    const filterWorks = await s.waitFor(`
      (() => {
        const btn = document.querySelector('[data-testid="workbench-task-filter-active"]');
        if (btn && !btn.dataset.wbClicked) { btn.dataset.wbClicked = "1"; btn.click(); }
        const items = [...document.querySelectorAll('[data-testid="workbench-task-item"]')];
        return items.length > 0 && items.every(it => it.innerText.includes('整理比赛资料'))
          && items.every(it => !it.innerText.includes('已完成'));
      })()`);
    check("status filter (进行中) excludes tasks not matching", filterWorks);
    // failed filter shows the failed bucket exists as a first-class filter
    const failedFilter = await s.eval(`
      return !!document.querySelector('[data-testid="workbench-task-filter-failed"]')
          && !!document.querySelector('[data-testid="workbench-task-filter-review"]');`);
    check("Phase 2: 待审核/失败 filters exist", failedFilter);
    await s.click(`document.querySelector('[data-testid="workbench-task-filter-all"]')`);

    // ── review center: drive a task into review_required first ─────
    // create a second task and walk it to review_required via detail
    await s.eval(TYPE_IN_INPUT('[data-testid="workbench-task-new-input"]', "需要审核的任务"));
    await s.click(`[...document.querySelectorAll('[data-gg-screen="workbench-tasks"] button')].find(b => b.innerText.includes('添加'))`);
    await s.waitFor(`[...document.querySelectorAll('[data-testid="workbench-task-item"]')]
      .some(it => it.innerText.includes('需要审核的任务'))`);
    await s.click(`[...document.querySelectorAll('[data-testid="workbench-task-item"]')]
      .find(it => it.innerText.includes('需要审核的任务'))
      .querySelector('[data-testid="workbench-task-open"]')`);
    await s.waitFor(`!!document.querySelector('[data-gg-screen="workbench-task-detail"]')`);
    await s.click(`document.querySelector('[data-testid="workbench-detail-sim-ready"]')`);
    await s.click(`document.querySelector('[data-testid="workbench-detail-sim-running"]')`);
    await s.click(`document.querySelector('[data-testid="workbench-detail-sim-review"]')`);
    const reviewStatus = await s.waitFor(`
      document.querySelector('[data-testid="workbench-detail-status"]').innerText.includes('待审核')`);
    check("Phase 2: running -> review_required works", reviewStatus);
    // review_required -> completed is illegal: no button
    const noCompleteInReview = await s.eval(`
      return !document.querySelector('[data-testid="workbench-detail-sim-completed"]');`);
    check("Phase 2: illegal review_required -> completed is blocked", noCompleteInReview);

    await s.click(`document.querySelector('[data-workbench-nav="review"]')`);
    await s.waitFor(`!!document.querySelector('[data-gg-screen="workbench-review"]')`);
    const reviewTaskUp = await s.waitFor(`!!document.querySelector('[data-testid="workbench-review-task"]')`);
    check("Phase 2: review center reads REAL review_required tasks", reviewTaskUp);
    await s.click(`document.querySelector('[data-testid="workbench-review-resume"]')`);
    const resumed = await s.waitFor(`
      !document.querySelector('[data-testid="workbench-review-task"]')`);
    check("Phase 2: 继续任务 transitions review_required -> running", resumed);

    // ── smart search reaches the REAL natural search ───────────────
    await s.click(`document.querySelector('[data-workbench-nav="search"]')`);
    const smartUp = await s.waitFor(`!!document.querySelector('[data-gg-screen="smart"]')`);
    check("智能搜索 maps onto the existing natural search screen", smartUp);
    await s.click(`[...document.querySelectorAll('button')].find(b => b.innerText.includes('试试示例问题'))`);
    const gotResults = await s.waitFor(
      `document.querySelectorAll('[data-gg-screen="smart"] .gg-result').length > 0`,
      { timeout: 60000 });
    check("natural search still returns real results from workbench nav", gotResults);

    // ── review center demo card (Phase-1 behaviour preserved) ──────
    await s.click(`document.querySelector('[data-workbench-nav="review"]')`);
    await s.waitFor(`!!document.querySelector('[data-gg-screen="workbench-review"]')`);
    const cardUp = await s.waitFor(`!!document.querySelector('[data-testid="workbench-review-card"]')`);
    check("review center still shows the pending demo card", cardUp);
    await s.click(`document.querySelector('[data-testid="workbench-review-approve"]')`);
    const decided = await s.waitFor(`!!document.querySelector('[data-testid="workbench-review-decided"]')`);
    check("approve flips the demo card to decided (local state)", decided);

    // ── history reflects REAL task timelines ───────────────────────
    await s.click(`document.querySelector('[data-workbench-nav="history"]')`);
    await s.waitFor(`!!document.querySelector('[data-gg-screen="workbench-history"]')`);
    const recentHeader = await s.waitFor(`!!document.querySelector('[data-testid="workbench-history-recent"]')`);
    check("Phase 2: history shows 最近活动 (aggregated timelines)", recentHeader);
    const hasCreate = await s.waitFor(`
      [...document.querySelectorAll('[data-testid="workbench-history-item"]')]
        .some(it => it.innerText.includes('创建任务'))`);
    check("history records task creation from task timelines", hasCreate);
    const hasStatus = await s.waitFor(`
      [...document.querySelectorAll('[data-testid="workbench-history-item"]')]
        .some(it => it.innerText.includes('状态变更'))`);
    check("Phase 2: history records status_changed events", hasStatus);
    const hasApprove = await s.waitFor(`
      [...document.querySelectorAll('[data-testid="workbench-history-item"], [data-testid="workbench-history-log"] [style]')]
        .some(it => it.innerText.includes('用户批准'))`);
    check("history records the demo approval", hasApprove);

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
    const engineInfo = await s.eval(`
      const screen = document.querySelector('[data-gg-screen="workbench-settings"]');
      return !!screen && screen.innerText.includes('Local / Ready')
        && screen.innerText.includes('2');`);
    check("Phase 2: settings shows Task Engine + schema v2", engineInfo);

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

/* ── Phase 3: deterministic Task Router + Skills (§40/§41/§42) ─────────
   Drives the REAL router + skill runner end-to-end in the browser: the
   run button executes the actual engine (no simulation). Verifies routing,
   step creation, source/demo badges, the workflow_result envelope (§22),
   and execution timeline events (§23). Local-only skills must NOT touch the
   network and must NOT show a DEMO badge. */

async function phase3Chain() {
  const s = new Session({ port: 9351 });
  await s.launch({ width: 1440, height: 900 });
  await s.connect();
  await setViewport(s, 1440, 900);
  try {
    await gotoHome(s);

    // ── §40: REAL search (demo API) — routes deterministically to search ──
    await createTaskAndOpen(s, "帮我寻找本周值得参加的 AI 活动");
    const done40 = await runCurrentTask(s);
    check("§40: routed search task runs to 已完成", done40);

    const router40 = await s.waitFor(`!!document.querySelector('[data-testid="workbench-detail-router"]')`);
    check("§40: router panel renders after run", router40);
    const routerTxt40 = await s.eval(`return document.querySelector('[data-testid="workbench-detail-router"]').innerText;`);
    check("§40: router shows 智能搜索 skill", /智能搜索/.test(routerTxt40 || ""), (routerTxt40 || "").replace(/\n/g, " ").slice(0, 80));
    const step40 = await s.eval(`return [...document.querySelectorAll('[data-testid="workbench-detail-step"]')].some(e=>e.innerText.includes('智能搜索'));`);
    check("§40: 智能搜索 step created + completed", step40);

    // The demo API returns providerMode=demo → the DEMO DATA badge must show.
    const demoBadge = await s.waitFor(`!!document.querySelector('[data-testid="workbench-detail-demo-badge"]')`, { timeout: 6000 }).catch(() => false);
    check("§40: DEMO DATA badge shown for demo search results", demoBadge);

    const tl40 = await s.eval(`return (()=>{const b=document.querySelector('[data-testid="workbench-detail-timeline-list"]');if(!b)return false;const t=b.innerText;return ['开始分析任务目标','确定工具','开始执行','任务执行完成'].every(x=>t.includes(x));})();`);
    check("§40: timeline records routing + skill + completion events (§23)", tl40);

    // ── §41: search + plan workflow → workflow_result envelope (§22) ──
    await createTaskAndOpen(s, "帮我寻找本周 AI 活动并制定参与计划");
    const done41 = await runCurrentTask(s);
    check("§41: search+plan workflow runs to 已完成", done41);
    const step41 = await s.eval(`return [...document.querySelectorAll('[data-testid="workbench-detail-step"]')].filter(e=>e.innerText.includes('智能搜索')||e.innerText.includes('本地规划')).length;`);
    check("§41: both 智能搜索 + 本地规划 steps created", step41 >= 2, "steps=" + step41);
    const wf = await s.eval(`return [...document.querySelectorAll('[data-testid="workbench-detail-result-view"]')].some(e=>e.innerText.includes('workflow_result'));`);
    check("§41: multi-skill result wrapped in workflow_result envelope (§22)", wf);
    const tl41 = await s.eval(`return (()=>{const b=document.querySelector('[data-testid="workbench-detail-timeline-list"]');if(!b)return false;const t=b.innerText;return (t.match(/开始执行：/g)||[]).length>=2;})();`);
    check("§41: timeline records 2 skill_started events", tl41);

    // ── §42: local-only extract — no network, no DEMO badge ──
    await createTaskAndOpen(s, "从这段文字中提取待办事项和日期：截止 10 月 15 日提交材料，下周一与团队开会复盘");
    const done42 = await runCurrentTask(s);
    check("§42: local extract task runs to 已完成 (no network)", done42);
    await s.waitFor(`!!document.querySelector('[data-testid="workbench-detail-router"]')`);
    const router42 = await s.eval(`return document.querySelector('[data-testid="workbench-detail-router"]').innerText;`);
    check("§42: router shows 本地提取 (extract)", /本地提取/.test(router42 || ""), (router42 || "").replace(/\n/g, " ").slice(0, 80));
    const noDemo42 = await s.eval(`return document.querySelectorAll('[data-testid="workbench-detail-demo-badge"]').length === 0;`);
    check("§42: NO demo badge for local skill", noDemo42);
    const resTxt42 = await s.eval(`return document.querySelector('[data-testid="workbench-detail-result-view"]').innerText;`);
    check("§42: extract result contains structured date 10月15日", /10月15日/.test(resTxt42 || ""), (resTxt42 || "").slice(0, 120));

    const errs = appErrors(s);
    check("phase3: console errors = 0", errs.length === 0, errs.slice(0, 2).join(" | ").slice(0, 200));
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
  await phase3Chain();
} finally {
  for (const p of procs) { try { p.kill(); } catch { /* gone */ } }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n[wb-e2e] ${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
