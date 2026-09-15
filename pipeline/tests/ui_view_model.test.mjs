// PHASE 5 — UI view-model tests (plain Node, no browser needed).
//
// `ui_kits/app/activity-view.js` is the one normaliser every surface uses
// (search results, detail page, Discover, My Weekend), so it is worth testing
// without a browser in the loop. It is loaded here into a minimal fake
// `window` and exercised directly.
//
// Run:  node pipeline/tests/ui_view_model.test.mjs
// Exits non-zero on the first failure.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import vm from "node:vm";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "..", "..", "ui_kits", "app", "activity-view.js");

let passed = 0;
const failures = [];

function ok(cond, label) {
  if (cond) { passed++; return; }
  failures.push(label);
  console.error("  ✗ " + label);
}

function eq(actual, expected, label) {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  if (!same) {
    console.error("  ✗ " + label + "\n      expected: " + JSON.stringify(expected) +
      "\n      actual:   " + JSON.stringify(actual));
    failures.push(label);
    return;
  }
  passed++;
}

// ── load the module into a fake window ────────────────────────────────────
const sandbox = {
  window: { location: { protocol: "http:" } },
  console,
};
vm.createContext(sandbox);
vm.runInContext(readFileSync(SRC, "utf8"), sandbox, { filename: "activity-view.js" });
const V = sandbox.window.GorgonActivityView;

ok(!!V, "GorgonActivityView is exported onto window");

// ── canonical pipeline shape ──────────────────────────────────────────────
const canonical = {
  id: "e1",
  title: "上海 AI Agent Builder Meetup",
  description: "面向开发者和创业者的 AI Agent 线下交流活动。",
  startDate: "2026-09-19",
  startTime: "14:00",
  endTime: "17:00",
  venue: "西岸美术馆",
  address: "上海市徐汇区龙腾大道2600号",
  district: "徐汇",
  city: "上海",
  priceType: "free",
  price: null,
  organizer: "AI Builder 社区",
  registrationUrl: "https://tickets.test/join",
  sourceUrl: "https://site.test/e",
  imageUrl: "https://cdn.test/hero.jpg",
  imageSource: "og:image",
  tags: ["AI", "Agent"],
  status: "approved",
  trustScore: 89,
  trustReasons: ["confirmed_by_multiple_sources"],
};

const cv = V.toView(canonical, {
  reasons: ["Agent 高匹配", "下午开始", "徐汇", "免费"],
  provenance: [
    { source: "活动行", title: "AI Agent Meetup · 上海站", url: "https://a.test/1", sourceTrust: "high" },
    { source: "公众号：AI前沿", title: "上海 AI Agent 线下沙龙", url: "https://b.test/2", sourceTrust: "high" },
  ],
  finalScore: 89,
  bucket: "approved",
  dataOrigin: "real",
});

eq(cv.title, "上海 AI Agent Builder Meetup", "canonical title preserved");
ok(cv.dateText && cv.dateText.includes("9月19日"), "ISO date becomes a readable label: " + cv.dateText);
ok(cv.dateText.includes("周六"), "weekday is derived from the real date: " + cv.dateText);
eq(cv.dayKey, "sat", "dayKey derived for the timeline");
eq(cv.timeText, "14:00–17:00", "time range rendered");
eq(cv.startMinutes, 14 * 60, "start time parsed to minutes");
eq(cv.district, "徐汇", "district preserved");
eq(cv.priceLabel, "免费", "free price labelled");
eq(cv.organizer, "AI Builder 社区", "organizer preserved");
eq(cv.trust, "confirmed", "approved + no conflict -> 已确认");
eq(cv.trustLabel, "已确认", "trust label is Chinese");
eq(cv.image.type, "remote", "real image is not a placeholder");
eq(cv.image.url, "https://cdn.test/hero.jpg", "real image URL preserved");
eq(cv.reasons.length, 4, "ranking reasons carried through");
eq(cv.sources.length, 2, "source names deduped");
eq(cv.provenance.length, 2, "provenance rows kept for the detail page");
eq(cv.finalScore, 89, "recommendation score carried through");
eq(cv.dataOrigin, "real", "data origin carried through");

// ── trust vocabulary ──────────────────────────────────────────────────────
eq(V.trustStatus({ status: "needs_review" }), "pending", "needs_review -> 待核验");
eq(V.trustStatus({ status: "approved", trustReasons: ["cross_source_conflict"] }), "conflict",
  "cross_source_conflict -> 存在冲突 even when the status says approved");
eq(V.trustStatus({ duplicateOf: "other" }), "conflict", "duplicate candidate -> 存在冲突");
eq(V.trustStatus({ status: "approved", trustReasons: [] }), "confirmed", "clean approved -> 已确认");
eq(V.trustLabel("conflict"), "存在冲突", "conflict label");
eq(V.trustLabel("pending"), "待核验", "pending label");

