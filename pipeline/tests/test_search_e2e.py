# Information retrieval E2E (PHASE 11/12).
#
# Runs the demo scenario through the FULL chain on the real fixture:
#
#   search -> normalize -> dedupe -> trust -> route -> ranking -> result
#
# and checks the API boundary and the demo export.

import json
import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = PIPELINE_DIR.parent
for p in (str(REPO_ROOT), str(PIPELINE_DIR)):
    if p not in sys.path:
        sys.path.insert(0, p)

from pipeline.api.server import build_response  # noqa: E402
from pipeline.export.search_export import (  # noqa: E402
    export_search_demo_js, export_search_json,
)
from pipeline.search.demo import DEMO_QUERY, DEMO_TODAY, run_demo  # noqa: E402
from pipeline.search.service import search_events  # noqa: E402

TODAY = DEMO_TODAY


class TestDemoScenario(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.result = run_demo(today=TODAY, debug=True)

    def test_request_is_parsed_into_the_documented_contract(self):
        req = self.result["request"]
        self.assertEqual(req["city"], "上海")
        self.assertEqual(req["topics"], ["AI", "Agent", "Vibe Coding"])
        self.assertEqual(req["dateRange"], {"type": "relative", "value": "this_weekend"})
        self.assertEqual(req["timePreference"], "afternoon")
        self.assertEqual(req["locationPreference"], "徐汇")
        self.assertEqual(req["pricePreference"], "free_preferred")
        self.assertEqual(req["maxResults"], 20)

    def test_plan_is_small_and_ordered(self):
        plan = self.result["plan"]
        texts = [q["text"] for q in plan["queries"]]
        self.assertGreaterEqual(len(texts), 3)
        self.assertLessEqual(len(texts), 8)
        self.assertEqual(plan["dateRange"]["start"], "2026-09-19")
        self.assertEqual(plan["dateRange"]["end"], "2026-09-20")

    def test_summary_numbers_are_consistent(self):
        s = self.result["summary"]
        self.assertGreaterEqual(s["rawResults"], 20)          # PHASE 12: 20-30 raw
        self.assertLessEqual(s["rawResults"], 30)
        self.assertLess(s["mergedRawResults"], s["rawResults"])   # URL merge happened
        self.assertGreaterEqual(s["canonical"], 12)
        self.assertEqual(s["approved"], 16)
        self.assertGreaterEqual(s["needsReview"], 3)
        self.assertGreaterEqual(s["duplicates"], 2)
        self.assertEqual(s["reviewQueue"]["approved"] + s["reviewQueue"]["needs_review"]
                         + s["reviewQueue"]["low_confidence"], s["approved"] + s["needsReview"])

    def test_whole_pipeline_really_ran(self):
        stages = self.result["debug"]["stages"]
        for key in ("raw", "merged", "normalized", "cleaned", "deduped", "scored", "routed",
                    "candidates", "ranked"):
            self.assertIn(key, stages)
        self.assertEqual(stages["normalized"], stages["merged"])
        self.assertGreater(stages["ranked"], 0)

    def test_every_result_carries_pipeline_and_retrieval_metadata(self):
        for item in self.result["results"]:
            act = item["activity"]
            # pipeline provenance (trust stage + human review routing)
            self.assertIsNotNone(act.get("trustScore"))
            self.assertIn(act.get("status"), ("approved", "needs_review", "rejected"))
            self.assertTrue(act.get("trustReasons"))
            self.assertIn("_extra", act)          # retrieval provenance survives
            # retrieval provenance (planner + provider)
            self.assertTrue(item["provenance"])
            self.assertTrue(item["queries"])
            self.assertIn("finalScore", item)
            self.assertIn("reasons", item)

    def test_one_activity_merged_from_two_sources(self):
        top = self.result["results"][0]
        self.assertEqual(top["activity"]["title"], "AI Agent Builder Meetup")
        sources = {p["source"] for p in top["provenance"]}
        self.assertEqual(len(sources), 2)
        self.assertIn("%d 个来源信息一致" % len(sources), top["reasons"])

    def test_top5_are_clearly_ranked(self):
        scores = [r["finalScore"] for r in self.result["results"][:5]]
        self.assertEqual(len(scores), 5)
        self.assertEqual(scores, sorted(scores, reverse=True))
        self.assertGreater(scores[0] - scores[-1], 10)
        self.assertEqual(len(set(scores)), 5)
        for score in scores:
            self.assertLessEqual(score, 100)
            self.assertGreaterEqual(score, 0)

    def test_approved_results_come_first(self):
        buckets = [r["bucket"] for r in self.result["results"]]
        first_pending = next((i for i, b in enumerate(buckets) if b != "approved"), len(buckets))
        self.assertNotIn("approved", buckets[first_pending:])

    def test_conflict_reaches_human_review(self):
        pending = [r for r in self.result["results"] if r["bucket"] == "needs_review"]
        self.assertTrue(pending)
        conflicted = [r for r in pending
                      if "cross_source_conflict" in r["activity"].get("trustReasons", [])]
        self.assertTrue(conflicted, "no cross-source conflict reported in the demo")
        reasons = conflicted[0]["activity"]["trustReasons"]
        self.assertTrue("location_conflict" in reasons or "time_conflict" in reasons)

    def test_non_ai_events_rank_below_ai_events(self):
        by_title = {r["activity"]["title"]: r["finalScore"] for r in self.result["results"]}
        ai = next((v for k, v in by_title.items() if "AI Agent Builder Meetup" in k), None)
        off_topic = [v for k, v in by_title.items() if "民谣" in k or "桌游" in k or "咖啡烘焙" in k]
        self.assertIsNotNone(ai)
        self.assertTrue(off_topic)
        self.assertTrue(all(score < ai for score in off_topic))

    def test_second_query_without_debug_hides_internals(self):
        res = search_events(DEMO_QUERY, today=TODAY)
        self.assertNotIn("debug", res)


class TestAlternativeQueries(unittest.TestCase):
    def test_single_topic_query_still_returns_results(self):
        res = search_events("这个周末上海有哪些 Vibe Coding 活动？", today=TODAY)
        self.assertGreater(res["summary"]["rawResults"], 0)
        self.assertGreater(len(res["results"]), 0)

    def test_dict_request_equivalent_to_text(self):
        text_result = search_events("本周末上海有什么 AI 活动？", today=TODAY)
        dict_result = search_events({
            "query": "本周末上海有什么 AI 活动？", "city": "上海", "topics": ["AI"],
            "dateRange": {"type": "relative", "value": "this_weekend"},
        }, today=TODAY)
        self.assertEqual(text_result["summary"], dict_result["summary"])

    def test_unrecorded_query_returns_empty_but_valid(self):
        res = search_events("帮我找一个完全不存在的活动类型", today=TODAY)
        self.assertEqual(res["summary"]["rawResults"], 0)
        self.assertEqual(res["results"], [])
        self.assertIn("request", res)


class TestApiBoundary(unittest.TestCase):
    def test_response_shape(self):
        res = build_response({"query": DEMO_QUERY}, today=TODAY)
        for key in ("request", "plan", "summary", "results"):
            self.assertIn(key, res)
        self.assertNotIn("debug", res)
        self.assertNotIn("_extra", json.dumps(res["results"], ensure_ascii=False))
        for item in res["results"]:
            self.assertEqual(set(item) & {"id", "bucket", "finalScore", "scores",
                                          "reasons", "provenance", "queries", "activity"},
                             {"id", "bucket", "finalScore", "scores", "reasons",
                              "provenance", "queries", "activity"})

    def test_debug_mode_exposes_internals(self):
        res = build_response({"query": DEMO_QUERY, "debug": True}, today=TODAY)
        self.assertIn("debug", res)
        self.assertIn("stages", res["debug"])
        self.assertIn("_extra", json.dumps(res["results"], ensure_ascii=False))

    def test_query_alias_and_max_results(self):
        res = build_response({"q": DEMO_QUERY, "maxResults": 5}, today=TODAY)
        self.assertEqual(len(res["results"]), 5)
        self.assertEqual(res["request"]["query"], DEMO_QUERY)


class TestDemoExport(unittest.TestCase):
    def test_exports_are_valid_and_loadable(self):
        result = run_demo(today=TODAY, debug=True)
        with tempfile.TemporaryDirectory() as tmp:
            json_path = export_search_json(result, Path(tmp) / "demo_search.json", debug=True)
            js_path = export_search_demo_js(result, Path(tmp) / "generated-search-demo.js", DEMO_QUERY)

            payload = json.loads(Path(json_path).read_text(encoding="utf-8"))
            self.assertEqual(payload["request"]["topics"], ["AI", "Agent", "Vibe Coding"])
            self.assertGreater(len(payload["results"]), 0)

            text = Path(js_path).read_text(encoding="utf-8")
            self.assertIn("window.GORGON_SEARCH_DEMO", text)
            body = text[text.index("{"): text.rindex("}") + 1]
            data = json.loads(body)
            self.assertEqual(data["query"], DEMO_QUERY)
            self.assertEqual(data["summary"]["approved"], 16)

    def test_shipped_demo_files_are_in_sync(self):
        """The committed demo artifacts must match the current pipeline output."""
        js_path = REPO_ROOT / "ui_kits" / "app" / "generated-search-demo.js"
        json_path = PIPELINE_DIR / "data" / "search" / "demo_search.json"
        self.assertTrue(js_path.exists(), "run: python pipeline/run.py --search-demo")
        self.assertTrue(json_path.exists(), "run: python pipeline/run.py --search-demo")

        result = run_demo(today=TODAY, debug=False)
        fresh = json.loads(export_json_string(result))
        shipped = json.loads(json_path.read_text(encoding="utf-8"))
        self.assertEqual(fresh["summary"], shipped["summary"])
        self.assertEqual([r["id"] for r in fresh["results"]],
                         [r["id"] for r in shipped["results"]])


def export_json_string(result):
    with tempfile.TemporaryDirectory() as tmp:
        path = export_search_json(result, Path(tmp) / "s.json")
        return Path(path).read_text(encoding="utf-8")


if __name__ == "__main__":
    unittest.main()
