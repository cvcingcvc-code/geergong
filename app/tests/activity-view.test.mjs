// Gorgon V1 — activity view-model tests (migrated coverage).
//
// Asserts the MIGRATED module (app/src/lib/activity-view.js) on the same
// behaviours the legacy suite pins down in
// pipeline/tests/ui_view_model.test.mjs, INCLUDING the shared textnorm
// corpus that also guards pipeline/search/textnorm.py — the ES-module port
// must produce byte-identical normalisation.
//
// Run: node --test tests/   (from app/)

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import * as V from "../src/lib/activity-view.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const CORPUS = JSON.parse(readFileSync(
  resolve(HERE, "..", "..", "pipeline", "tests", "fixtures", "textnorm_corpus.json"), "utf8"));

test("plainText: every shared-corpus case (pins JS to textnorm.py)", (t) => {
  for (const c of CORPUS.cases) {
    assert.equal(V.plainText(c.input, null, c.keepNewlines), c.expected,
      `case: ${c.why || c.input}`);
  }
});

test("plainText: null / empty / noise-only inputs", () => {
  assert.equal(V.plainText(null), null);
  assert.equal(V.plainText(""), null);
  assert.equal(V.plainText("   \n  "), null);
  assert.equal(V.plainText("* * *"), null);
  assert.equal(V.plainText("5 * 3", null, false), "5 * 3", "multiplication must survive");
});

test("minutesOf / clockLabel", () => {
  assert.equal(V.minutesOf("14:00"), 840);
  assert.equal(V.minutesOf("9：05"), 545);
  assert.equal(V.minutesOf("下午"), null);
  assert.equal(V.minutesOf(null), null);
  assert.equal(V.clockLabel(840), "14:00");
  assert.equal(V.clockLabel(545), "09:05");
  assert.equal(V.clockLabel(null), "时间待定");
  assert.equal(V.clockLabel(24 * 60), "时间待定");
});

test("toView: legacy demo record shape", () => {
  const v = V.toView({
    id: "d01", title: "AI 产品开放日", category: "ai",
    date: "周六 6.20", day: "sat", time: "19:00", end: "21:30",
    location: "上海·徐汇", district: "徐汇", venue: "西岸智塔",
    price: "免费", host: "Gorgon 社区", desc: "**每周六** 线下聚会", tags: ["AI"],
  });
  assert.equal(v.__view, true);
  assert.equal(v.id, "d01");
  assert.equal(v.dateText, "周六 6.20");
  assert.equal(v.dayKey, "sat");
  assert.equal(v.timeText, "19:00–21:30");
  assert.equal(v.startMinutes, 1140);
  assert.equal(v.endMinutes, 1290);
  assert.equal(v.district, "徐汇");
  assert.equal(v.city, "上海");
  assert.equal(v.priceLabel, "免费");
  assert.equal(v.priceType, "free");
  assert.equal(v.organizer, "Gorgon 社区");
  assert.equal(v.description, "每周六 线下聚会", "markdown stripped");
  assert.equal(v.rawDescription, "**每周六** 线下聚会");
  assert.equal(v.image.type, "placeholder");
  // slug comes from ALL texts (category+title+tags+desc) and "线下聚会"
  // matches the meetup keywords before "ai" is reached — same behaviour as
  // the legacy module and the pipeline's placeholders.py.
  assert.equal(v.image.url, "/assets/placeholders/meetup.svg");
});

test("toView: canonical pipeline record shape", () => {
  const v = V.toView({
    id: "r1", title: "Agent Meetup", startDate: "2026-09-19",
    startTime: "14:00", endTime: "17:00", venue: "某空间",
    district: "上海市徐汇区", priceType: "paid", price: 50,
    organizer: "Meetup 组", trustScore: 72, status: "approved",
    trustReasons: ["missing_source", "has_venue"],
    registrationUrl: "https://example.com/reg", sourceUrl: "https://example.com/src",
    imageUrl: "https://example.com/x.jpg",
  });
  assert.equal(v.dateText, "9月19日 · 周六");
  assert.equal(v.dayKey, "sat");
  assert.equal(v.district, "徐汇", "district normalised through the shared module");
  assert.equal(v.priceLabel, "¥50");
  assert.equal(v.priceType, "paid");
  assert.equal(v.trust, "confirmed");
  assert.equal(v.trustLabel, "已确认");
  assert.equal(v.trustScore, 72);
  assert.equal(v.registrationUrl, "https://example.com/reg");
  assert.equal(v.image.type, "remote");
  // caveats sort first
  assert.equal(v.trustReasonItems[0].code, "missing_source");
  assert.equal(v.trustReasonItems[0].risk, true);
  assert.equal(v.trustReasonItems[0].label, "缺少来源链接");
});

