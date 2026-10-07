// Gorgon V1 — localStorage store tests (local storage model migration).
//
// Asserts the MIGRATED store (app/src/store/store.js) keeps the legacy
// contract: same keys, same fallback behaviour, same district sanitation,
// same weekend snapshot + legacy id-list sync.
//
// Runs under plain Node with a minimal in-memory localStorage stub.
//
// Run: node --test tests/   (from app/)

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

// In-memory localStorage stub, installed BEFORE importing the store.
function makeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    clear: () => m.clear(),
    get size() { return m.size; },
  };
}

globalThis.localStorage = makeStorage();

const Store = await import("../src/store/store.js");

beforeEach(() => { localStorage.clear(); });

test("weekend snapshots round-trip and sync the legacy id list", () => {
  assert.deepEqual(Store.getWeekendItems(), {});
  const view = { __view: true, id: "a1", title: "T" };
  Store.setWeekendItems({ a1: view });
  assert.deepEqual(Store.getWeekendItems(), { a1: view });
  // legacy id list kept in sync
  assert.equal(localStorage.getItem("gorgon_my_weekend"), JSON.stringify(["a1"]));
  assert.deepEqual(Store.getWeekend(), ["a1"]);
});

test("getWeekend falls back to the legacy id list", () => {
  localStorage.setItem("gorgon_my_weekend", JSON.stringify(["x", "y"]));
  assert.deepEqual(Store.getWeekend(), ["x", "y"]);
});

test("favorites round-trip, non-strings dropped", () => {
  assert.deepEqual(Store.getFavorites(), []);
  Store.setFavorites(["a", "b"]);
  assert.deepEqual(Store.getFavorites(), ["a", "b"]);
  localStorage.setItem("gorgon_favorites", JSON.stringify(["a", 42, null, "c"]));
  assert.deepEqual(Store.getFavorites(), ["a", "c"]);
});

test("corrupt JSON degrades to fallback, never throws", () => {
  localStorage.setItem("gorgon_my_weekend_items", "{not json");
  assert.deepEqual(Store.getWeekendItems(), {});
  localStorage.setItem("gorgon_selected_district", "{broken");
  assert.equal(Store.getDistrict(), "全上海");
});

test("district sanitation: unknown values fall back to 全上海 (widens, never hides)", () => {
  assert.equal(Store.getDistrict(), "全上海", "unset");
  assert.equal(Store.setDistrict("徐汇"), "徐汇");
  assert.equal(Store.getDistrict(), "徐汇");
  assert.equal(Store.setDistrict("全上海"), "全上海");
  assert.equal(Store.setDistrict("朝阳区"), "全上海", "unknown district rejected");
  assert.equal(Store.setDistrict(""), "全上海");
  assert.equal(Store.setDistrict("  浦东  "), "浦东", "trimmed");
  assert.equal(Store.getDistrict(), "浦东");
  // hand-edited storage with an unknown value
  localStorage.setItem("gorgon_selected_district", JSON.stringify("平行宇宙区"));
  assert.equal(Store.getDistrict(), "全上海");
});

test("admin review map", () => {
  assert.deepEqual(Store.getAdmin(), {});
  Store.setAdmin({ i1: "approve" });
  assert.deepEqual(Store.getAdmin(), { i1: "approve" });
  Store.setAdmin([1, 2]);
  assert.deepEqual(Store.getAdmin(), {}, "arrays are not a valid admin map");
});

test("seed flag", () => {
  assert.equal(Store.isSeeded(), false);
  Store.markSeeded();
  assert.equal(Store.isSeeded(), true);
});

test("reset clears every known key", () => {
  Store.setWeekendItems({ a: { id: "a" } });
  Store.setFavorites(["a"]);
  Store.setDistrict("徐汇");
  Store.setAdmin({ a: "approve" });
  Store.markSeeded();
  Store.reset();
  assert.equal(localStorage.size, 0);
  assert.deepEqual(Store.getWeekendItems(), {});
  assert.deepEqual(Store.getFavorites(), []);
  assert.equal(Store.getDistrict(), "全上海");
  assert.equal(Store.isSeeded(), false);
});

test("KEYS are the legacy keys (storage compatibility)", () => {
  assert.deepEqual(Store.KEYS, {
    weekend: "gorgon_my_weekend",
    weekendItems: "gorgon_my_weekend_items",
    favorites: "gorgon_favorites",
    admin: "gorgon_admin_review",
    seed: "gorgon_demo_v1",
    district: "gorgon_selected_district",
  });
});
