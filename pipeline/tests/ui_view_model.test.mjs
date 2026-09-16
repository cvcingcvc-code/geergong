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

// The imageUrl/imageSource/imageType triple is a contract, so a stated kind
// wins over the one derived from the URL.
const listingThumb = V.toView({
  id: "e4", title: "行内列表活动", imageUrl: "https://cdn.test/t.jpg",
  imageSource: "thumbnail", imageType: "thumbnail",
});
eq(listingThumb.image.type, "thumbnail", "a declared thumbnail is not silently reported as remote");
eq(listingThumb.image.source, "thumbnail", "the stated source is kept");

const declaredPlaceholder = V.toView({
  id: "e5", title: "占位", imageUrl: "https://cdn.test/whatever.jpg",
  imageType: "placeholder",
});
eq(declaredPlaceholder.image.type, "placeholder", "a declared placeholder is honoured even off-set");
eq(declaredPlaceholder.image.source, "placeholder", "…and the source agrees, so the triple stays consistent");

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

// ── trust reasons read as sentences, not as developer strings ─────────────
// The scorer's rule names are the data contract (pipeline/trust/scorer.py);
// the UI must translate the whole closed vocabulary, because a screenshot
// showing "cross_source_conflict" is not information for a reader.
eq(cv.trustReasonItems.length, 1, "canonical record carries one trust reason");
eq(cv.trustReasonItems[0].code, "confirmed_by_multiple_sources", "raw code is still available for debugging");
eq(cv.trustReasonItems[0].label, "多个来源互相印证", "positive rule translated");
eq(cv.trustReasonItems[0].risk, false, "a reassurance is not a caveat");

const conflicted = V.toView({
  id: "c1", title: "冲突活动", status: "approved",
  trustReasons: ["has_explicit_date", "cross_source_conflict", "location_conflict"],
});
eq(conflicted.trust, "conflict", "a cross-source conflict still reads as 存在冲突");
eq(conflicted.trustReasonItems.map((r) => r.label),
  ["多个来源信息存在冲突", "多个来源的场地不一致", "日期明确"],
  "caveats are listed first, then the reassurances");
eq(conflicted.trustReasonItems[0].risk, true, "a caveat is flagged for the danger tint");

const unknownReason = V.toView({ id: "u1", trustReasons: ["some_future_rule"] });
eq(unknownReason.trustReasonItems[0].label, "some_future_rule",
  "an unrecognised rule is shown verbatim, never silently dropped");

const dupReason = V.toView({ id: "u2", trustReasons: ["has_venue", "has_venue"] });
eq(dupReason.trustReasonItems.length, 1, "duplicate rules collapse to one line");

// Exact coverage of the scorer's vocabulary is asserted on the Python side
// (pipeline/tests/test_trust_labels.py derives it from scorer.py); here we only
// guard that the table still exists and is populated.
ok(Object.keys(V.TRUST_REASON_LABEL).length >= 18, "the trust-reason table is populated");
ok(V.trustReasonItems({}).length === 0, "no reasons -> no block");
ok(V.trustReasonItems(null).length === 0, "missing record is tolerated");

// ── source prose: Markdown is markup, not content ─────────────────────────
// A Meetup body is written in Markdown and reached the detail page verbatim.
const markdown = V.toView({
  id: "m1",
  title: "**Bringing Dubai AI** 上海站",
  description: "**Bringing Dubai AI to Shanghai**\n\n我们每周六 19:30 线下聚会\n\n---\n\n报名见 [官网](https://x.test/a)。",
});
eq(markdown.title, "Bringing Dubai AI 上海站", "a bold title renders without its asterisks");
ok(markdown.description.includes("Bringing Dubai AI to Shanghai"), "the sentence survives");
ok(!markdown.description.includes("**"), "no emphasis markers reach the page");
ok(!markdown.description.includes("]("), "no link syntax reaches the page");
ok(markdown.description.includes("官网"), "link TEXT is kept — only the syntax is dropped");
ok(markdown.description.includes("\n"), "paragraph breaks survive for pre-wrap rendering");

