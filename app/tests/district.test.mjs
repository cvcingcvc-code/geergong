// Gorgon V1 — district module tests (migrated from pipeline/tests/district.test.mjs).
//
// Asserts the MIGRATED module (app/src/lib/district.js) against the same
// shared corpus the pipeline and the legacy frontend are pinned to, so the
// ES-module port can never drift from pipeline/normalize/location.py.
//
// Run: node --test tests/   (from app/)

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import * as D from "../src/lib/district.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const CORPUS = JSON.parse(readFileSync(
  resolve(HERE, "..", "..", "pipeline", "tests", "fixtures", "district_corpus.json"), "utf8"));

test("vocabulary matches the shared corpus", () => {
  assert.deepEqual(D.DISTRICTS, CORPUS.districts);
  assert.deepEqual(D.CITIES, CORPUS.cities);
});

test("normalizeDistrict: every corpus case", (t) => {
  for (const c of CORPUS.cases) {
    assert.equal(D.normalizeDistrict(c.input), c.expected,
      `normalizeDistrict(${JSON.stringify(c.input)}) — ${c.why || ""}`);
  }
});

test("isKnownDistrict / isAll", () => {
  assert.equal(D.isKnownDistrict("徐汇"), true);
  assert.equal(D.isKnownDistrict("朝阳区"), false);
  assert.equal(D.isKnownDistrict(""), false);
  assert.equal(D.isAll(null), true);
  assert.equal(D.isAll(""), true);
  assert.equal(D.isAll("全上海"), true);
  assert.equal(D.isAll("徐汇"), false);
});

test("districtOf: raw record shapes", () => {
  assert.equal(D.districtOf({ district: "上海市徐汇区" }), "徐汇");
  assert.equal(D.districtOf({ location: "上海·浦东" }), "浦东");
  assert.equal(D.districtOf({ address: "上海市静安区南京西路 100 号" }), "静安");
  assert.equal(D.districtOf({ district: "火星开发区" }), "火星开发区"); // honest passthrough
  assert.equal(D.districtOf(null), null);
  assert.equal(D.districtOf({}), null);
});

test("filter / matches: AND semantics, no fallback to other districts", () => {
  const list = [
    { id: "a", district: "徐汇" },
    { id: "b", district: "浦东" },
    { id: "c", location: "上海·徐汇" },
    { id: "d", district: "未知之地" },
  ];
  assert.deepEqual(D.filter(list, D.ALL).map((x) => x.id), ["a", "b", "c", "d"]);
  assert.deepEqual(D.filter(list, "徐汇").map((x) => x.id), ["a", "c"]);
  assert.deepEqual(D.filter(list, "静安").map((x) => x.id), []);
  assert.equal(D.matches(list[0], "徐汇"), true);
  assert.equal(D.matches(list[0], D.ALL), true);
});

test("options: baseline ∪ present ∪ current selection", () => {
  const acts = [{ district: "嘉定" }, { district: "徐汇" }, { district: "外星" }];
  const opts = D.options(acts, "嘉定");
  assert.ok(opts.indexOf("徐汇") >= 0, "baseline present");
  assert.ok(opts.indexOf("嘉定") >= 0, "dataset district present");
  assert.ok(opts.indexOf("外星") < 0, "unrecognised never enters");
  // a stored selection from another dataset still shows up
  const opts2 = D.options([], "金山");
  assert.ok(opts2.indexOf("金山") >= 0);
});

test("counts / labels / emptyTitle", () => {
  const acts = [{ district: "徐汇" }, { district: "徐汇" }, { district: "浦东" }, { district: "??" }];
  assert.deepEqual(D.counts(acts), { "徐汇": 2, "浦东": 1, "??": 1 });
  assert.equal(D.label("徐汇"), "上海 · 徐汇");
  assert.equal(D.label(D.ALL), "上海 · 全上海");
  assert.equal(D.shortLabel("静安"), "静安");
  assert.equal(D.shortLabel(D.ALL), "全上海");
  assert.equal(D.emptyTitle("徐汇", false), "徐汇暂无活动");
  assert.equal(D.emptyTitle("徐汇", true), "徐汇暂无符合条件的活动");
  assert.equal(D.emptyTitle(D.ALL, false), "暂时没有活动");
  assert.equal(D.emptyTitle(D.ALL, true), "暂时没有符合条件的活动");
});
