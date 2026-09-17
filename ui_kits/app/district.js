// Gorgon — 上海区级地区筛选 (district filter).
//
// ONE module owns three things, so Discover / Search / Map / 智能 can never
// disagree with each other:
//
//   1. the Shanghai district vocabulary
//   2. how a free-form location string becomes a district ("上海市徐汇区" -> 徐汇)
//   3. which activities belong to the current selection
//
// The normaliser is a deliberate MIRROR of `pipeline/normalize/location.py`
// (the pipeline's own `normalize_district`). It is not a second, different
// idea of what a district is — the two are pinned together by a shared
// corpus in `pipeline/tests/fixtures/district_corpus.json`, which the Python
// suite AND the JS suite both assert against. If they ever drift, one of the
// two suites goes red instead of the UI quietly filtering on a different rule
// than the one the data was normalised with.
//
// Nothing here guesses: an unrecognised value stays as the trimmed input and
// simply belongs to no selectable district.

(function () {
  // Same list, same order as pipeline/normalize/location.py::DISTRICTS.
  var DISTRICTS = [
    "黄浦", "徐汇", "长宁", "静安", "普陀", "虹口", "杨浦",
    "闵行", "宝山", "嘉定", "浦东", "金山", "松江", "青浦",
    "奉贤", "崇明",
  ];

  // Same vocabulary as location.py::_CITIES, longest-first (matching order
  // matters: "北京市" must win over "北京").
  var CITIES = [
    "上海", "北京市", "北京", "杭州市", "杭州", "南京市", "南京",
    "深圳市", "深圳", "广州市", "广州",
  ];
  var CITY_PREFIXES = CITIES.slice().sort(function (a, b) { return b.length - a.length; });

  // The floor the product asks for. Every entry is a real Shanghai district
  // that occurs in the shipped dataset — the picker never offers a district
  // that exists nowhere in the data, and it never offers a non-Shanghai place.
  var BASELINE = [
    "徐汇", "浦东", "静安", "黄浦", "长宁", "杨浦", "闵行", "普陀", "虹口", "宝山",
  ];

  // The "no district chosen" selection. Kept as a literal string (not null) so
  // it round-trips through localStorage readably.
  var ALL = "全上海";
  var CITY_LABEL = "上海";

  /* ── normalisation ─────────────────────────────────────────────────── */

  function normalizeDistrict(text) {
    if (typeof text !== "string" || !text.trim()) return null;
    var t = text.replace(/\s+/g, "");

    // Drop a city prefix (with optional 市) if present.
    for (var i = 0; i < CITY_PREFIXES.length; i++) {
      var city = CITY_PREFIXES[i];
      if (t.indexOf(city) === 0) {
        t = t.slice(city.length);
        if (t.charAt(0) === "市") t = t.slice(1);
        break;
      }
    }

    // Split on separators and look for a known district token.
    var parts = t.split(/[·\-—\/，,]/);
    for (var p = 0; p < parts.length; p++) {
      var part = parts[p].trim();
      for (var d = 0; d < DISTRICTS.length; d++) {
        var name = DISTRICTS[d];
        if (part === name || part === name + "区" || (part === name + "新区" && name === "浦东")) {
          return name;
        }
      }
    }

    // Fallback: strip trailing 区/县 and accept if it matches a known district.
    var t2 = t.replace(/[区县]+$/, "");
    for (var k = 0; k < DISTRICTS.length; k++) {
      if (t2 === DISTRICTS[k]) return DISTRICTS[k];
      if (t2.indexOf(DISTRICTS[k]) === 0) return DISTRICTS[k];
    }
    return null;
  }

  /** Is this string a district we recognise as one of ours? */
  function isKnownDistrict(value) {
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
  function districtOf(rec) {
    if (!rec) return null;
    var raw = rec.district;
    if ((raw == null || raw === "") && rec.location) {
      var parts = String(rec.location).split("·");
      raw = parts.length > 1 ? parts[1] : "";
    }
    var d = normalizeDistrict(raw);
    if (d) return d;
    // The field was missing or unusable — the address may still say it.
    d = normalizeDistrict(rec.address) || normalizeDistrict(rec.location);
    if (d) return d;
    if (typeof raw === "string" && raw.trim()) return raw.trim();
    return null;
  }

  /* ── selection ─────────────────────────────────────────────────────── */

  function isAll(selected) {
    return !selected || selected === ALL;
  }

  function matches(rec, selected) {
    if (isAll(selected)) return true;
    return districtOf(rec) === selected;
  }

  function filter(list, selected) {
    var arr = list || [];
    if (isAll(selected)) return arr.slice();
    return arr.filter(function (r) { return matches(r, selected); });
  }

  /** "上海 · 徐汇" / "上海 · 全上海" — the one string every header shows. */
  function label(selected) {
    return CITY_LABEL + " · " + (isAll(selected) ? ALL : selected);
  }

  function shortLabel(selected) {
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
  function options(activities, selected) {
    var present = {};
    (activities || []).forEach(function (a) {
      var d = districtOf(a);
      if (d && isKnownDistrict(d)) present[d] = true;
    });

    var list = BASELINE.slice();
    DISTRICTS.forEach(function (d) {
      if (present[d] && list.indexOf(d) < 0) list.push(d);
    });
    if (!isAll(selected) && list.indexOf(selected) < 0) list.push(selected);
    return list;
  }

  /** district -> how many of these activities are in it (unknown ones dropped). */
  function counts(activities) {
    var out = {};
    (activities || []).forEach(function (a) {
      var d = districtOf(a);
      if (d) out[d] = (out[d] || 0) + 1;
    });
    return out;
  }

  /**
   * The empty-state headline. Honest about WHICH filter emptied the page:
   * district only -> "徐汇暂无活动"; district + keyword/free/分类 ->
   * "徐汇暂无符合条件的活动". Never falls back to other districts' data.
   */
  function emptyTitle(selected, hasOtherFilters) {
    if (isAll(selected)) {
      return hasOtherFilters ? "暂时没有符合条件的活动" : "暂时没有活动";
    }
    return selected + (hasOtherFilters ? "暂无符合条件的活动" : "暂无活动");
  }

  window.GorgonDistrict = {
    DISTRICTS: DISTRICTS,
    CITIES: CITIES,
    CITY_PREFIXES: CITY_PREFIXES,
    BASELINE: BASELINE,
    ALL: ALL,
    CITY_LABEL: CITY_LABEL,

    normalizeDistrict: normalizeDistrict,
    isKnownDistrict: isKnownDistrict,
    districtOf: districtOf,

    isAll: isAll,
    matches: matches,
    filter: filter,
    label: label,
    shortLabel: shortLabel,
    options: options,
    counts: counts,
    emptyTitle: emptyTitle,
  };
})();