// ── image fallback ────────────────────────────────────────────────────────
const noImage = V.toView({ id: "e2", title: "上海 AI Hackathon", startDate: "2026-09-20" });
eq(noImage.image.type, "placeholder", "missing image -> placeholder, never a broken <img>");
ok(noImage.image.url.startsWith("/assets/placeholders/"), "placeholder lives in the shipped set");
ok(noImage.image.url.includes("hackathon"), "placeholder category matches the title: " + noImage.image.url);

const pipelinePlaceholder = V.toView({
  id: "e3", title: "X", imageUrl: "/assets/placeholders/meetup.svg", imageSource: "placeholder",
});
eq(pipelinePlaceholder.image.type, "placeholder", "pipeline placeholder is recognised");
ok(V.isPlaceholderUrl("/assets/placeholders/ai.svg"), "isPlaceholderUrl detects the shipped set");
ok(!V.isPlaceholderUrl("https://cdn.test/hero.jpg"), "isPlaceholderUrl rejects real art");

const demoShape = V.toView({
  id: "d1", title: "Demo", date: "周六 6.20", day: "sat", time: "19:00", end: "21:30",
  venue: "西岸智塔", district: "徐汇", location: "上海·徐汇", price: "免费",
  host: "Gorgon 社区", desc: "demo", tags: ["AI"], trust: "pipeline",
});
eq(demoShape.timeText, "19:00–21:30", "legacy demo record normalises too");
eq(demoShape.priceLabel, "免费", "legacy string price normalises");
eq(demoShape.organizer, "Gorgon 社区", "legacy host maps onto organizer");
eq(demoShape.trust, "confirmed", "legacy trust -> confirmed");

// ── time conflict ─────────────────────────────────────────────────────────
function v(id, dayKey, startTime, endTime) {
  return V.toView({
    id, title: "T" + id, day: dayKey, date: dayKey === "sat" ? "周六 9.19" : "周日 9.20",
    time: startTime, end: endTime,
  });
}

const overlap = V.conflictIds([v("a", "sat", "14:00", "17:00"), v("b", "sat", "16:00", "18:00")]);
eq(Object.keys(overlap).sort(), ["a", "b"], "overlapping activities are both flagged");

const apart = V.conflictIds([v("a", "sat", "14:00", "17:00"), v("b", "sat", "19:00", "21:00")]);
eq(Object.keys(apart), [], "non-overlapping activities are not flagged");

const crossDay = V.conflictIds([v("a", "sat", "14:00", "17:00"), v("b", "sun", "14:00", "17:00")]);
eq(Object.keys(crossDay), [], "same clock on different days is not a conflict");

const touching = V.conflictIds([v("a", "sat", "14:00", "17:00"), v("b", "sat", "17:00", "19:00")]);
eq(Object.keys(touching), [], "back-to-back is not a conflict");

const unknownTime = V.conflictIds([v("a", "sat", null, null), v("b", "sat", "14:00", "17:00")]);
eq(Object.keys(unknownTime), [], "an unknown time never invents a conflict");

eq(V.clockLabel(14 * 60), "14:00", "clockLabel pads correctly");
eq(V.clockLabel(null), "时间待定", "unknown time is labelled, not guessed: " + V.clockLabel(null));

// ── My Weekend snapshot round-trip ────────────────────────────────────────
// The app persists the whole view (not just the id), so it must survive JSON.
const restored = JSON.parse(JSON.stringify(cv));
eq(restored.id, cv.id, "snapshot survives a JSON round-trip");
eq(restored.title, cv.title, "snapshot keeps the title after a refresh");
eq(restored.dateText, cv.dateText, "snapshot keeps the date after a refresh");
eq(restored.image.url, cv.image.url, "snapshot keeps the image after a refresh");
eq(V.trustStatus(restored), "confirmed", "snapshot keeps its trust state");
const restoredConflicts = V.conflictIds([restored, V.toView({
  id: "e9", day: "sat", date: "周六 9.19", time: "16:00", end: "18:00", title: "Clash",
})]);
ok(restoredConflicts[restored.id], "a restored snapshot still participates in conflict detection");
ok(V.toView(restored).__view === true && restored.__view === true,
  "a restored view is recognised as a view (not re-normalised)");

// ── report ────────────────────────────────────────────────────────────────
console.log("\nUI view-model tests: " + passed + " passed, " + failures.length + " failed");
if (failures.length) {
  console.error("FAILED:");
  failures.forEach((f) => console.error("  - " + f));
  process.exit(1);
}
console.log("OK");
