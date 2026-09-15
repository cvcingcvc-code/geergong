# Search / provider tests (PHASE 11).
#
# Covers: multi-provider merge, same-URL dedupe, same-activity-different-source
# going through the EXISTING dedupe, source provenance retention, adapter
# faithfulness, and the fixture's required coverage.

import re
import sys
import unittest
from datetime import date
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = PIPELINE_DIR.parent
for p in (str(REPO_ROOT), str(PIPELINE_DIR)):
    if p not in sys.path:
        sys.path.insert(0, p)

from pipeline.search.adapter import provenance_of, to_raw_activity  # noqa: E402
from pipeline.search.models import RawSearchResult, SearchRequest  # noqa: E402
from pipeline.search.provider import (  # noqa: E402
    FixtureSearchProvider, ManualSearchProvider, default_provider,
)
from pipeline.search.service import merge_raw_results, search_events  # noqa: E402

TODAY = date(2026, 9, 15)


def _row(**kw):
    base = {
        "resultId": "r1",
        "providerQuery": "上海 AI 活动 本周末",
        "source": "来源A",
        "sourceType": "community",
        "sourceTrust": "high",
        "title": "AI Agent Hackathon 上海站",
        "snippet": "48 小时 Agent 马拉松。",
        "url": "https://example.com/a",
        "registrationUrl": "https://example.com/a/reg",
        "publishedAt": "2026-09-10T09:00:00",
        "rawDate": "2026-09-19",
        "rawTime": "09:00-21:00",
        "rawVenue": "西岸智塔 AI 空间",
        "address": "上海市徐汇区龙腾大道2350号",
        "rawLocation": "上海·徐汇",
        "rawPrice": "免费",
        "organizer": "上海 AI 开发者社区",
        "tags": ["AI", "Agent"],
    }
    base.update(kw)
    return base


def _req(**kw):
    base = {"city": "上海", "topics": ["AI", "Agent"],
            "dateRange": {"type": "relative", "value": "this_weekend"},
            "timePreference": "afternoon", "pricePreference": "free_preferred",
            "maxResults": 50}
    base.update(kw)
    return SearchRequest.from_dict(base)


def _by_id(result):
    return {r["id"]: r for r in result["results"]}


def _start(raw_time):
    """'09:30-12:00' -> '09:30'; unparseable labels -> None."""
    if not raw_time:
        return None
    m = re.search(r"(\d{1,2}):(\d{2})", str(raw_time))
    if not m:
        return None
    return "%02d:%02d" % (int(m.group(1)), int(m.group(2)))


class TestAdapter(unittest.TestCase):
    def test_maps_fields_into_canonical_raw_shape(self):
        row = RawSearchResult.from_dict(_row())
        act = to_raw_activity(row)
        self.assertEqual(act["id"], "r1")
        self.assertEqual(act["title"], "AI Agent Hackathon 上海站")
        self.assertEqual(act["description"], "48 小时 Agent 马拉松。")
        self.assertEqual(act["startDate"], "2026-09-19")
        self.assertEqual(act["startTime"], "09:00-21:00")
        self.assertEqual(act["venue"], "西岸智塔 AI 空间")
        self.assertEqual(act["location"], "上海·徐汇")
        self.assertEqual(act["price"], "免费")
        self.assertEqual(act["sourceName"], "来源A")
        self.assertEqual(act["status"], "raw")

    def test_adapter_does_not_clean_or_guess(self):
        row = RawSearchResult.from_dict(_row(title="  AI   测试 活动 ！！！ ", rawDate="9月19日"))
        act = to_raw_activity(row)
        # cleaning/normalizing is the pipeline's job, not the adapter's
        self.assertEqual(act["title"], "  AI   测试 活动 ！！！ ")
        self.assertEqual(act["startDate"], "9月19日")

    def test_provenance_is_preserved(self):
        row = RawSearchResult.from_dict(_row(sourceTrust="low"))
        prov = provenance_of(to_raw_activity(row))
        self.assertEqual(prov["resultId"], "r1")
        self.assertEqual(prov["source"], "来源A")
        self.assertEqual(prov["sourceType"], "community")
        self.assertEqual(prov["sourceTrust"], "low")
        self.assertEqual(prov["providerQuery"], "上海 AI 活动 本周末")


