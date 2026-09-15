# Gorgon Data Pipeline — MVP tests (PHASE 13).
#
# Run from repo root:
#   python -m unittest discover -s pipeline/tests -v
#
# These tests verify behavior; none of them hardcode pipeline outputs into
# business logic. All rules under test are deterministic.

import json
import re
import sys
import unittest
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = PIPELINE_DIR.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
if str(PIPELINE_DIR) not in sys.path:
    sys.path.insert(0, str(PIPELINE_DIR))

from pipeline.normalize.activity import normalize_activity, normalize_price  # noqa: E402
from pipeline.normalize.datetime import parse_date, parse_time  # noqa: E402
from pipeline.normalize.location import normalize_district  # noqa: E402
from pipeline.clean.cleaner import clean_activity  # noqa: E402
from pipeline.dedupe.deduplicator import dedupe_all  # noqa: E402
from pipeline.trust.scorer import score_activity  # noqa: E402
from pipeline.review.queue import build_queue, route  # noqa: E402
from pipeline.export.gorgon_export import to_gorgon_record  # noqa: E402


def _full_activity(**overrides):
    base = {
        "id": "t1",
        "title": "AI Agent Hackathon 上海站",
        "description": "48小时 Agent 马拉松。",
        "startDate": "2026-09-20",
        "startTime": "09:00",
        "endTime": "21:00",
        "venue": "西岸智塔 AI 空间",
        "address": "徐汇区龙腾大道2350号",
        "district": "徐汇",
        "city": "上海",
        "tags": ["AI", "黑客松"],
        "priceType": "free",
        "price": 0,
        "organizer": "上海 AI 开发者社区",
        "sourceName": "demo_source",
        "sourceUrl": "https://example.com/t1",
        "registrationUrl": "https://example.com/t1/reg",
    }
    base.update(overrides)
    return base


class TestPriceNormalization(unittest.TestCase):
    def test_free_variants(self):
        for raw in ("免费", "0元", "¥0", "￥0", "free", 0, "0"):
            pt, price = normalize_price(raw)
            self.assertEqual(pt, "free", "failed for %r" % raw)
            self.assertEqual(price, 0)

    def test_paid_variants(self):
        for raw, expected in (("¥29", 29), ("29.9元", 29.9), ("学生 ¥29", 29), (99, 99)):
            pt, price = normalize_price(raw)
            self.assertEqual(pt, "paid", "failed for %r" % raw)
            self.assertEqual(price, expected)

    def test_unknown_stays_unknown(self):
        pt, price = normalize_price("待定")
        self.assertEqual(pt, "unknown")
        self.assertIsNone(price)


class TestDistrictNormalization(unittest.TestCase):
    def test_variants_unify(self):
        for raw in ("上海市徐汇区", "徐汇", "徐汇区", " 上海·徐汇 "):
            self.assertEqual(normalize_district(raw), "徐汇", "failed for %r" % raw)

    def test_unknown_district_not_guessed(self):
        self.assertIsNone(normalize_district("火星"))
        self.assertIsNone(normalize_district(None))


class TestDatetime(unittest.TestCase):
    def test_date_formats_unify(self):
        for raw in ("2026/09/20", "2026-9-20", "2026.9.20", "2026年9月20日", "9月20日", "9/20"):
            self.assertEqual(parse_date(raw), "2026-09-20", "failed for %r" % raw)

    def test_invalid_date_is_none(self):
        self.assertIsNone(parse_date("9月40日"))
        self.assertIsNone(parse_date(""))

    def test_time_with_period_prefix(self):
        self.assertEqual(parse_time("晚上7点"), "19:00")
        self.assertEqual(parse_time("下午2:30"), "14:30")
        self.assertEqual(parse_time("09:00"), "09:00")


class TestDedupe(unittest.TestCase):
    def test_exact_duplicate_same_title_date_venue(self):
        a = _full_activity(id="x1")
        b = _full_activity(id="x2", title="  ai  agent  hackathon  上海站 ")
        acts, stats = dedupe_all([a, b])
        self.assertEqual(stats["duplicates_exact"], 1)
        self.assertEqual(acts[1]["duplicateOf"], "x1")
        self.assertEqual(acts[1]["status"], "rejected")
        # original records are kept, nothing deleted
        self.assertEqual(len(acts), 2)

    def test_near_duplicate_same_place_becomes_candidate(self):
        a = _full_activity(id="x1")
        b = _full_activity(id="x2", title="上海 AI Agent Hackathon")
        acts, stats = dedupe_all([a, b])
        self.assertEqual(stats["duplicates_near"], 1)
        self.assertEqual(acts[1]["status"], "needs_review")
        self.assertGreaterEqual(acts[1]["duplicateConfidence"], 0.82)

    def test_same_title_different_date_not_duplicate(self):
        a = _full_activity(id="x1", startDate="2026-09-20")
        b = _full_activity(id="x2", startDate="2026-09-27")
        acts, stats = dedupe_all([a, b])
        self.assertEqual(stats["duplicates_exact"] + stats["duplicates_near"], 0)
        self.assertIsNone(acts[1]["duplicateOf"])


