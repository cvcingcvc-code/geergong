// Gorgon V1 — the root component.
//
// Ported from the inline <script type="text/babel"> bootstrap in
// ui_kits/app/index.html. State ownership is UNCHANGED: the synced set,
// active tab, detail overlay, map focus, district selection and the toast
// all live here and are shared by both chromes (phone frame / app shell).
//
// PHASE 2 (TASK_ENGINE_FOUNDATION): the Workbench is now the DEFAULT boot
// screen (desktop + mobile). The legacy contract is preserved through an
// explicit legacy entry: loading /?legacy=1 boots into the legacy
// "discover" tab exactly as Phase 1 did, so e2e_v1_frontend.mjs keeps
// verifying the five legacy capabilities (discover/search/smart/weekend/
// map) with zero coverage loss. data-gg-nav keys, .gg-disc-card and the
// mobile 搜索 tab label are untouched.
//
// Task state now flows through the formal Task Engine: workbench-store.js
// (facade) -> task-repository.js (persistence) -> task-model.js (pure
// state machine). Screens never write localStorage directly.

import React from "react";
import { StatusBar, PhoneFrame, DesktopHeader } from "./components/AppShell.jsx";
import { DiscoverScreen } from "./screens/DiscoverScreen.jsx";
import { ActivityDetailScreen } from "./screens/ActivityDetailScreen.jsx";
import { SearchScreen } from "./screens/SearchScreen.jsx";
import { NaturalSearchScreen } from "./screens/NaturalSearchScreen.jsx";
import { MyWeekendScreen } from "./screens/MyWeekendScreen.jsx";
import { MapScreen } from "./screens/MapScreen.jsx";
import { WorkbenchHome } from "./screens/WorkbenchHome.jsx";
import { TasksScreen } from "./screens/TasksScreen.jsx";
import { TaskDetailScreen } from "./screens/TaskDetailScreen.jsx";
import { ReviewCenterScreen } from "./screens/ReviewCenterScreen.jsx";
import { HistoryScreen } from "./screens/HistoryScreen.jsx";
import { SettingsScreen } from "./screens/SettingsScreen.jsx";
import { useResponsive } from "./lib/useResponsive.js";
import * as Store from "./store/store.js";
import * as WBStore from "./store/workbench-store.js";
import * as ActivityView from "./lib/activity-view.js";
import { GORGON_DATA } from "./lib/data.js";
import { Icon } from "./components/Icon.jsx";
import {
  WORKBENCH_TABS, WORKBENCH_SETTINGS, LEGACY_TABS, LEGACY_SIDEBAR_KEYS,
  WORKBENCH_TO_LEGACY, MOBILE_TABS, MOBILE_MORE_TABS,
} from "./workbench/navigation.js";

/* ── legacy-mode detection (§17/§18) ────────────────────────────────── */
// /?legacy=1 boots into the Phase-1 default (discover). Anything else
// boots into the Workbench home. The flag is read ONCE at startup.
function isLegacyBoot() {
  try {
    const p = new URLSearchParams(window.location.search);
    return p.get("legacy") === "1";
  } catch (e) {
    return false;
  }
}
const LEGACY_MODE = typeof window !== "undefined" ? isLegacyBoot() : false;

/* ── Workbench chrome (desktop sidebar + mobile tabbar/drawer) ─────── */

const WORKBENCH_ALL = WORKBENCH_TABS.concat([WORKBENCH_SETTINGS]);
const LEGACY_BY_KEY = LEGACY_TABS.reduce((m, t) => { m[t.key] = t; return m; }, {});
const WB_BY_KEY = WORKBENCH_ALL.reduce((m, t) => { m[t.key] = t; return m; }, {});

