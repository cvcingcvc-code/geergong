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
  // nested static server, or straight off the disk with no server at all.
  // The app always ships under <repo>/ui_kits/app/, so "../../" climbs back
  // to the repo root. Over HTTP the path is already absolute and is returned
  // untouched — this branch never produces a local-file URL.
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

  /* ── Plain text ───────────────────────────────────────────────────── */

  // Mirrors pipeline/search/textnorm.py. The pipeline already normalises a
  // fetched page, but this view also renders LEGACY records (data.js) and
  // VIEWS PERSISTED INTO localStorage, which never went through it — and a
  // Meetup body written by its organiser carries real Markdown. The rule is
  // the same in both places: strip the markup, keep every word the source
  // wrote. Never summarise, never rewrite.
  var ESCAPE_MAP = {
    "\\": "\\", "`": "`", "*": "*", "_": "_", "{": "{", "}": "}",
    "[": "[", "]": "]", "(": "(", ")": ")", "#": "#", "+": "+",
    "-": "-", ".": ".", "!": "!", ">": ">", "<": "<", "~": "~",
    "'": "'", '"': '"', "/": "/", "n": "\n", "r": "\r", "t": "\t",
  };

  function decodeEscapes(text) {
    return text.replace(/\\(.)/g, function (whole, ch) {
      return Object.prototype.hasOwnProperty.call(ESCAPE_MAP, ch) ? ESCAPE_MAP[ch] : whole;
    });
  }

  // Deliberately LOOKBEHIND-FREE. A syntax error inside `new RegExp` would
  // kill this whole module (and with it every screen), and lookbehind is
  // unavailable on older Safari.
  //
  // The left boundary is therefore matched as a character and re-emitted,
  // while the right boundary is a LOOKAHEAD (`(?=$|[^0-9A-Za-z_])`) so it is
  // never consumed — otherwise the boundary of one match would be eaten and
  // the next marker on the same line could never match. That keeps this
  // behaviourally identical to the lookaround version in textnorm.py, which
  // `pipeline/tests/fixtures/textnorm_corpus.json` pins down for both sides.
  var EMPHASIS_RULES = [
    // **bold** / __bold__ / *italic* / _italic_
    //
    // The inner group is written `([\s\S]*?\S)` — lazy, ending on a non-space
    // — and NOT `(\S(?:[\s\S]*?\S)?)`. The latter looks equivalent but its
    // greedy `?` makes the engine commit to the EXTENDED branch, so
    // `**a** **b**` matches as one bold run and the text degrades. Python's
    // `(.+?)(?<=\S)` takes the shortest, so this shape is what keeps the two
    // implementations in step.
    //
    // `\S`-anchored so "5 * 3" is left alone; ASCII boundary so "我们**每周**"
    // is still unwrapped (`\w` would match the CJK neighbours).
    [new RegExp("(^|[^0-9A-Za-z_])\\*\\*(?=\\S)([\\s\\S]*?\\S)\\*\\*(?=$|[^0-9A-Za-z_])", "g"), "$1$2"],
    [new RegExp("(^|[^0-9A-Za-z_])__(?=\\S)([\\s\\S]*?\\S)__(?=$|[^0-9A-Za-z_])", "g"), "$1$2"],
    // the italic guard excludes `*` on the left too, so a single `*` inside a
    // `**` run is never taken for a delimiter. Without it `a**b**c` would decay
    // into half-stripped `a*b*c`; with it the pair is refused here and the run
    // is removed wholesale by the leftover sweep below, yielding `abc`.
    // The closer carries the mirror-image `(?!\*)`, or else it eats the first
    // asterisk of a `**` run and abandons the second.
    [new RegExp("(^|[^0-9A-Za-z*])\\*([^*\\n]*?[^\\s*])\\*(?!\\*)(?=$|[^0-9A-Za-z_])", "g"), "$1$2"],
    [new RegExp("(^|[^0-9A-Za-z_])_([^_\\n]*?[^\\s_])_(?=$|[^0-9A-Za-z_])", "g"), "$1$2"],
  ];

  function stripInlineMarkup(text) {
    for (var i = 0; i < EMPHASIS_RULES.length; i++) {
      text = text.replace(EMPHASIS_RULES[i][0], EMPHASIS_RULES[i][1]);
    }
    return text;
  }

  function stripMarkup(text) {
    text = text
      .replace(/!\[[^\]\n]*\]\([^)\n]*\)/g, "")
      .replace(/\[([^\]\n]*)\]\([^)\n]*\)/g, "$1")
      .replace(/\[([^\]\n]+)\]\[[^\]\n]*\]/g, "$1")
      .replace(/^[ \t]{0,3}(?:```|~~~)[^\n]*$/gm, "")
      .replace(/^[ \t]{0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/gm, "")
      // A heading marker stranded mid-line: sources that store their body as one
      // long line leave `## What this event is about` inside a sentence, where
      // the line-anchored rule cannot see it. Two or more hashes only — `#1` is
      // how event titles say "number one".
      .replace(/(^|\s)#{2,6}[ \t]+/gm, "$1")
      .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "")
      .replace(/^[ \t]{0,3}>[ \t]?/gm, "")
      .replace(/`([^`\n]+)`/g, "$1")
      .replace(/~~(?=\S)([\s\S]*?\S)~~/g, "$1");
    text = stripInlineMarkup(text);
    // A LONE `*` in bullet position (`closes. *19:30`, `): *Item`) is the
    // organiser's own list marker, not content. Narrow on purpose: the star must
    // follow sentence punctuation or a line start, so `5 * 3` is never touched
    // and `group * 21:30` keeps its star (after a word, nothing distinguishes a
    // bullet from prose). `(?!\*)` stops it biting the first half of a `**` run.
    text = text.replace(/(^|[.。:;!?)\]）]|\n)[ \t]*\*(?!\*)[ \t]*/gm, "$1 ");
    // Safety net: the paired rules above refuse ambiguous delimiters on purpose
    // (they must not eat `snake_case` or `5 * 3`), but a `**` run still standing
    // after that is unambiguously a marker — refusing it is what produced
    // HALF-STRIPPED text. Single `*` / `_` are left alone.
    return text.replace(/\*{2,}/g, "").replace(/_{2,}/g, "");
  }

  function normalizeWhitespace(text, keepNewlines) {
    text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    if (keepNewlines) {
      text = text.replace(/[ \t\u00a0]+/g, " ")
                 .replace(/ *\n */g, "\n")
                 .replace(/\n{3,}/g, "\n\n");
    } else {
      text = text.replace(/\s+/g, " ");
    }
    return text.replace(/^\s+|\s+$/g, "");
  }

  var NOISE_ONLY = /^[\s*_~`#>=\-—.·]+$/;

  /** Source prose -> the text a reader should have seen. null when empty. */
  function plainText(value, limit, keepNewlines) {
    if (value == null) return null;
    var text = String(value);
    if (!text.replace(/\s+/g, "")) return null;
    text = normalizeWhitespace(stripMarkup(decodeEscapes(text)),
                               keepNewlines !== false);
    if (!text || NOISE_ONLY.test(text)) return null;
    if (limit && text.length > limit) text = text.slice(0, limit).replace(/\s+$/, "");
    return text || null;
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

  // trustReasons are the trust scorer's OWN rule names (pipeline/trust/scorer.py)
  // — a closed, finite vocabulary. On screen they must read as sentences,
  // because "cross_source_conflict" is a developer string, not information.
  // A rule that is not in this table is shown verbatim rather than silently
  // dropped: an unknown reason is still true, and hiding it would be a lie by
  // omission.
  var TRUST_REASON_LABEL = {
    // positive rules — the field was present / confirmed
    has_source_url: "已提供来源链接",
    has_registration_url: "已提供报名链接",
    has_organizer: "已标注主办方",
    has_explicit_date: "日期明确",
    has_explicit_time: "时间明确",
    has_venue: "场地明确",
    has_district_or_address: "位置信息完整",
    confirmed_by_multiple_sources: "多个来源互相印证",
    source_fields_complete: "来源字段较完整",
    // negative rules — something is missing or disagreed
    missing_date: "缺少具体日期",
    missing_place: "缺少地点信息",
    missing_source: "缺少来源链接",
    spammy_title: "标题含营销用语",
    invalid_time_range: "结束时间不晚于开始时间",
    time_conflict: "多个来源的开始时间不一致",
    cross_source_conflict: "多个来源信息存在冲突",
    location_conflict: "多个来源的场地不一致",
    price_conflict: "多个来源的价格不一致",
  };

  // Which rules are a caveat rather than a reassurance — the UI tints these.
  // Kept in step with TRUST_REASON_LABEL by test_trust_labels.py.
  var TRUST_REASON_RISK = {
    missing_date: 1, missing_place: 1, missing_source: 1, spammy_title: 1,
    invalid_time_range: 1, time_conflict: 1, cross_source_conflict: 1,
    location_conflict: 1, price_conflict: 1,
  };

  /** [{ code, label, risk }] — never a bare developer string on its own. */
  function trustReasonItems(rec) {
    var codes = [].concat((rec && rec.trustReasons) || []);
    var seen = {};
    var out = [];
    for (var i = 0; i < codes.length; i++) {
      var code = codes[i];
      if (typeof code !== "string" || !code || seen[code]) continue;
      seen[code] = 1;
      out.push({
        code: code,
        label: TRUST_REASON_LABEL[code] || code,
        risk: !!TRUST_REASON_RISK[code],
      });
    }
    // Caveats first: what a reader must double-check outranks what went well.
    return out.sort(function (a, b) { return (b.risk ? 1 : 0) - (a.risk ? 1 : 0); });
  }

  /**
   * A stored view can predate a field: My Weekend keeps whole views in
   * localStorage, so a snapshot saved by an older build has no
   * `trustReasonItems`. Backfill what is missing rather than re-deriving the
   * record — the stored values are what we showed the user, and re-running the
   * normaliser on them would be a different (and wrong) answer.
   *
   * Without this, opening a saved activity after an upgrade throws instead of
   * rendering.
   */
  function upgradeStoredView(view) {
    if (!view.trustReasonItems) view.trustReasonItems = trustReasonItems(view);
    if (view.rawDescription === undefined) {
      // Pre-upgrade snapshot: `description` holds the SOURCE's unfiltered text,
      // complete with whatever Markdown the organiser typed. Keep it as the raw
      // value and normalise the display copy — the same treatment a fresh
      // record gets.
      view.rawDescription = view.description || null;
      view.description = plainText(view.rawDescription, null, true);
    }
    if (view.hasDescription === undefined) view.hasDescription = !!view.description;
    // A snapshot written before the district normaliser existed can carry the
    // source's raw string ("上海市徐汇区"). Normalise it in place for the same
    // reason as the description — the UI prints one vocabulary, not two.
    if (view.district && window.GorgonDistrict) {
      var nd = window.GorgonDistrict.normalizeDistrict(view.district);
      if (nd) view.district = nd;
    }
    return view;
  }

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
    // The pipeline states the kind outright (`remote` | `thumbnail` |
    // `placeholder`); that declaration wins, the derivation below is only for
    // legacy records that predate it.
    var declared = rec.imageType || null;
    if (!explicit && rec.image) {
      if (typeof rec.image === "string") {
        explicit = rec.image;
      } else if (rec.image.url) {
        explicit = rec.image.url;
        source = source || rec.image.source || null;
        declared = declared || rec.image.type || null;
      }
    }
    // The category slug mirrors the pipeline's own choice, so the browser
    // fallback and the pipeline placeholder are the same artwork.
    var pick = slug || placeholderSlug([rec.category, rec.title, (rec.tags || []).join(" "), rec.description, rec.desc]);
    if (typeof explicit === "string" && explicit) {
      var isPlaceholder = declared === "placeholder" || source === "placeholder"
        || isPlaceholderUrl(explicit);
      return {
        url: resolveUrl(explicit),
        source: source || (isPlaceholder ? "placeholder" : "remote"),
        slug: pick,
        type: declared || (isPlaceholder ? "placeholder" : "remote"),
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
    // not double-transform the data — but a view saved by an older build may be
    // missing a field that newer screens read, so it is upgraded in place.
    if (rec.__view && !Object.keys(extra).length) return upgradeStoredView(rec);

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

    // The district goes through the SAME module the district filter uses, so
    // the value a card prints and the value the picker filters on are one and
    // the same ("上海市徐汇区" renders as 徐汇, and is found under 徐汇).
    // Falls back to the old naive split only if that module is not loaded.
    var districtMod = window.GorgonDistrict;
    var district = districtMod ? districtMod.districtOf(rec) : null;
    if (district == null) {
      district = rec.district || null;
      if (!district && rec.location) {
        district = String(rec.location).split("·")[1] || null;
      }
    }

    var city = rec.city || null;
    if (!city && rec.location) city = String(rec.location).split("·")[0] || null;

    var tagList = [].concat(rec.tags || []).filter(function (t) { return typeof t === "string" && t; });
    var title = plainText(rec.title, null, false) || "(无标题)";
    var slug = placeholderSlug([rec.category, title, tagList.join(" "), rec.description, rec.desc]);
    var price = priceOf(rec);
    var trust = trustStatus(rec);

    var startTime = rec.startTime || rec.time || null;
    var endTime = rec.endTime || rec.end || null;

    // The source's own prose, with its markup removed. `rawDescription` keeps
    // the untouched value for debugging; nothing renders it directly.
    var rawDescription = rec.description || rec.desc || null;
    var description = plainText(rawDescription, null, true);

    var sources = extra.sources || (extra.provenance || []).map(function (p) { return p.source; })
      .filter(function (s, i, arr) { return s && arr.indexOf(s) === i; });

    return {
      __view: true,
      id: rec.id,
      raw: rec,
      title: title,
      description: description,
      rawDescription: rawDescription,
      hasDescription: !!description,

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
      // Human-readable, caveats first. `trustReasons` stays for anything that
      // genuinely wants the raw rule names (the admin review tool does).
      trustReasons: [].concat(rec.trustReasons || []),
      trustReasonItems: trustReasonItems(rec),

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
    TRUST_REASON_LABEL: TRUST_REASON_LABEL,
    TRUST_REASON_RISK: TRUST_REASON_RISK,
    PLACEHOLDER_BASE: PLACEHOLDER_BASE,
    WEEKDAYS: WEEKDAYS,
    DAY_OF_KEY: DAY_OF_KEY,
    VIEW_DAY_ORDER: VIEW_DAY_ORDER,
    toView: toView,
    trustStatus: trustStatus,
    trustLabel: function (s) { return TRUST_LABEL[s] || TRUST_LABEL.pending; },
    trustTone: function (s) { return TRUST_TONE[s] || TRUST_TONE.pending; },
    trustReasonItems: trustReasonItems,
    plainText: plainText,
    stripMarkup: stripMarkup,
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
