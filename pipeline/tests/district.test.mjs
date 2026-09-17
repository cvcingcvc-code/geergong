// PHASE 5.1 — district filter tests (plain Node, no browser needed).
//
// `ui_kits/app/district.js` is the ONE module Discover / Search / Map / 智能 all
// filter through, so it is worth testing without a browser in the loop. It is
// loaded here into a minimal fake `window` (together with the real shipped
// dataset, so the assertions are about the data that actually ships), and
// exercised directly.
//
// The normaliser is additionally pinned to `pipeline/normalize/location.py` by
// a shared corpus that the Python suite asserts too — see
// fixtures/district_corpus.json. Two implementations, one answer.
//
// Run:  node pipeline/tests/district.test.mjs
// Exits non-zero on the first failure.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import vm from "node:vm";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, "..", "..", "ui_kits", "app");

let passed = 0;
const failures = [];

function ok(cond, label) {
  if (cond) { passed++; return true; }
  failures.push(label);
  console.error("  ✗ " + label);
  return false;
}

function eq(actual, expected, label) {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  if (!same) {
    console.error("  ✗ " + label + "\n      expected: " + JSON.stringify(expected) +
      "\n      actual:   " + JSON.stringify(actual));
    failures.push(label);
    return false;
  }
  passed++;
  return true;
}

// ── a minimal browser: localStorage + window, exactly what these files need ──
function makeSandbox() {
  const store = new Map();
  const sandbox = {
    window: { location: { protocol: "http:", search: "" } },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: (k) => { store.delete(k); },
    },
    console,
    setTimeout,
    clearTimeout,
  };
  sandbox.window.localStorage = sandbox.localStorage;
  vm.createContext(sandbox);
  sandbox.__store = store;
  return sandbox;
}

function load(sandbox, file) {
  vm.runInContext(readFileSync(resolve(APP, file), "utf8"), sandbox, { filename: file });
}

// Same load order as ui_kits/app/index.html, minus the JSX.
const sandbox = makeSandbox();
load(sandbox, "district.js");
load(sandbox, "data.js");
load(sandbox, "generated-data.js");
load(sandbox, "data-adapter.js");
load(sandbox, "store.js");

const D = sandbox.window.GorgonDistrict;
const Store = sandbox.window.GorgonStore;
const DATA = sandbox.window.GORGON_DATA;
const ACTIVITIES = DATA.activities;

ok(!!D, "GorgonDistrict is exported onto window");
ok(!!Store && typeof Store.getDistrict === "function", "GorgonStore exposes getDistrict");

// ── 1. the corpus: one truth for Python and JS ────────────────────────────
const CORPUS = JSON.parse(readFileSync(resolve(HERE, "fixtures", "district_corpus.json"), "utf8"));
ok(CORPUS.cases.length > 0, "shared corpus is present and non-empty");
eq(D.DISTRICTS, CORPUS.districts, "the JS district vocabulary equals the corpus (and therefore Python's)");
eq(D.CITIES.slice().sort(), CORPUS.cities.slice().sort(), "the JS city vocabulary equals the corpus");

for (const c of CORPUS.cases) {
  eq(D.normalizeDistrict(c.input), c.expected, "corpus: " + c.why + " [" + JSON.stringify(c.input) + "]");
}

// The two variants the brief calls out by name.
eq(D.normalizeDistrict("徐汇区"), "徐汇", "徐汇区 -> 徐汇");
eq(D.normalizeDistrict("上海市徐汇区"), "徐汇", "上海市徐汇区 -> 徐汇");

// ── 2. districtOf: whichever shape the record arrives in ──────────────────
eq(D.districtOf({ district: "徐汇区" }), "徐汇", "legacy record with a 区 suffix");
eq(D.districtOf({ location: "上海·徐汇" }), "徐汇", "legacy record with location only");
eq(D.districtOf({ district: "上海市徐汇区", address: "上海市徐汇区龙腾大道2600号" }), "徐汇",
  "pipeline record");
eq(D.districtOf({ district: null, address: "上海市浦东新区川和路55号" }), "浦东",
  "district missing but the address carries it");
eq(D.districtOf({ district: "火星" }), "火星", "an unrecognised district stays as written, never guessed");
eq(D.districtOf({}), null, "nothing to go on -> null");
eq(D.districtOf(null), null, "null record");
eq(D.districtOf({ __view: true, district: "上海市杨浦区" }), "杨浦", "a stored view is normalised too");