function WorkbenchSidebar({ active, onWb, onLegacy, syncedCount }) {
  const item = (t, attr, onClick) => {
    return (
      <button
        key={attr + "-" + t.key}
        data-workbench-nav={attr === "workbench" ? t.key : undefined}
        data-gg-nav={attr === "legacy" ? t.key : undefined}
        className={"gg-nav-item" + (active === t.key ? " is-active" : "")}
        aria-current={active === t.key ? "page" : undefined}
        onClick={() => onClick(t.key)}
      >
        <span style={{ position: "relative", display: "inline-flex", flex: "none" }}>
          <Icon name={t.icon} style={{ width: 20, height: 20, flex: "none" }} />
          {t.key === "weekend" && attr === "legacy" && syncedCount > 0 && (
            <span style={{
              position: "absolute", top: -7, right: -10, minWidth: 16, height: 16,
              padding: "0 4px", borderRadius: "var(--radius-pill)", background: "var(--accent)",
              color: "#06241B", fontSize: 10.5, fontWeight: 700, display: "inline-flex",
              alignItems: "center", justifyContent: "center",
            }}>{syncedCount}</span>
          )}
        </span>
        <span className="gg-nav-label">{t.label}</span>
      </button>
    );
  };

  return (
    <nav className="gg-sidebar" data-gg-region="sidebar" data-gg-shell-nav="workbench" aria-label="主导航">
      {WORKBENCH_ALL.map((t) => item(t, "workbench", onWb))}
      <div className="gg-nav-spacer" />
      <div className="gg-sidebar-divider" />
      <div className="gg-nav-label" style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-faint)", padding: "2px 12px 6px", letterSpacing: "0.04em" }}>
        专业能力
      </div>
      {LEGACY_SIDEBAR_KEYS.map((k) => item(LEGACY_BY_KEY[k], "legacy", onLegacy))}
      {/* Compatibility entries kept reachable but out of the visual flow:
          the E2E drives data-gg-nav="search" / "smart" directly. */}
      <div style={{ display: "none" }}>
        {["search", "smart"].map((k) => item(LEGACY_BY_KEY[k], "legacy", onLegacy))}
      </div>
    </nav>
  );
}