class TestMerge(unittest.TestCase):
    def test_same_result_id_merged(self):
        a = RawSearchResult.from_dict(_row(resultId="dup", url="https://example.com/1"))
        b = RawSearchResult.from_dict(_row(resultId="dup", url="https://example.com/1"))
        kept, stats = merge_raw_results([a, b])
        self.assertEqual(len(kept), 1)
        self.assertEqual(stats["byResultId"], 1)

    def test_same_url_merged(self):
        a = RawSearchResult.from_dict(_row(resultId="u1", url="https://example.com/x"))
        b = RawSearchResult.from_dict(_row(resultId="u2", title="另一个标题", url="https://example.com/x/"))
        kept, stats = merge_raw_results([a, b])
        self.assertEqual(len(kept), 1)
        self.assertEqual(stats["byUrl"], 1)

    def test_distinct_results_kept(self):
        rows = [RawSearchResult.from_dict(_row(resultId="k%d" % i, url="https://example.com/%d" % i))
                for i in range(3)]
        kept, stats = merge_raw_results(rows)
        self.assertEqual(len(kept), 3)
        self.assertEqual(stats["byResultId"] + stats["byUrl"], 0)

    def test_multi_provider_merge(self):
        p1 = ManualSearchProvider([_row(resultId="a", url="https://example.com/a"),
                                   _row(resultId="b", url="https://example.com/b")],
                                  name="p1", match_all=True)
        p2 = ManualSearchProvider([_row(resultId="a", url="https://example.com/a"),   # overlapping
                                   _row(resultId="c", url="https://example.com/c")],
                                  name="p2", match_all=True)
        res = search_events(_req(), providers=[p1, p2], today=TODAY, debug=True)
        stages = res["debug"]["stages"]
        self.assertGreater(stages["raw"], 3)          # both providers returned rows
        self.assertEqual(stages["merged"], 3)         # a / b / c after merging
        self.assertEqual(res["summary"]["mergedDuplicates"], stages["raw"] - 3)


class TestPipelineIntegration(unittest.TestCase):
    def test_same_activity_two_sources_uses_existing_dedupe(self):
        rows = [
            _row(resultId="src1", url="https://example.com/one"),
            _row(resultId="src2", source="来源B", sourceType="xhs", sourceTrust="medium",
                 url="https://example.com/two", registrationUrl=None, organizer=None),
        ]
        res = search_events(_req(), providers=[ManualSearchProvider(rows, match_all=True)],
                            today=TODAY, debug=True)
        self.assertEqual(res["summary"]["duplicates"], 1)
        self.assertEqual(res["summary"]["duplicatesExact"], 1)
        self.assertEqual(res["summary"]["canonical"], 1)

        winner = _by_id(res)["src1"]
        self.assertEqual(winner["bucket"], "approved")
        self.assertEqual(winner["activity"]["status"], "approved")
        # provenance keeps BOTH sources, and both queries that surfaced it
        sources = sorted(p["source"] for p in winner["provenance"])
        self.assertEqual(sources, ["来源A", "来源B"])
        self.assertTrue(winner["queries"])

    def test_near_duplicate_becomes_review_candidate(self):
        rows = [
            _row(resultId="n1", url="https://example.com/n1"),
            _row(resultId="n2", title="AI Agent Hackathon · 上海站（第 4 期）",
                 source="来源B", url="https://example.com/n2"),
        ]
        res = search_events(_req(), providers=[ManualSearchProvider(rows, match_all=True)],
                            today=TODAY, debug=True)
        self.assertEqual(res["summary"]["duplicatesNear"], 1)
        dup = _by_id(res)["n2"]
        self.assertEqual(dup["bucket"], "duplicate_candidate")
        self.assertEqual(dup["activity"]["duplicateOf"], "n1")

    def test_conflicting_sources_go_to_needs_review(self):
        rows = [
            _row(resultId="c1", source="来源A", url="https://example.com/c1"),
            _row(resultId="c2", source="来源B", rawVenue="张江人工智能岛",
                 rawLocation="上海·浦东", address=None, url="https://example.com/c2"),
        ]
        res = search_events(_req(), providers=[ManualSearchProvider(rows, match_all=True)],
                            today=TODAY, debug=True)
        by_id = _by_id(res)
        self.assertEqual(by_id["c1"]["bucket"], "needs_review")
        self.assertEqual(by_id["c2"]["bucket"], "needs_review")
        reasons = by_id["c1"]["activity"]["trustReasons"]
        self.assertIn("cross_source_conflict", reasons)
        self.assertIn("location_conflict", reasons)

    def test_approved_results_are_never_mixed_with_pending(self):
        rows = [
            _row(resultId="ok1", url="https://example.com/ok1"),
            _row(resultId="bad1", title="【速看】惊了！！讲座千万别错过！！！", rawDate=None,
                 rawTime=None, rawVenue=None, rawLocation=None, url=None,
                 registrationUrl=None, organizer=None, source="微信群转发", sourceTrust="low"),
        ]
        res = search_events(_req(), providers=[ManualSearchProvider(rows, match_all=True)],
                            today=TODAY, debug=True)
        buckets = [r["bucket"] for r in res["results"]]
        first_pending = next((i for i, b in enumerate(buckets) if b != "approved"), len(buckets))
        self.assertNotIn("approved", buckets[first_pending:])

    def test_max_results_is_honoured(self):
        titles = ["AI Agent Builder Meetup", "Vibe Coding 工作坊", "AI 大模型分享会",
                  "Agent Demo Night", "AI 产品经理沙龙", "大模型实战工作坊"]
        rows = [_row(resultId="m%02d" % i, title=titles[i],
                     url="https://example.com/m%d" % i) for i in range(6)]
        res = search_events(_req(maxResults=3),
                            providers=[ManualSearchProvider(rows, match_all=True)], today=TODAY)
        self.assertEqual(len(res["results"]), 3)
        self.assertEqual(res["summary"]["returned"], 3)
        self.assertEqual(res["summary"]["ranked"], 6)


