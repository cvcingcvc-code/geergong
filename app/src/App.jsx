// Gorgon V1 — the root component.
//
// Ported from the inline <script type="text/babel"> bootstrap in
// ui_kits/app/index.html. State ownership is UNCHANGED: the synced set,
// active tab, detail overlay, map focus, district selection and the toast
// all live here and are shared by both chromes (phone frame / app shell).

import React from "react";
import { StatusBar, TabBar, PhoneFrame, AppShell } from "./components/AppShell.jsx";
import { DiscoverScreen } from "./screens/DiscoverScreen.jsx";
import { ActivityDetailScreen } from "./screens/ActivityDetailScreen.jsx";
import { SearchScreen } from "./screens/SearchScreen.jsx";
import { NaturalSearchScreen } from "./screens/NaturalSearchScreen.jsx";
import { MyWeekendScreen } from "./screens/MyWeekendScreen.jsx";
import { MapScreen } from "./screens/MapScreen.jsx";
import { useResponsive } from "./lib/useResponsive.js";
import * as Store from "./store/store.js";
import * as ActivityView from "./lib/activity-view.js";
import { GORGON_DATA } from "./lib/data.js";
import { Icon } from "./components/Icon.jsx";

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
  const [tab, setTab] = React.useState("discover");
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

  const { isMobile } = useResponsive();

  const setDistrict = (d) => {
    setDistrictState(Store.setDistrict(d));
  };

  const flash = (m) => {
    setToast(m); clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 1800);
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
  const showOnMap = (v) => { setMapFocus(v.id); setDetail(null); setTab("map"); };
  const changeTab = (t) => { setDetail(null); setTab(t); };

  const syncedCount = Object.keys(weekend).length;

  const content = (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}>
      {tab === "discover" && <DiscoverScreen synced={weekend} onSync={toggleSync} onOpen={openDetail} onGoSearch={() => setTab("search")} onGoSmart={() => setTab("smart")} district={district} onDistrictChange={setDistrict} />}
      {tab === "smart" && <NaturalSearchScreen synced={weekend} onSync={toggleSync} onOpen={openDetail} district={district} onDistrictChange={setDistrict} />}
      {tab === "search" && <SearchScreen synced={weekend} onSync={toggleSync} onOpen={openDetail} district={district} onDistrictChange={setDistrict} />}
      {tab === "weekend" && <MyWeekendScreen weekend={weekend} onSync={toggleSync} onOpen={openDetail} onDiscover={() => setTab("discover")} favorites={favorites} onToggleFavorite={toggleFavorite} />}
      {tab === "map" && <MapScreen synced={weekend} onSync={toggleSync} onOpen={openDetail} focusId={mapFocus} district={district} onDistrictChange={setDistrict} />}

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
        <TabBar active={tab} onChange={changeTab} syncedCount={syncedCount} />
      </PhoneFrame>
    );
  }

  return (
    <AppShell tab={tab} onTab={changeTab} syncedCount={syncedCount} district={district}
      onSettings={() => flash("设置（演示版暂未开放）")}>
      {content}
    </AppShell>
  );
}
