// Gorgon — 上海区级地区筛选 (district filter).
//
// Migrated from ui_kits/app/district.js (window.GorgonDistrict) to a standard
// ES module for the V1 frontend build. The logic is UNCHANGED — the JS test
// suite in app/tests/ and the shared corpus in
// pipeline/tests/fixtures/district_corpus.json pin it to the same behaviour,
// which in turn mirrors pipeline/normalize/location.py.
//
// ONE module owns three things, so Discover / Search / Map / 智能 can never
// disagree with each other:
//
//   1. the Shanghai district vocabulary
//   2. how a free-form location string becomes a district ("上海市徐汇区" -> 徐汇)
//   3. which activities belong to the current selection
//
// Nothing here guesses: an unrecognised value stays as the trimmed input and
// simply belongs to no selectable district.

// Same list, same order as pipeline/normalize/location.py::DISTRICTS.
export const DISTRICTS = [
  "黄浦", "徐汇", "长宁", "静安", "普陀", "虹口", "杨浦",
  "闵行", "宝山", "嘉定", "浦东", "金山", "松江", "青浦",
  "奉贤", "崇明",
];

// Same vocabulary as location.py::_CITIES, longest-first (matching order
// matters: "北京市" must win over "北京").
export const CITIES = [
  "上海", "北京市", "北京", "杭州市", "杭州", "南京市", "南京",
  "深圳市", "深圳", "广州市", "广州",
];
export const CITY_PREFIXES = CITIES.slice().sort((a, b) => b.length - a.length);

// The floor the product asks for. Every entry is a real Shanghai district
// that occurs in the shipped dataset — the picker never offers a district
// that exists nowhere in the data, and it never offers a non-Shanghai place.
export const BASELINE = [
  "徐汇", "浦东", "静安", "黄浦", "长宁", "杨浦", "闵行", "普陀", "虹口", "宝山",
];

// The "no district chosen" selection. Kept as a literal string (not null) so
// it round-trips through localStorage readably.
export const ALL = "全上海";
export const CITY_LABEL = "上海";

/* ── normalisation ─────────────────────────────────────────────────── */

export function normalizeDistrict(text) {
  if (typeof text !== "string" || !text.trim()) return null;
  let t = text.replace(/\s+/g, "");

  // Drop a city prefix (with optional 市) if present.
  for (let i = 0; i < CITY_PREFIXES.length; i++) {
    const city = CITY_PREFIXES[i];
    if (t.indexOf(city) === 0) {
      t = t.slice(city.length);
      if (t.charAt(0) === "市") t = t.slice(1);
      break;
    }
  }

  // Split on separators and look for a known district token.
  const parts = t.split(/[·\-—\/，,]/);
  for (let p = 0; p < parts.length; p++) {
    const part = parts[p].trim();
    for (let d = 0; d < DISTRICTS.length; d++) {
      const name = DISTRICTS[d];
      if (part === name || part === name + "区" || (part === name + "新区" && name === "浦东")) {
        return name;
      }
    }
  }

  // Fallback: strip trailing 区/县 and accept if it matches a known district.
  const t2 = t.replace(/[区县]+$/, "");
  for (let k = 0; k < DISTRICTS.length; k++) {
    if (t2 === DISTRICTS[k]) return DISTRICTS[k];
    if (t2.indexOf(DISTRICTS[k]) === 0) return DISTRICTS[k];
  }
  return null;
}

/** Is this string a district we recognise as one of ours? */
export function isKnownDistrict(value) {
  return DISTRICTS.indexOf(value) >= 0;
}

/**
 * The district of an activity, whichever shape it arrives in
 * (raw pipeline record, legacy demo record, or an activity view).
 *
 * Returns null only when there genuinely is nothing to go on. An
 * unrecognised value is returned trimmed — never guessed into a district it
 * might not be.
 */
export function districtOf(rec) {
  if (!rec) return null;
  let raw = rec.district;
  if ((raw == null || raw === "") && rec.location) {
    const parts = String(rec.location).split("·");
    raw = parts.length > 1 ? parts[1] : "";
  }
  let d = normalizeDistrict(raw);
  if (d) return d;
  // The field was missing or unusable — the address may still say it.
  d = normalizeDistrict(rec.address) || normalizeDistrict(rec.location);
  if (d) return d;
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  return null;
}

/* ── selection ─────────────────────────────────────────────────────── */

export function isAll(selected) {
  return !selected || selected === ALL;
}

export function matches(rec, selected) {
  if (isAll(selected)) return true;
  return districtOf(rec) === selected;
}

export function filter(list, selected) {
  const arr = list || [];
  if (isAll(selected)) return arr.slice();
  return arr.filter((r) => matches(r, selected));
}

/** "上海 · 徐汇" / "上海 · 全上海" — the one string every header shows. */
export function label(selected) {
  return CITY_LABEL + " · " + (isAll(selected) ? ALL : selected);
}

export function shortLabel(selected) {
  return isAll(selected) ? ALL : selected;
}

/**
 * The districts the picker offers for THIS dataset:
 *   baseline ∪ (recognised districts actually present) ∪ (current selection).
 *
 * The last term matters: a district stored from a different dataset must
 * still show up as the selected row rather than silently vanishing.
 * Non-Shanghai / unrecognised values can never enter the list.
 */
export function options(activities, selected) {
  const present = {};
  (activities || []).forEach((a) => {
    const d = districtOf(a);
    if (d && isKnownDistrict(d)) present[d] = true;
  });

  const list = BASELINE.slice();
  DISTRICTS.forEach((d) => {
    if (present[d] && list.indexOf(d) < 0) list.push(d);
  });
  if (!isAll(selected) && list.indexOf(selected) < 0) list.push(selected);
  return list;
}

/** district -> how many of these activities are in it (unknown ones dropped). */
export function counts(activities) {
  const out = {};
  (activities || []).forEach((a) => {
    const d = districtOf(a);
    if (d) out[d] = (out[d] || 0) + 1;
  });
  return out;
}

/**
 * The empty-state headline. Honest about WHICH filter emptied the page:
 * district only -> "徐汇暂无活动"; district + keyword/free/分类 ->
 * "徐汇暂无符合条件的活动". Never falls back to other districts' data.
 */
export function emptyTitle(selected, hasOtherFilters) {
  if (isAll(selected)) {
    return hasOtherFilters ? "暂时没有符合条件的活动" : "暂时没有活动";
  }
  return selected + (hasOtherFilters ? "暂无符合条件的活动" : "暂无活动");
}
