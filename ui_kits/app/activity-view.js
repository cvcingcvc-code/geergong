// Gorgon — Activity view model (PHASE 5).
//
// The app renders activities that arrive in TWO shapes:
//
//   1. Canonical pipeline / search-result shape
//      { startDate:"2026-09-19", startTime:"14:00", endTime:"17:00",
//        venue, address, district, city, priceType, price, organizer,
//        description, imageUrl, imageSource, tags, trustScore, status,
//        trustReasons, registrationUrl, sourceUrl, agenda[] }
//
//   2. Legacy Gorgon UI record (data.js / generated-data.js)
//      { date:"周六 6.20", day:"sat", time, end, location, district, venue,
//        distance, address, coord, price:"免费", host, desc, image, tags,
//        trust, source, registrationUrl, sourceUrl, ... }
//
// Rather than teach every screen about both, this module normalises either
// one into ONE view model. Everything derived here is derived — nothing is
// invented: a missing value stays null and the UI renders "待定" / hides the
// block, it never guesses.
//
// Trust status is the only vocabulary the UI uses:
//   已确认 (confirmed) · 待核验 (pending) · 存在冲突 (conflict)

(function () {
  var TRUST_LABEL = { confirmed: "已确认", pending: "待核验", conflict: "存在冲突" };
  var TRUST_TONE = { confirmed: "mint", pending: "warning", conflict: "danger" };

  var WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  var DAY_OF_KEY = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

  // Category placeholder slugs shipped in assets/placeholders/*.svg.
  // Mirrors pipeline/search/placeholders.py so the browser fallback is the
  // SAME artwork the pipeline would have picked.
  var PLACEHOLDER_KEYWORDS = [
    ["hackathon", ["hackathon", "黑客松", "hack", "编程马拉松"]],
    ["demoday", ["demo day", "demoday", "路演", "demo night", "展示日"]],
    ["vibecoding", ["vibe coding", "vibecoding", "vibe-coding"]],
    ["agent", ["agent", "智能体", "llm", "大模型", "rag", "mcp"]],
    ["meetup", ["meetup", "沙龙", "交流", "线下聚会", "networking"]],
    ["workshop", ["workshop", "工作坊", "训练营", "bootcamp", "课程"]],
    ["exhibition", ["展览", "展", "expo", "博览会", "艺术"]],
    ["startup", ["创业", "投资", "融资", "startup", "vc"]],
    ["talk", ["分享", "讲座", "talk", "论坛", "峰会", "summit"]],
    ["party", ["派对", "party", "市集", "音乐"]],
    ["sports", ["运动", "跑步", "骑行", "球", "瑜伽", "户外"]],
    ["ai", ["ai", "人工智能", "机器学习", "深度学习", "算法", "科技"]],
  ];
  var PLACEHOLDER_BASE = "/assets/placeholders/";

  // Server-root paths must be resolvable even when the app is opened from a
  // nested static server (or file://). The app always ships under
  // <repo>/ui_kits/app/, so "../../" climbs back to the repo root.
  function resolveUrl(url) {
    if (!url) return null;
    if (/^(https?:|data:|blob:)/i.test(url)) return url;
    if (url.charAt(0) === "/") {
      var proto = (window.location && window.location.protocol) || "";
      if (proto === "file:") return "../../" + url.replace(/^\/+/, "");
      return url;
    }
    return url;
  }

  function isPlaceholderUrl(url) {
    return !!url && String(url).indexOf(PLACEHOLDER_BASE) >= 0;
  }

  function placeholderSlug(texts) {
    var hay = (texts || []).filter(Boolean).join(" ").toLowerCase();
    if (!hay) return "default";
    for (var i = 0; i < PLACEHOLDER_KEYWORDS.length; i++) {
      var words = PLACEHOLDER_KEYWORDS[i][1];
      for (var j = 0; j < words.length; j++) {
        if (hay.indexOf(words[j]) >= 0) return PLACEHOLDER_KEYWORDS[i][0];
      }
    }
    return "default";
  }

  function toInt(v) {
    var n = parseInt(v, 10);
    return isNaN(n) ? null : n;
  }

  /** "14:00" -> 840 (minutes since midnight). null when unparseable. */
  function minutesOf(t) {
    if (t == null) return null;
    var m = /(\d{1,2})\s*[:：]\s*(\d{2})/.exec(String(t));
    if (!m) return null;
    return toInt(m[1]) * 60 + toInt(m[2]);
  }

  /** "2026-09-19" -> Date (local midnight). null when unparseable. */
  function parseIso(iso) {
    if (!iso) return null;
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(iso));
    if (!m) return null;
    return new Date(toInt(m[1]), toInt(m[2]) - 1, toInt(m[3]));
  }

  /** "周六 6.20" / "9月20日 周日" -> { month, day, weekday } (best effort). */
  function parseLooseDate(text) {
    if (!text) return null;
    var s = String(text);
    var out = {};
    var wd = /周([一二三四五六日天])/.exec(s);
    if (wd) out.weekday = "周" + (wd[1] === "天" ? "日" : wd[1]);
    var md = /(\d{1,2})\s*[.月]\s*(\d{1,2})/.exec(s);
    if (md) { out.month = toInt(md[1]); out.day = toInt(md[2]); }
    return (out.month || out.weekday) ? out : null;
  }

  function weekdayCn(dateObj) {
    return dateObj ? WEEKDAYS[dateObj.getDay()] : null;
  }

  function weekdayKeyOf(dateObj) {
    if (!dateObj) return null;
    return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][dateObj.getDay()];
  }

  function dateLabelOf(dateObj, fallback) {
    if (dateObj) {
      return (dateObj.getMonth() + 1) + "月" + dateObj.getDate() + "日 · " + weekdayCn(dateObj);
    }
    return fallback || null;
  }

  /* ── Trust ────────────────────────────────────────────────────────── */

  function trustStatus(rec) {
    if (!rec) return "pending";
    // Already in the UI's own vocabulary (a stored view, or an explicit
    // override from the pipeline) — trust it as-is.
    if (rec.trustStatus && TRUST_LABEL[rec.trustStatus]) return rec.trustStatus;
    if (rec.trust && TRUST_LABEL[rec.trust]) return rec.trust;
    var reasons = rec.trustReasons || [];
    if (reasons.indexOf("cross_source_conflict") >= 0) return "conflict";
    if (rec.duplicateOf) return "conflict";
    if (rec.status === "approved") return "confirmed";
    if (rec.status === "needs_review" || rec.status === "rejected") return "pending";
    if (rec.trust === "verified" || rec.trust === "official") return "confirmed";
    if (rec.trust === "pipeline" || rec.trust === "aggregated") return "confirmed";
    return "pending";
  }

  /* ── Price ────────────────────────────────────────────────────────── */

  function priceOf(rec) {
    if (rec.priceType === "free") return { label: "免费", type: "free" };
    if (rec.priceType === "paid" && rec.price != null) {
      return { label: "¥" + rec.price, type: "paid" };
    }
    if (typeof rec.price === "string" && rec.price) {
      var type = /免费|free/i.test(rec.price) ? "free" : "paid";
      return { label: rec.price, type: type };
    }
    return { label: "价格待定", type: "unknown" };
  }

  /* ── Image ────────────────────────────────────────────────────────── */

  function imageOf(rec, slug) {
    // `rec.image` may already be a normalised image descriptor (a stored
    // view), a plain URL string, or absent — handle all three.
    var explicit = rec.imageUrl || null;
    var source = rec.imageSource || null;
    if (!explicit && rec.image) {
      if (typeof rec.image === "string") {
        explicit = rec.image;
      } else if (rec.image.url) {
        explicit = rec.image.url;
        source = source || rec.image.source || null;
      }
    }
    // The category slug mirrors the pipeline's own choice, so the browser
    // fallback and the pipeline placeholder are the same artwork.
    var pick = slug || placeholderSlug([rec.category, rec.title, (rec.tags || []).join(" "), rec.description, rec.desc]);
    if (typeof explicit === "string" && explicit) {
      return {
        url: resolveUrl(explicit),
        source: source || "remote",
        slug: pick,
        type: source === "placeholder" || isPlaceholderUrl(explicit) ? "placeholder" : "remote",
      };
    }
    // No URL at all: fall back to the category placeholder, clearly labelled.
    return {
      url: PLACEHOLDER_BASE + pick + ".svg",
      source: "placeholder",
      slug: pick,
      type: "placeholder",
    };
  }

  /* ── Main normaliser ──────────────────────────────────────────────── */

  /**
   * rec: an activity in either shape.
   * extra: optional { reasons, sources, provenance, finalScore, bucket,
   *                   dataOrigin, query } supplied by a search result.
   */
  function toView(rec, extra) {
    rec = rec || {};
    extra = extra || {};
    // Idempotent: normalising a normalised view is a no-op. This matters
    // because My Weekend persists views, and anything that re-reads them must
    // not double-transform the data.
    if (rec.__view && !Object.keys(extra).length) return rec;

    var dateObj = parseIso(rec.startDate);
    var loose = parseLooseDate(rec.date);
    var dayKey = rec.day || weekdayKeyOf(dateObj) || null;
    var weekday = weekdayCn(dateObj) || (loose && loose.weekday) || null;

    // A readable date string. Prefer the ISO date; fall back to whatever the
    // demo record carried (already human-readable).
    var dateText = null;
    if (dateObj) {
      dateText = (dateObj.getMonth() + 1) + "月" + dateObj.getDate() + "日" + (weekday ? " · " + weekday : "");
    } else if (rec.date) {
      dateText = rec.date;
    }

    var district = rec.district || null;
    if (!district && rec.location) {
      var parts = String(rec.location).split("·");
      district = parts[1] || null;
    }

    var city = rec.city || null;
    if (!city && rec.location) city = String(rec.location).split("·")[0] || null;

    var tagList = [].concat(rec.tags || []).filter(function (t) { return typeof t === "string" && t; });
    var title = rec.title || "(无标题)";
    var slug = placeholderSlug([rec.category, title, tagList.join(" "), rec.description, rec.desc]);
    var price = priceOf(rec);
    var trust = trustStatus(rec);

    var startTime = rec.startTime || rec.time || null;
    var endTime = rec.endTime || rec.end || null;

    var sources = extra.sources || (extra.provenance || []).map(function (p) { return p.source; })
      .filter(function (s, i, arr) { return s && arr.indexOf(s) === i; });

    return {
      __view: true,
      id: rec.id,
      raw: rec,
      title: title,
      description: rec.description || rec.desc || null,

      // when
      startDate: rec.startDate || null,
      dateText: dateText,
      weekday: weekday,
      dayKey: dayKey,
      startTime: startTime,
      endTime: endTime,
      timeText: startTime && endTime ? startTime + "–" + endTime : (startTime || null),
      startMinutes: minutesOf(startTime),
      endMinutes: minutesOf(endTime),

      // where
      venue: rec.venue && rec.venue !== "地点待定" ? rec.venue : null,
      address: rec.address || null,
      district: district,
      city: city,
      locationText: [city, district].filter(Boolean).join(" · ") || null,
      coord: rec.coord || null,
      distance: rec.distance || null,

      // what
      priceLabel: price.label,
      priceType: price.type,
      organizer: rec.organizer || (rec.host && rec.host !== "主办方待确认" ? rec.host : null),
      tags: tagList,
      category: rec.category || null,

      // links — never invented: null when the source did not publish one
      registrationUrl: resolveUrl(rec.registrationUrl) || null,
      sourceUrl: resolveUrl(rec.sourceUrl) || null,

      // trust
      trust: trust,
      trustLabel: TRUST_LABEL[trust],
      trustTone: TRUST_TONE[trust],
      trustScore: rec.trustScore != null ? rec.trustScore : null,
      trustReasons: [].concat(rec.trustReasons || []),

      // media
      image: imageOf(rec, slug),

      // search-only extras
      finalScore: extra.finalScore != null ? extra.finalScore : null,
      reasons: [].concat(extra.reasons || []),
      sources: sources || [],
      provenance: [].concat(extra.provenance || []),
      bucket: extra.bucket || null,
      dataOrigin: extra.dataOrigin || null,

      agenda: [].concat(rec.agenda || []),
      demo: !!rec.demo,
    };
  }

  /* ── Timeline helpers (My Weekend) ────────────────────────────────── */

  function slotOf(view) {
    var s = view.startMinutes != null ? view.startMinutes : 24 * 60;
    var e = view.endMinutes != null ? view.endMinutes : s + 60;
    return { start: s, end: e };
  }

  /** Ids of activities whose time ranges overlap within the same day. */
  function conflictIds(views) {
    var flagged = {};
    var list = (views || []).slice().sort(function (a, b) {
      return slotOf(a).start - slotOf(b).start;
    });
    for (var i = 0; i < list.length; i++) {
      for (var j = i + 1; j < list.length; j++) {
        if (list[i].dayKey !== list[j].dayKey) continue;
        var A = slotOf(list[i]);
        var B = slotOf(list[j]);
        if (A.start < B.end && B.start < A.end) {
          flagged[list[i].id] = true;
          flagged[list[j].id] = true;
        }
      }
    }
    return flagged;
  }

  /** "14:00" style label for a minutes value. */
  function clockLabel(minutes) {
    if (minutes == null || minutes >= 24 * 60) return "时间待定";
    var h = Math.floor(minutes / 60);
    var m = minutes % 60;
    return (h < 10 ? "0" + h : "" + h) + ":" + (m < 10 ? "0" + m : "" + m);
  }

  var VIEW_DAY_ORDER = { sat: 0, sun: 1, tbd: 2 };

  window.GorgonActivityView = {
    TRUST_LABEL: TRUST_LABEL,
    TRUST_TONE: TRUST_TONE,
    PLACEHOLDER_BASE: PLACEHOLDER_BASE,
    WEEKDAYS: WEEKDAYS,
    DAY_OF_KEY: DAY_OF_KEY,
    VIEW_DAY_ORDER: VIEW_DAY_ORDER,
    toView: toView,
    trustStatus: trustStatus,
    trustLabel: function (s) { return TRUST_LABEL[s] || TRUST_LABEL.pending; },
    trustTone: function (s) { return TRUST_TONE[s] || TRUST_TONE.pending; },
    resolveUrl: resolveUrl,
    isPlaceholderUrl: isPlaceholderUrl,
    placeholderSlug: placeholderSlug,
    minutesOf: minutesOf,
    clockLabel: clockLabel,
    parseIso: parseIso,
    dateLabelOf: dateLabelOf,
    slotOf: slotOf,
    conflictIds: conflictIds,
  };
})();
