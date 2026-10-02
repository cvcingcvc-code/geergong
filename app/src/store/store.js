// Gorgon — tiny localStorage persistence layer.
//
// Migrated from ui_kits/app/store.js (window.GorgonStore) to a standard ES
// module for the V1 frontend build. Keys and semantics are UNCHANGED so
// existing browsers keep their My Weekend / favorites / district selection.
//
// Scope: DEMO ONLY. No backend, no database. Everything lives in the browser.
// Keys are stable so "Reset Demo" can clear them deterministically.
//
// PHASE 5: My Weekend stores the FULL activity snapshot, not just the id.
// A search result the user saved must still be there after a refresh — and it
// must render even when the search session is gone (no API, new query, etc.).
// The old id-list key is still written (and still read) so existing storage
// keeps working.

import * as District from "../lib/district.js";

const K_WEEKEND = "gorgon_my_weekend"; // string[] of activity ids
const K_WEEKEND_ITEMS = "gorgon_my_weekend_items"; // { [id]: activityView }
const K_FAVORITES = "gorgon_favorites"; // string[] of activity ids
const K_ADMIN = "gorgon_admin_review"; // { [itemId]: "approve" | "return" | "reject" }
const K_SEED = "gorgon_demo_v1"; // flag: demo dataset has been seeded once
// The one district selection the whole app shares (Discover / Search / Map /
// 智能). Stored as the plain district name, or "全上海" for no filter.
const K_DISTRICT = "gorgon_selected_district";

export const KEYS = {
  weekend: K_WEEKEND, weekendItems: K_WEEKEND_ITEMS,
  favorites: K_FAVORITES, admin: K_ADMIN, seed: K_SEED,
  district: K_DISTRICT,
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    const v = JSON.parse(raw);
    return v == null ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    /* private mode / quota — demo degrades to in-memory */
  }
}

function toArray(v) {
  return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
}

function toMap(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}

// ---- My Weekend ------------------------------------------------------

/** id -> saved activity snapshot. The source of truth for the UI. */
export function getWeekendItems() {
  return toMap(read(K_WEEKEND_ITEMS, {}));
}

export function setWeekendItems(map) {
  map = toMap(map);
  write(K_WEEKEND_ITEMS, map);
  // keep the id list in sync for anything still reading it
  write(K_WEEKEND, Object.keys(map).filter((k) => map[k]));
}

export function getWeekend() {
  const items = toMap(read(K_WEEKEND_ITEMS, {}));
  const ids = Object.keys(items);
  // Fall back to the legacy id list when no snapshots were ever saved.
  return ids.length ? ids : toArray(read(K_WEEKEND, []));
}

export function setWeekend(ids) {
  write(K_WEEKEND, toArray(ids));
}

export function toggleWeekend(id, currentMap) {
  const map = currentMap ? Object.assign({}, currentMap) : {};
  map[id] = !map[id];
  const ids = Object.keys(map).filter((k) => map[k]);
  write(K_WEEKEND, ids);
  return map;
}

// ---- Favorites -------------------------------------------------------

export function getFavorites() {
  return toArray(read(K_FAVORITES, []));
}

export function setFavorites(ids) {
  write(K_FAVORITES, toArray(ids));
}

// ---- Admin review ----------------------------------------------------

export function getAdmin() {
  const v = read(K_ADMIN, {});
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}

export function setAdmin(obj) {
  write(K_ADMIN, obj && typeof obj === "object" ? obj : {});
}

// ---- District selection ----------------------------------------------

/**
 * The stored district, sanitised.
 *
 * Only "全上海" or a district the app actually recognises is accepted;
 * anything else (hand-edited storage, a district from an older dataset
 * build) falls back to "全上海". Falling back WIDENS the result set — it
 * can never hide activities behind a district that does not exist.
 */
export function getDistrict() {
  const raw = read(K_DISTRICT, null);
  if (typeof raw !== "string" || !raw.trim()) return District.ALL;
  const v = raw.trim();
  if (District.isAll(v)) return District.ALL;
  return District.isKnownDistrict(v) ? v : District.ALL;
}

export function setDistrict(value) {
  let v = typeof value === "string" ? value.trim() : "";
  if (!v || District.isAll(v)) v = District.ALL;
  else if (!District.isKnownDistrict(v)) v = District.ALL;
  write(K_DISTRICT, v);
  return v;
}

// ---- Demo seed flag (so the demo starts clean but non-empty) ---------

export function isSeeded() {
  return read(K_SEED, false) === true;
}

export function markSeeded() {
  write(K_SEED, true);
}

// ---- Reset -----------------------------------------------------------

export function reset() {
  try {
    localStorage.removeItem(K_WEEKEND);
    localStorage.removeItem(K_WEEKEND_ITEMS);
    localStorage.removeItem(K_FAVORITES);
    localStorage.removeItem(K_ADMIN);
    localStorage.removeItem(K_SEED);
    localStorage.removeItem(K_DISTRICT);
  } catch (e) { /* ignore */ }
}