test("toView: never invents missing values", () => {
  const v = V.toView({ id: "x", title: " minimal " });
  assert.equal(v.venue, null);
  assert.equal(v.address, null);
  assert.equal(v.registrationUrl, null);
  assert.equal(v.sourceUrl, null);
  assert.equal(v.organizer, null);
  assert.equal(v.trustScore, null);
  assert.equal(v.description, null);
  assert.equal(v.hasDescription, false);
  assert.equal(v.trust, "pending");
  assert.deepEqual(v.reasons, []);
  assert.deepEqual(v.provenance, []);
});

test("toView: trust vocabulary (conflict rules)", () => {
  assert.equal(V.toView({ trustReasons: ["cross_source_conflict"] }).trust, "conflict");
  assert.equal(V.toView({ duplicateOf: "other-id" }).trust, "conflict");
  assert.equal(V.toView({ status: "needs_review" }).trust, "pending");
  assert.equal(V.toView({ trust: "verified" }).trust, "confirmed");
  // stored UI vocabulary wins as-is
  assert.equal(V.toView({ trustStatus: "pending", status: "approved" }).trust, "pending");
});

test("toView: idempotent on stored views and upgrades old snapshots", () => {
  const once = V.toView({ id: "s1", title: "T", district: "上海市浦东区", desc: "**bold**" });
  const twice = V.toView(once);
  assert.equal(twice, once, "same object back, no double transform");
  // snapshot written by an older build (no trustReasonItems/rawDescription)
  const old = { __view: true, id: "s2", title: "Old", description: "**raw** md", district: "上海市静安区" };
  const upgraded = V.toView(old);
  assert.ok(Array.isArray(upgraded.trustReasonItems));
  assert.equal(upgraded.description, "raw md");
  assert.equal(upgraded.rawDescription, "**raw** md");
  assert.equal(upgraded.district, "静安");
});

test("toView: extra search metadata passes through", () => {
  const v = V.toView({ id: "e1", title: "E" }, {
    reasons: ["AI 主题高度匹配"], finalScore: 88, bucket: "approved",
    dataOrigin: "real", provenance: [{ source: "meetup" }, { source: "meetup" }, { source: "douban" }],
  });
  assert.equal(v.finalScore, 88);
  assert.equal(v.bucket, "approved");
  assert.equal(v.dataOrigin, "real");
  assert.deepEqual(v.reasons, ["AI 主题高度匹配"]);
  assert.deepEqual(v.sources, ["meetup", "douban"], "deduped, order kept");
  assert.equal(v.provenance.length, 3);
});

test("conflictIds: same-day overlap flagged, cross-day never", () => {
  const mk = (id, dayKey, s, e) => V.toView({
    id, title: id, day: dayKey, time: s, end: e,
  });
  const a = mk("a", "sat", "14:00", "16:00");
  const b = mk("b", "sat", "15:00", "17:00");
  const c = mk("c", "sat", "17:00", "18:00");
  const d = mk("d", "sun", "14:00", "16:00");
  const flagged = V.conflictIds([a, b, c, d]);
  assert.equal(flagged.a, true);
  assert.equal(flagged.b, true);
  assert.equal(flagged.c, undefined, "touching endpoints do not overlap");
  assert.equal(flagged.d, undefined, "different day never conflicts");
  // naive times never invent a conflict
  const naive = V.conflictIds([mk("e", "sat", null, null), a]);
  assert.equal(naive.e, undefined);
});

test("trustReasonItems: dedupe, unknown codes shown verbatim, risk sort", () => {
  const items = V.trustReasonItems({ trustReasons: [
    "has_venue", "missing_date", "has_venue", "brand_new_rule",
  ] });
  assert.equal(items.length, 3);
  assert.equal(items[0].code, "missing_date", "risk first");
  assert.equal(items.filter((i) => i.code === "has_venue").length, 1);
  const unknown = items.find((i) => i.code === "brand_new_rule");
  assert.equal(unknown.label, "brand_new_rule", "unknown reason is shown, not hidden");
  assert.equal(unknown.risk, false);
});
