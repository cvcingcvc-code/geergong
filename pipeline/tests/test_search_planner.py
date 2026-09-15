# Query Planner tests (PHASE 11).
#
# Covers: single topic, multi topic, city, 本周末 resolution, free preference,
# location preference, query dedupe, plan size bounds, request parsing.

import sys
import unittest
from datetime import date
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = PIPELINE_DIR.parent
for p in (str(REPO_ROOT), str(PIPELINE_DIR)):
    if p not in sys.path:
        sys.path.insert(0, p)

from pipeline.search.models import SearchRequest  # noqa: E402
from pipeline.search.planner import (  # noqa: E402
    MAX_QUERIES, MIN_QUERIES, LLMQueryPlanner, parse_request, plan_search,
    resolve_date_range,
)

DEMO_QUERY = ("这个周末上海有什么 AI / Agent / Vibe Coding 的活动？"
              "最好免费，徐汇附近，下午开始。")
TODAY = date(2026, 9, 15)   # Tuesday


class TestParseRequest(unittest.TestCase):
    def test_demo_query_parses_completely(self):
        req = parse_request(DEMO_QUERY)
        self.assertEqual(req.city, "上海")
        self.assertEqual(req.topics, ["AI", "Agent", "Vibe Coding"])
        self.assertEqual(req.dateRange, {"type": "relative", "value": "this_weekend"})
        self.assertEqual(req.timePreference, "afternoon")
        self.assertEqual(req.locationPreference, "徐汇")
        self.assertEqual(req.pricePreference, "free_preferred")

    def test_single_topic(self):
        req = parse_request("这周末上海有什么黑客松？")
        self.assertEqual(req.city, "上海")
        self.assertEqual(req.topics, ["Hackathon"])
        self.assertIsNone(req.timePreference)

    def test_missing_fields_stay_empty(self):
        req = parse_request("随便看看")
        self.assertEqual(req.topics, [])
        self.assertIsNone(req.city)
        self.assertIsNone(req.dateRange)
        self.assertIsNone(req.pricePreference)

    def test_free_only_stronger_than_free_preferred(self):
        self.assertEqual(parse_request("只要免费的 AI 活动").pricePreference, "free_only")
        self.assertEqual(parse_request("最好免费的 AI 活动").pricePreference, "free_preferred")

    def test_time_preferences(self):
        self.assertEqual(parse_request("上午的 AI 活动").timePreference, "morning")
        self.assertEqual(parse_request("晚上 7 点的 AI 活动").timePreference, "evening")


class TestDateRange(unittest.TestCase):
    def test_this_weekend_from_tuesday(self):
        rng = resolve_date_range(SearchRequest(dateRange={"type": "relative", "value": "this_weekend"}), today=TODAY)
        self.assertEqual(rng["start"], "2026-09-19")   # Saturday
        self.assertEqual(rng["end"], "2026-09-20")     # Sunday
        self.assertEqual(rng["label"], "本周末")

    def test_this_weekend_on_saturday_starts_today(self):
        rng = resolve_date_range(SearchRequest(dateRange={"type": "relative", "value": "this_weekend"}),
                                 today=date(2026, 9, 19))
        self.assertEqual(rng["start"], "2026-09-19")
        self.assertEqual(rng["end"], "2026-09-20")

    def test_today_and_tomorrow(self):
        today = resolve_date_range(SearchRequest(dateRange={"type": "relative", "value": "today"}), today=TODAY)
        self.assertEqual(today["start"], "2026-09-15")
        self.assertEqual(today["label"], "今天")
        tmr = resolve_date_range(SearchRequest(dateRange={"type": "relative", "value": "tomorrow"}), today=TODAY)
        self.assertEqual(tmr["start"], "2026-09-16")

    def test_no_date_range_returns_none(self):
        self.assertIsNone(resolve_date_range(SearchRequest(), today=TODAY))


class TestPlanSearch(unittest.TestCase):
    def test_demo_plan_shape(self):
        plan = plan_search(parse_request(DEMO_QUERY), today=TODAY)
        texts = plan.query_texts()
        self.assertLessEqual(len(texts), MAX_QUERIES)
        self.assertGreaterEqual(len(texts), MIN_QUERIES)
        # city first, topic second
        self.assertTrue(all(t.startswith("上海") for t in texts))
        # topic priority: AI before Agent before Vibe Coding
        self.assertIn("上海 AI 活动 本周末", texts)
        self.assertIn("上海 Agent Meetup 本周末", texts)
        self.assertIn("上海 Vibe Coding 活动", texts)
        self.assertTrue(all("AI" in t or "Agent" in t or "Vibe Coding" in t for t in texts))
        self.assertLess(texts.index("上海 AI 活动 本周末"), texts.index("上海 Agent Meetup 本周末"))
        self.assertLess(texts.index("上海 Agent Meetup 本周末"), texts.index("上海 Vibe Coding 活动"))

    def test_date_condition_applied(self):
        plan = plan_search(parse_request(DEMO_QUERY), today=TODAY)
        self.assertTrue(any(t.endswith("本周末") for t in plan.query_texts()))
        self.assertEqual(plan.dateRange["start"], "2026-09-19")

    def test_location_preference_produces_refined_query(self):
        plan = plan_search(parse_request(DEMO_QUERY), today=TODAY)
        self.assertIn("上海 AI 活动 徐汇", plan.query_texts())

    def test_queries_are_deduped(self):
        plan = plan_search(SearchRequest(query="上海 AI 活动", city="上海", topics=["AI", "AI"]), today=TODAY)
        texts = plan.query_texts()
        self.assertEqual(len(texts), len(set(texts)))

    def test_multi_topic_plan(self):
        plan = plan_search(SearchRequest(city="上海", topics=["AI", "Agent", "Vibe Coding"]), today=TODAY)
        texts = plan.query_texts()
        for topic in ("AI", "Agent", "Vibe Coding"):
            self.assertTrue(any(topic in t for t in texts), topic)

    def test_city_is_used(self):
        plan = plan_search(SearchRequest(city="北京", topics=["AI"]), today=TODAY)
        self.assertTrue(all(t.startswith("北京") for t in plan.query_texts()))

    def test_no_date_range_keeps_queries_date_free(self):
        plan = plan_search(SearchRequest(city="上海", topics=["AI"]), today=TODAY)
        self.assertFalse(any("本周末" in t for t in plan.query_texts()))

    def test_no_topic_plan_still_valid(self):
        plan = plan_search(SearchRequest(city="上海", dateRange={"type": "relative", "value": "this_weekend"}), today=TODAY)
        texts = plan.query_texts()
        self.assertGreaterEqual(len(texts), MIN_QUERIES)
        self.assertTrue(any("本周末" in t for t in texts))

    def test_plan_size_bounded(self):
        plan = plan_search(SearchRequest(city="上海", topics=["AI", "Agent", "Vibe Coding", "Hackathon", "Meetup"]), today=TODAY)
        self.assertLessEqual(len(plan.query_texts()), MAX_QUERIES)

    def test_empty_request_does_not_crash(self):
        plan = plan_search(SearchRequest(), today=TODAY)
        self.assertGreaterEqual(len(plan.query_texts()), MIN_QUERIES)


class TestLLMPlannerInterface(unittest.TestCase):
    def test_interface_is_reserved_not_implemented(self):
        with self.assertRaises(NotImplementedError):
            LLMQueryPlanner().plan_search(SearchRequest(query="x"))


if __name__ == "__main__":
    unittest.main()