function WorkbenchTabBar({ active, onChange, syncedCount }) {
  return (
    <div data-gg-region="tabbar" style={{
      flex: "none", display: "flex", padding: "8px 12px 22px",
      background: "color-mix(in oklch, var(--surface-card) 88%, transparent)",
      backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
      borderTop: "1px solid var(--border-subtle)",
    }}>
      {MOBILE_TABS.map((t) => {
        const on = t.key === active;
        const badge = t.key === "weekend" && syncedCount > 0;
        return (
          <button key={t.key}
            data-workbench-nav={t.workbench ? t.key : undefined}
            data-gg-nav={t.legacy ? t.key : undefined}
            onClick={() => onChange(t.key)}
            style={{
              flex: 1, border: "none", background: "transparent", cursor: "pointer",
              display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
              color: on ? "var(--brand)" : "var(--text-faint)",
            }}>
            <span style={{ position: "relative", display: "inline-flex" }}>
              <Icon name={t.icon} style={{ width: 24, height: 24 }} />
              {badge && (
                <span style={{
                  position: "absolute", top: -6, right: -10, minWidth: 16, height: 16,
                  padding: "0 4px", borderRadius: "var(--radius-pill)", background: "var(--accent)",
                  color: "#06241B", fontSize: 10.5, fontWeight: 700, display: "inline-flex",
                  alignItems: "center", justifyContent: "center",
                }}>{syncedCount}</span>
              )}
            </span>
            <span style={{ fontSize: 10.5, fontWeight: on ? 700 : 500, fontFamily: "var(--font-sans)" }}>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Mobile drawer: exposes the remaining Workbench + legacy tabs. */
function MoreDrawer({ open, onClose, active, onPick, syncedCount }) {
  if (!open) return null;
  const rows = MOBILE_MORE_TABS;
  return (
    <div onClick={onClose} style={{
      position: "absolute", inset: 0, zIndex: 40,
      background: "color-mix(in oklch, #000 45%, transparent)",
      display: "flex", alignItems: "flex-end",
    }} data-testid="workbench-more-drawer">
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "100%", background: "var(--surface-card)", borderRadius: "18px 18px 0 0",
        padding: "14px 14px 26px", boxShadow: "var(--shadow-xl)",
      }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-faint)", padding: "2px 8px 10px" }}>
          更多入口
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
          {rows.map((t) => {
            const on = t.key === active;
            return (
              <button key={t.key}
                data-workbench-nav={t.workbench ? t.key : undefined}
                data-gg-nav={t.legacy ? t.key : undefined}
                onClick={() => onPick(t.key)}
                style={{
                  border: "1px solid var(--border-subtle)", background: on ? "var(--brand-soft)" : "var(--bg-sunken)",
                  color: on ? "var(--brand)" : "var(--text-body)", borderRadius: "var(--radius-md)",
                  padding: "12px 6px", cursor: "pointer", display: "flex", flexDirection: "column",
                  alignItems: "center", gap: 6, fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 600,
                  position: "relative",
                }}>
                <Icon name={t.icon} style={{ width: 20, height: 20 }} />
                {t.label}
                {t.key === "weekend" && syncedCount > 0 && (
                  <span style={{
                    position: "absolute", top: 6, right: 8, minWidth: 15, height: 15,
                    borderRadius: "var(--radius-pill)", background: "var(--accent)", color: "#06241B",
                    fontSize: 10, fontWeight: 700, display: "inline-flex", alignItems: "center",
                    justifyContent: "center", padding: "0 3px",
                  }}>{syncedCount}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Toast({ msg }) {
  if (!msg) return null;
  return (
    <div style={{ position: "absolute", top: "var(--gg-toast-top)", left: "50%", transform: "translateX(-50%)", zIndex: 50,
      background: "var(--ink)", color: "#fff", padding: "11px 18px", borderRadius: "var(--radius-pill)",
      display: "flex", alignItems: "center", gap: 9, boxShadow: "var(--shadow-lg)", animation: "gg-toast-in var(--dur-base) var(--ease-out)", whiteSpace: "nowrap" }}>
      <span style={{ width: 22, height: 22, borderRadius: "50%", background: "var(--accent)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
        <Icon name="check" style={{ width: 14, height: 14, color: "#06241B" }} />
      </span>
      <span style={{ fontSize: 13.5, fontWeight: 600 }}>{msg}</span>
    </div>
  );
}

const ALL_ACTIVITIES = GORGON_DATA.activities || [];

/** Anything (raw record, id, or an already-normalised view) -> view model. */
function asView(x) {
  if (!x) return null;
  if (typeof x === "string") {
    const found = ALL_ACTIVITIES.find((a) => a.id === x);
    return found ? ActivityView.toView(found) : null;
  }
  if (x.__view) return x;
  return ActivityView.toView(x);
}

export default function App() {
  // §17: default boot = Workbench home; /?legacy=1 preserves the Phase-1
  // boot (discover) for legacy tests and explicit legacy entry.
  const [tab, setTab] = React.useState(LEGACY_MODE ? "discover" : null);
  // Workbench layer: tracks which Workbench entry is highlighted. The
  // effective screen is resolved from (tab, wbTab) — see the registry below.
  const [wbTab, setWbTab] = React.useState(LEGACY_MODE ? null : "home");
  const [moreOpen, setMoreOpen] = React.useState(false);
  // Task Detail overlay key: the id of the task being inspected (null = none).
  const [detailTaskId, setDetailTaskId] = React.useState(null);
  // My Weekend persists FULL snapshots (id -> view), so a saved search result
  // survives a refresh even when the search session is gone.
  const [weekend, setWeekend] = React.useState(() => Store.getWeekendItems());
  const [favorites, setFavorites] = React.useState(() => Store.getFavorites());
  const [detail, setDetail] = React.useState(null);
  const [mapFocus, setMapFocus] = React.useState(null);
  // ONE district selection for the whole app (Discover / Search / Map / 智能),
  // restored from localStorage so a refresh keeps the user's choice.
  const [district, setDistrictState] = React.useState(() => Store.getDistrict());
  const [toast, setToast] = React.useState("");
  const toastTimer = React.useRef(null);

  // Phase 2 Workbench state. Tasks live in the formal engine (v2 schema);
  // reading via the facade auto-migrates Phase-1 data on first call.
  const [wbTasks, setWbTasks] = React.useState(() => WBStore.getTasks());
  const [wbReview, setWbReview] = React.useState(() => WBStore.ensureReviewSeed());
  const [wbLog, setWbLog] = React.useState(() => WBStore.getLog());
  // Phase 6: REAL proposals backing the Review Center.
  const [wbProposals, setWbProposals] = React.useState(() => WBStore.getProposals());

  const { isMobile } = useResponsive();

  const setDistrict = (d) => {
    setDistrictState(Store.setDistrict(d));
  };

  const flash = (m) => {
    setToast(m); clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 1800);
  };

  /** Create a REAL task (§16): goal = full text, title auto-derived. */
  const createTaskFromGoal = (goal) => {
    const text = String(goal || "").trim();
    if (!text) return null;
    setWbTasks(WBStore.addTask(text));
    setWbLog(WBStore.getLog());
    const created = WBStore.getTasks()[0] || null;
    return created;
  };

  const addTaskLocal = (title, opts) => {
    setWbTasks(WBStore.addTask(title, opts));
    setWbLog(WBStore.getLog());
  };

  /** Status changes go through the State Machine only; illegal = no-op. */
  const changeTaskStatus = (id, status) => {
    setWbTasks(WBStore.setTaskStatus(id, status));
    setWbLog(WBStore.getLog());
  };

  /** Throwing variant for detail controls (they pre-check legality). */
  const transitionTask = (id, status) => {
    try {
      setWbTasks(WBStore.transitionTask(id, status));
      setWbLog(WBStore.getLog());
    } catch (e) {
      flash("非法状态流转，已阻止");
    }
  };

  /** Phase 3: run a task through the deterministic Router + Skills engine. */
  const runTaskEngine = async (id, opts) => {
    const out = await WBStore.runTask(id, opts || {});
    setWbTasks(WBStore.getTasks());
    setWbLog(WBStore.getLog());
    return out;
  };

  const openTaskDetail = (id) => {
    setDetail(null);
    setWbTab("tasks");
    setDetailTaskId(id);
  };

  const decideReview = (id, decision) => {
    setWbReview(WBStore.decideReviewCard(id, decision));
    setWbLog(WBStore.getLog());
  };

  const decideProposal = (id, decision) => {
    setWbProposals(WBStore.decideProposal(id, decision) ? WBStore.getProposals() : WBStore.getProposals());
    // An approved follow-up proposal really creates a task — refresh the list.
    setWbTasks(WBStore.getTasks());
  };

  const resumeReviewTask = (id) => {
    transitionTask(id, "running");
    flash("任务已恢复执行");
  };

  // --- My Weekend (persisted, snapshot-carrying) ---
  const toggleSync = (input) => {
    const view = asView(input);
    if (!view || !view.id) return;
    const on = !weekend[view.id];
    const next = Object.assign({}, weekend);
    if (on) next[view.id] = view; else delete next[view.id];
    setWeekend(next);
    Store.setWeekendItems(next);
    flash(on ? "已加入我的周末" : "已从我的周末移除");
  };

  // --- Favorites (persisted) ---
  const toggleFavorite = (id) => {
    const has = favorites.indexOf(id) >= 0;
    const next = has ? favorites.filter((x) => x !== id) : favorites.concat([id]);
    setFavorites(next);
    Store.setFavorites(next);
    flash(has ? "已取消收藏" : "已收藏");
  };

  const openDetail = (x) => { const v = asView(x); if (v) setDetail(v); };
  const showOnMap = (v) => { setMapFocus(v.id); setDetail(null); setDetailTaskId(null); setTab("map"); setWbTab(null); };
  const changeTab = (t) => { setDetail(null); setDetailTaskId(null); setTab(t); setWbTab(null); setMoreOpen(false); };
  const changeWbTab = (t) => {
    setDetail(null); setMoreOpen(false);
    const legacy = WORKBENCH_TO_LEGACY[t];
    if (legacy) { setTab(legacy); setWbTab(t); return; }
    setTab(null); setWbTab(t);
  };
  const pickMobileTab = (t) => {
    setMoreOpen(false);
    if (t === "more") { setMoreOpen(true); return; }
    if (WB_BY_KEY[t] && !LEGACY_BY_KEY[t]) { changeWbTab(t); return; }
    changeTab(t);
  };

  const syncedCount = Object.keys(weekend).length;

  // ── Screen registry ──────────────────────────────────────────────
  // Legacy tabs keep rendering exactly what they always did (the E2E
  // contract). Workbench tabs render the Phase-2 shell screens; 智能搜索
  // maps onto the existing NaturalSearchScreen with a Workbench heading.
  const detailTask = detailTaskId ? wbTasks.find((t) => t.id === detailTaskId) : null;

  const workbenchScreens = {
    home: (
      <WorkbenchHome tasks={wbTasks}
        onCreateTask={createTaskFromGoal}
        onGoSearch={() => changeWbTab("search")} onGoTasks={() => changeWbTab("tasks")}
        onOpenTask={openTaskDetail} />
    ),
    tasks: (
      detailTask ? (
        <TaskDetailScreen task={detailTask}
          onTransition={(to) => transitionTask(detailTask.id, to)}
          onBack={() => setDetailTaskId(null)}
          onAddStep={(title) => { setWbTasks(WBStore.addTaskStep(detailTask.id, { title })); }}
          onUpdateStep={(stepId, patch) => { setWbTasks(WBStore.updateTaskStep(detailTask.id, stepId, patch)); }}
          onSetResult={(r) => { setWbTasks(WBStore.setTaskResult(detailTask.id, r)); }}
          onAddSource={(s) => { setWbTasks(WBStore.addTaskSource(detailTask.id, s)); }}
          onRun={runTaskEngine} />
      ) : (
        <TasksScreen tasks={wbTasks} onStatusChange={changeTaskStatus}
          onAddTask={(t) => addTaskLocal(t, { source: "任务页输入" })}
          onOpenTask={openTaskDetail} />
      )
    ),
    review: (
      <ReviewCenterScreen cards={wbReview} onDecide={decideReview}
        reviewTasks={wbTasks} onResumeTask={resumeReviewTask}
        proposals={wbProposals} onProposal={decideProposal} />
    ),
    history: (
      <HistoryScreen tasks={wbTasks} log={wbLog} onOpenTask={openTaskDetail} />
    ),
    settings: <SettingsScreen />,
  };

  const content = (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}>
      {tab === "discover" && <DiscoverScreen synced={weekend} onSync={toggleSync} onOpen={openDetail} onGoSearch={() => setTab("search")} onGoSmart={() => setTab("smart")} district={district} onDistrictChange={setDistrict} />}
      {tab === "smart" && <NaturalSearchScreen synced={weekend} onSync={toggleSync} onOpen={openDetail} district={district} onDistrictChange={setDistrict} />}
      {tab === "search" && <SearchScreen synced={weekend} onSync={toggleSync} onOpen={openDetail} district={district} onDistrictChange={setDistrict} />}
      {tab === "weekend" && <MyWeekendScreen weekend={weekend} onSync={toggleSync} onOpen={openDetail} onDiscover={() => setTab("discover")} favorites={favorites} onToggleFavorite={toggleFavorite} />}
      {tab === "map" && <MapScreen synced={weekend} onSync={toggleSync} onOpen={openDetail} focusId={mapFocus} district={district} onDistrictChange={setDistrict} />}

      {wbTab && workbenchScreens[wbTab]}

      {detail && (
        <div className="gg-detail-overlay" style={{ animation: "gg-detail-in var(--dur-base) var(--ease-out)" }}>
          <ActivityDetailScreen view={detail} synced={!!weekend[detail.id]} onSync={() => toggleSync(detail)}
            onBack={() => setDetail(null)} onShowMap={() => showOnMap(detail)} />
        </div>
      )}
      <Toast msg={toast} />
    </div>
  );

  if (isMobile) {
    return (
      <PhoneFrame>
        <StatusBar dark={false} />
        {content}
        <WorkbenchTabBar active={wbTab || (moreOpen ? "more" : tab)} syncedCount={syncedCount}
          onChange={pickMobileTab} />
        <MoreDrawer open={moreOpen} onClose={() => setMoreOpen(false)} active={wbTab || tab}
          onPick={pickMobileTab} syncedCount={syncedCount} />
      </PhoneFrame>
    );
  }

  return (
    <div className="gg-app" data-gg-shell="wide" data-gg-shell-nav="workbench">
      <DesktopHeader district={district} onWorkbenchHome={() => changeWbTab("home")} />
      <div className="gg-body">
        <WorkbenchSidebar
          active={wbTab || tab}
          onWb={changeWbTab}
          onLegacy={changeTab}
          syncedCount={syncedCount}
        />
        <div className="gg-main">
          <div className="gg-frame">
            <div className="gg-container">{content}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