// ── 3. the real dataset: every selectable district is real ────────────────
ok(ACTIVITIES.length > 0, "the shipped dataset is non-empty (" + ACTIVITIES.length + " activities)");

const OPTIONS = D.options(ACTIVITIES, D.ALL);
for (const base of D.BASELINE) {
  ok(OPTIONS.indexOf(base) >= 0, "baseline district offered: " + base);
}
for (const d of OPTIONS) {
  ok(D.isKnownDistrict(d), "every offered district is a real Shanghai district: " + d);
}
// Nothing foreign can sneak in, even if the data contains it.
const foreign = [
  { id: "x1", title: "北京活动", district: "北京·朝阳", location: "北京·朝阳" },
  { id: "x2", title: "火星活动", district: "火星", location: "火星" },
];
const foreignOptions = D.options(ACTIVITIES.concat(foreign), D.ALL);
eq(foreignOptions.filter((d) => !D.isKnownDistrict(d)), [],
  "a foreign/unknown district in the data never becomes a selectable region");
ok(foreignOptions.indexOf("北京") < 0 && foreignOptions.indexOf("火星") < 0,
  "北京 / 火星 are not offered");

// Districts present in the data beyond the baseline join automatically.
const present = Object.keys(D.counts(ACTIVITIES)).filter((d) => D.BASELINE.indexOf(d) < 0);
for (const d of present) {
  ok(OPTIONS.indexOf(d) >= 0, "district in the data joins the menu automatically: " + d);
}
// …and a selection from another build is never silently dropped from the menu.
ok(D.options(ACTIVITIES, "崇明").indexOf("崇明") >= 0,
  "a stored selection outside the current data still shows as the selected row");

// ── 4. the filter itself ──────────────────────────────────────────────────
eq(D.filter(ACTIVITIES, D.ALL).length, ACTIVITIES.length, "全上海 is the whole dataset");
eq(D.filter(ACTIVITIES, null).length, ACTIVITIES.length, "an unset district behaves as 全上海");
eq(D.filter(ACTIVITIES, "").length, ACTIVITIES.length, "an empty district behaves as 全上海");

const XUHUI = D.filter(ACTIVITIES, "徐汇");
ok(XUHUI.length > 0, "徐汇 has activities in the shipped dataset (" + XUHUI.length + ")");
ok(XUHUI.every((a) => D.districtOf(a) === "徐汇"), "every 徐汇 row really is in 徐汇");
ok(XUHUI.length < ACTIVITIES.length, "filtering 徐汇 is a strict subset, not the whole list");
ok(ACTIVITIES.some((a) => D.districtOf(a) === "杨浦"), "…and other districts exist to be excluded");

// No leak: nothing from another district survives.
const outside = ACTIVITIES.filter((a) => D.districtOf(a) !== "徐汇");
ok(XUHUI.every((a) => outside.indexOf(a) < 0), "no other district's row leaks into 徐汇");

// The filter must not mutate its input.
const before = ACTIVITIES.length;
D.filter(ACTIVITIES, "徐汇");
eq(ACTIVITIES.length, before, "filter() does not mutate the list it is given");

// An unknown district yields nothing — it does not fall back to everything.
eq(D.filter(ACTIVITIES, "火星"), [], "an unknown district matches nothing rather than everything");

// ── 5. count == rendered rows (the D-3 rule, applied to districts) ────────
// `counts()` is a sparse map: an absent key means zero, which is exactly the
// expression the picker renders (`counts[d] || 0`). Asserting the rendered
// number against the list length is the invariant that keeps the menu from
// promising four results and then drawing none.
const counts = D.counts(ACTIVITIES);
eq(counts[D.ALL], undefined, "全上海 is not a district and gets no district count");
eq(counts["火星"], undefined, "an unknown district is absent from the map (i.e. 0)");
for (const d of OPTIONS) {
  eq(counts[d] || 0, D.filter(ACTIVITIES, d).length, "the menu's count equals the list length for " + d);
}
const total = OPTIONS.reduce((n, d) => n + (counts[d] || 0), 0);
const known = ACTIVITIES.filter((a) => D.isKnownDistrict(D.districtOf(a))).length;
eq(total, known, "the offered counts add up to every activity that has a recognised district");