class TestFixtureProvider(unittest.TestCase):
    def setUp(self):
        self.provider = FixtureSearchProvider()

    def test_fixture_has_enough_raw_results(self):
        self.assertGreaterEqual(len(self.provider.rows), 20)

    def test_fixture_covers_required_cases(self):
        rows = self.provider.rows
        starts = [_start(row.rawTime) for row in rows]
        self.assertTrue(any("徐汇" in (r.rawLocation or "") for r in rows))
        self.assertTrue(any("浦东" in (r.rawLocation or "") for r in rows))
        self.assertTrue(any("免费" in (r.rawPrice or "") for r in rows))
        self.assertTrue(any(re.search(r"[1-9]\d*\s*元", r.rawPrice or "") for r in rows),
                        "no paid event in fixture")
        self.assertTrue(any(s and s < "12:00" for s in starts), "no morning event in fixture")
        self.assertTrue(any("下午" in (r.rawTime or "") or (s and "12:00" <= s < "18:00")
                            for r, s in zip(rows, starts)), "no afternoon event in fixture")
        self.assertTrue(any(s and s >= "18:00" for s in starts), "no evening event in fixture")
        self.assertEqual({r.sourceTrust for r in rows}, {"high", "medium", "low"})
        self.assertTrue(any("AI" in (r.title or "") for r in rows))
        self.assertTrue(any("民谣" in (r.title or "") or "跑步" in (r.title or "") for r in rows),
                        "no non-AI event in fixture")
        self.assertGreaterEqual(len({r.source for r in rows}), 5)

    def test_fixture_returns_recorded_query_only(self):
        fixture_queries = self.provider.available_queries()
        self.assertGreaterEqual(len(fixture_queries), 5)
        hits = self.provider.search(fixture_queries[0])
        self.assertTrue(hits)
        self.assertTrue(all(r.providerQuery == fixture_queries[0] for r in hits))

    def test_unknown_query_returns_nothing(self):
        self.assertEqual(self.provider.search("完全不存在的检索词"), [])

    def test_date_variant_still_reaches_its_recording(self):
        hits = self.provider.search("上海 Vibe Coding 活动 本周末")
        self.assertTrue(hits)
        self.assertTrue(all("Vibe Coding" in (r.providerQuery or "") for r in hits))

    def test_default_provider_is_the_fixture(self):
        self.assertEqual(default_provider().name, "fixture:shanghai_ai_events")


if __name__ == "__main__":
    unittest.main()