const escaped = V.toView({
  id: "m2",
  description: String.raw`\*\*Bringing Dubai AI\*\*\n我们每周六 19:30 线下聚会`,
});
eq(escaped.description, "Bringing Dubai AI\n我们每周六 19:30 线下聚会",
  "a double-escaped body is decoded and unwrapped in one pass");

const markupOnly = V.toView({ id: "m3", description: "**" });
eq(markupOnly.description, null, "a field that is nothing but markup counts as missing");
eq(markupOnly.hasDescription, false, "…and the detail page shows its honest empty state");
eq(markupOnly.rawDescription, "**", "the untouched value is retained for debugging");

const plainProse = V.toView({ id: "m4", description: "面向开发者与产品经理的 Agent 线下交流，含现场 Demo。" });
eq(plainProse.description, "面向开发者与产品经理的 Agent 线下交流，含现场 Demo。",
  "ordinary prose passes through untouched");
eq(V.plainText("票价 5 * 3 = 15 * 2"), "票价 5 * 3 = 15 * 2", "multiplication is not emphasis");
eq(V.plainText("调用 get_user_name 方法"), "调用 get_user_name 方法", "snake_case survives");
eq(V.plainText(null), null, "missing prose stays missing");
eq(V.plainText("   "), null, "blank prose stays missing");
eq(V.plainText(V.plainText("## 标题\n**粗体** 和 [链接](https://x.test)")),
  V.plainText("## 标题\n**粗体** 和 [链接](https://x.test)"), "the normaliser is idempotent");

// ── shared corpus: the JS twin must match textnorm.py exactly ──────────────
// `activity-view.js` re-implements the normaliser because it also renders
// legacy records and localStorage-persisted views that never passed through
// the pipeline. pipeline/tests/test_textnorm.py asserts the SAME file, so a
// rule added to one side fails on the other.
const CORPUS = JSON.parse(readFileSync(
  resolve(HERE, "fixtures", "textnorm_corpus.json"), "utf8"));
ok(CORPUS.cases.length > 0, "shared corpus is present and non-empty");
for (const c of CORPUS.cases) {
  eq(V.plainText(c.input, null, c.keepNewlines), c.expected, "corpus: " + c.why);
}

// ── a view saved by an older build still opens ────────────────────────────
// My Weekend keeps whole views in localStorage, so a snapshot written before
// `trustReasonItems` existed is a real thing to encounter after an upgrade.
// Without the in-place upgrade the detail page throws instead of rendering.
const legacySnapshot = {
  __view: true, id: "old1", title: "旧快照",
  description: "**Bringing Dubai AI**\n我们每周六 19:30 线下聚会",
  trustReasons: ["has_venue", "cross_source_conflict"],
};
ok(legacySnapshot.trustReasonItems === undefined, "the fixture really lacks the field");
const upgraded = V.toView(legacySnapshot);
ok(upgraded === legacySnapshot, "an old snapshot is upgraded in place, not re-derived");
eq(upgraded.trustReasonItems.map((r) => r.label),
  ["多个来源信息存在冲突", "场地明确"], "the backfilled reasons are translated");
eq(upgraded.hasDescription, true, "hasDescription is backfilled");
eq(upgraded.description, "Bringing Dubai AI\n我们每周六 19:30 线下聚会",
  "an old snapshot's Markdown is normalised too, so it cannot leak either");
eq(upgraded.rawDescription, "**Bringing Dubai AI**\n我们每周六 19:30 线下聚会",
  "the source's own text is preserved as the raw value");
eq(V.toView(upgraded).trustReasonItems.length, 2, "upgrading twice changes nothing");

// A snapshot with no reasons at all is still safe to render.
const bareSnapshot = V.toView({ __view: true, id: "old2", title: "空快照" });
eq(bareSnapshot.trustReasonItems, [], "a view with no reasons backfills to an empty list");
eq(bareSnapshot.hasDescription, false, "a view with no description backfills honestly");

// ── report ────────────────────────────────────────────────────────────────
console.log("\nUI view-model tests: " + passed + " passed, " + failures.length + " failed");
if (failures.length) {
  console.error("FAILED:");
  failures.forEach((f) => console.error("  - " + f));
  process.exit(1);
}
console.log("OK");