// ── 6. keyword AND district (never OR) ───────────────────────────────────
// This asserts the COMPOSITION. The keyword predicate here is written
// independently on purpose — it only has to be a set-membership test, and the
// property under test is that composing it with the district filter yields an
// INTERSECTION. If anyone ever changes SearchScreen to union the two, this
// fails. (The shipped SearchScreen's own 徐汇 + AI behaviour is asserted end to
// end in e2e_district.mjs, where the real input box is used.)
const keywordHits = ACTIVITIES.filter((a) => {
  const t = [a.title, a.desc, a.host, (a.tags || []).join(" ")].filter(Boolean).join(" ").toLowerCase();
  return t.indexOf("ai") >= 0;
});
ok(keywordHits.length > 0, "the keyword pool is non-empty (" + keywordHits.length + ")");

const combo = D.filter(keywordHits, "徐汇");
ok(combo.every((a) => keywordHits.indexOf(a) >= 0), "keyword+district result is inside the keyword set (AND)");
ok(combo.every((a) => D.districtOf(a) === "徐汇"), "keyword+district result is inside 徐汇 (AND)");
eq(combo.length, keywordHits.filter((a) => D.districtOf(a) === "徐汇").length,
  "keyword AND district is exactly the intersection");
ok(combo.length <= keywordHits.length && combo.length <= XUHUI.length,
  "the intersection cannot exceed either operand");
ok(combo.length < keywordHits.length + XUHUI.length,
  "the result is NOT the union of the two filters");

// ── 7. the map dataset ────────────────────────────────────────────────────
for (const d of ["静安", "徐汇", D.ALL]) {
  const pins = D.filter(ACTIVITIES, d);
  if (D.isAll(d)) {
    eq(pins.length, ACTIVITIES.length, "map(全上海) renders every activity");
  } else {
    ok(pins.every((a) => D.districtOf(a) === d), "every map pin belongs to " + d);
  }
}

// ── 8. empty-state copy ───────────────────────────────────────────────────
eq(D.emptyTitle("徐汇", true), "徐汇暂无符合条件的活动", "district + keyword -> 徐汇暂无符合条件的活动");
eq(D.emptyTitle("徐汇", false), "徐汇暂无活动", "district only -> 徐汇暂无活动");
eq(D.emptyTitle(D.ALL, false), "暂时没有活动", "no district, no filters");
eq(D.emptyTitle(D.ALL, true), "暂时没有符合条件的活动", "no district, with filters");

// ── 9. localStorage persistence ───────────────────────────────────────────
eq(Store.KEYS.district, "gorgon_selected_district", "the storage key is gorgon_selected_district");
eq(Store.getDistrict(), D.ALL, "a fresh browser defaults to 全上海");

Store.setDistrict("徐汇");
eq(Store.getDistrict(), "徐汇", "a selection round-trips");
eq(sandbox.__store.get("gorgon_selected_district"), JSON.stringify("徐汇"),
  "…and is written as JSON under the agreed key");

Store.setDistrict("上海市徐汇区");
eq(sandbox.__store.get("gorgon_selected_district"), JSON.stringify("全上海"),
  "an un-normalised write is sanitised (the module never stores what it cannot filter)");

// Hand-edited / stale storage must never hide data behind a district that does
// not exist — it falls back to the WIDER 全上海.
for (const junk of ["火星", "北京", "", null, 42, { a: 1 }, "全上海"]) {
  sandbox.__store.set("gorgon_selected_district", JSON.stringify(junk));
  const got = Store.getDistrict();
  ok(got === D.ALL || D.isKnownDistrict(got),
    "garbage in storage falls back to 全上海 (" + JSON.stringify(junk) + " -> " + got + ")");
}
sandbox.__store.set("gorgon_selected_district", JSON.stringify("静安"));
eq(Store.getDistrict(), "静安", "a valid stored district is restored (survives a reload)");

Store.reset();
eq(Store.getDistrict(), D.ALL, "Reset Demo clears the district too");

console.log("\nDistrict filter tests: " + passed + " passed, " + failures.length + " failed");
if (failures.length) {
  console.error("FAILED:");
  failures.forEach((f) => console.error("  - " + f));
  process.exit(1);
}
console.log("OK");