class TestTrust(unittest.TestCase):
    def test_complete_activity_scores_high(self):
        score, reasons = score_activity(_full_activity())
        self.assertGreaterEqual(score, 80)
        self.assertIn("has_source_url", reasons)

    def test_missing_source_url_lowers_score(self):
        complete, _ = score_activity(_full_activity())
        missing, _ = score_activity(_full_activity(sourceUrl=None))
        self.assertLess(missing, complete)

    def test_reasons_are_explainable(self):
        score, reasons = score_activity(_full_activity(sourceUrl=None, registrationUrl=None))
        self.assertNotIn("has_source_url", reasons)
        self.assertTrue(all(re.fullmatch(r"[a-z_]+(:[0-9.]+)?", r) for r in reasons))

    def test_time_conflict_penalized(self):
        clean, _ = score_activity(_full_activity())
        conflict, reasons = score_activity(_full_activity(endTime="08:00"))
        self.assertLess(conflict, clean)
        self.assertIn("time_conflict", reasons)


class TestReviewRouting(unittest.TestCase):
    def test_routing_rules(self):
        high = _full_activity(id="h")
        high["trustScore"], _ = score_activity(high)
        mid = _full_activity(id="m", sourceUrl=None, registrationUrl=None)
        mid["trustScore"], _ = score_activity(mid)
        acts, summary = route([high, mid])
        self.assertEqual(acts[0]["status"], "approved")
        self.assertEqual(acts[1]["status"], "needs_review")

    def test_queue_entries_shape(self):
        act = _full_activity(id="m", sourceUrl=None, registrationUrl=None)
        act["trustScore"], _ = score_activity(act)
        acts, summary = route([act])
        queue = build_queue(acts, summary)
        entry = queue["queue"][0]
        for key in ("activity", "reason", "trustScore", "duplicateCandidates"):
            self.assertIn(key, entry)


class TestCleaner(unittest.TestCase):
    def test_html_and_tags(self):
        act = _full_activity(
            description="<p>hello&nbsp;world</p>​垃圾字符",
            tags=["AI", "ai ", "AI", "黑客松"],
        )
        cleaned = clean_activity(act)
        self.assertEqual(cleaned["description"], "hello world 垃圾字符")
        self.assertEqual(cleaned["tags"], ["AI", "黑客松"])

    def test_semantics_preserved(self):
        act = _full_activity(description="讲座开始时间：2026年9月20日 14:00，地点：西岸智塔。")
        cleaned = clean_activity(act)
        self.assertIn("2026年9月20日", cleaned["description"])
        self.assertIn("西岸智塔", cleaned["description"])


class TestNormalizeStage(unittest.TestCase):
    def test_normalize_fills_canonical_fields(self):
        raw = {"id": "n1", "title": "  测试   活动 ！！！ ", "startDate": "9月20日",
               "startTime": "晚上7点", "price": "￥0", "district": "上海市徐汇区"}
        act = normalize_activity(raw)
        self.assertEqual(act["title"], "测试 活动 !")
        self.assertEqual(act["startDate"], "2026-09-20")
        self.assertEqual(act["startTime"], "19:00")
        self.assertEqual(act["priceType"], "free")
        self.assertEqual(act["district"], "徐汇")
        self.assertEqual(act["status"], "normalized")


class TestGorgonRecord(unittest.TestCase):
    def test_record_has_required_ui_fields(self):
        act = _full_activity()
        act["trustScore"] = 90
        act["trustReasons"] = ["has_source_url"]
        rec = to_gorgon_record(act)
        for key in ("id", "title", "category", "date", "day", "time", "location",
                    "venue", "price", "tags", "source", "desc"):
            self.assertIn(key, rec)
        self.assertTrue(rec["source"].startswith("DEMO DATA"))
        self.assertIsNone(rec["image"])


if __name__ == "__main__":
    unittest.main()
