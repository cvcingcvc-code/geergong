# Ranking tests (PHASE 11).
#
# Ranking must answer "is this right for THIS user?", not "is this credible".
# Each test isolates ONE preference so the ordering claim is unambiguous.

import sys
import unittest
from datetime import date
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = PIPELINE_DIR.parent
for p in (str(REPO_ROOT), str(PIPELINE_DIR)):
    if p not in sys.path:
        sys.path.insert(0, p)

from pipeline.search.models import SearchCandidate, SearchRequest  # noqa: E402
from pipeline.search.ranker import (  # noqa: E402
    RANKING_WEIGHTS, rank_candidates, score_candidate,
)

TODAY = date(2026, 9, 15)


def _activity(**kw):
    base = {
        "id": "a1",
        "title": "AI Agent Builder Meetup",
        "description": "Agent 主题线下聚会。",
        "startDate": "2026-09-19",
        "startTime": "14:00",
        "endTime": "17:00",
        "venue": "徐汇滨江 AI 创新中心",
        "address": "上海市徐汇区龙腾大道2600号",
        "district": "徐汇",
        "city": "上海",
        "category": "ai",
        "tags": ["AI", "Agent"],
        "priceType": "free",
        "price": 0,
        "organizer": "上海 AI 开发者社区",
        "sourceName": "来源A",
        "sourceUrl": "https://example.com/a1",
        "registrationUrl": "https://example.com/a1/reg",
        "publishedAt": "2026-09-10T09:00:00",
        "trustScore": 90,
        "trustReasons": ["has_source_url"],
        "status": "approved",
        "duplicateOf": None,
    }
    base.update(kw)
    return base


def _candidate(activity, sources=(("来源A", "high"),)):
    return SearchCandidate(
        activity=activity,
        bucket="approved" if activity.get("status") == "approved" else "needs_review",
        provenance=[{"resultId": "r%d" % i, "source": s, "sourceType": "community",
                     "sourceTrust": t, "providerQuery": "上海 AI 活动 本周末",
                     "url": "https://example.com/%d" % i}
                    for i, (s, t) in enumerate(sources)],
        queries=["上海 AI 活动 本周末"],
    )


DEMO_REQUEST = SearchRequest.from_dict({
    "city": "上海", "topics": ["AI", "Agent", "Vibe Coding"],
    "dateRange": {"type": "relative", "value": "this_weekend"},
    "timePreference": "afternoon", "locationPreference": "徐汇",
    "pricePreference": "free_preferred", "maxResults": 20,
})


def _score(activity, request=DEMO_REQUEST, sources=(("来源A", "high"),)):
    return score_candidate(_candidate(activity, sources=sources), request, today=TODAY)


class TestWeightsConfig(unittest.TestCase):
    def test_weights_sum_to_one(self):
        self.assertAlmostEqual(sum(RANKING_WEIGHTS.values()), 1.0, places=6)

    def test_expected_weight_keys(self):
        self.assertEqual(set(RANKING_WEIGHTS), {
            "relevance", "trust", "time_fit", "location_fit", "freshness", "price_fit",
        })


class TestRelevance(unittest.TestCase):
    def test_topic_match_beats_mismatch(self):
        on_topic = _score(_activity())
        off_topic = _score(_activity(title="周末民谣现场：城市夜晚与吉他",
                                     description="三位独立音乐人轮番上场。",
                                     tags=["音乐", "民谣"], category="music",
                                     venue="育音堂", organizer="育音堂"))
        self.assertEqual(off_topic.relevanceScore, 0)
        self.assertGreater(on_topic.relevanceScore, off_topic.relevanceScore)
        self.assertGreater(on_topic.finalScore, off_topic.finalScore)

    def test_primary_topic_weighs_more_than_later_topics(self):
        neutral = dict(category="talk", description="一场线下活动。",
                       venue="某空间", organizer="某社区")
        primary = _score(_activity(title="AI 大模型分享会", tags=["AI"], **neutral))
        tertiary = _score(_activity(title="Vibe Coding 工作坊", tags=["Vibe Coding"], **neutral))
        self.assertGreater(primary.relevanceScore, tertiary.relevanceScore)

    def test_reason_names_the_topic(self):
        self.assertTrue(any("AI" in r for r in _score(_activity()).reasons))


class TestLocationFit(unittest.TestCase):
    def test_xuhui_beats_pudong_when_user_prefers_xuhui(self):
        xuhui = _score(_activity(district="徐汇"))
        pudong = _score(_activity(district="浦东", address="上海市浦东新区川和路55号"))
        self.assertGreater(xuhui.locationFitScore, pudong.locationFitScore)
        self.assertGreater(xuhui.finalScore, pudong.finalScore)
        self.assertTrue(any("徐汇" in r for r in xuhui.reasons))

    def test_neutral_when_no_preference(self):
        req = SearchRequest.from_dict({"query": "上海 AI 活动", "city": "上海", "topics": ["AI"]})
        self.assertGreater(_score(_activity(district="浦东"), request=req).locationFitScore, 50)


class TestTimeFit(unittest.TestCase):
    def test_afternoon_beats_morning_when_user_prefers_afternoon(self):
        afternoon = _score(_activity(startTime="14:00"))
        morning = _score(_activity(startTime="09:00"))
        self.assertGreater(afternoon.timeFitScore, morning.timeFitScore)
        self.assertGreater(afternoon.finalScore, morning.finalScore)

    def test_event_outside_requested_weekend_is_penalised(self):
        inside = _score(_activity(startDate="2026-09-19"))
        outside = _score(_activity(startDate="2026-09-26"))
        self.assertGreater(inside.timeFitScore, outside.timeFitScore)
        self.assertGreater(inside.finalScore, outside.finalScore)
        self.assertTrue(any("不在本周末" in r for r in outside.reasons))


class TestPriceFit(unittest.TestCase):
    def test_free_beats_paid_when_free_preferred(self):
        free = _score(_activity(priceType="free", price=0))
        paid = _score(_activity(priceType="paid", price=199))
        self.assertGreater(free.priceFitScore, paid.priceFitScore)
        self.assertGreater(free.finalScore, paid.finalScore)
        self.assertIn("免费", free.reasons)


class TestTrustVsRanking(unittest.TestCase):
    def test_high_trust_ranks_above_low_trust(self):
        high = _score(_activity(trustScore=90))
        low = _score(_activity(trustScore=40))
        self.assertGreater(high.trustScore, low.trustScore)
        self.assertGreater(high.finalScore, low.finalScore)

    def test_trust_is_reported_separately_from_final_score(self):
        # same activity, different trust -> trust score changes, relevance does not
        high, low = _score(_activity(trustScore=90)), _score(_activity(trustScore=40))
        self.assertEqual(high.relevanceScore, low.relevanceScore)
        self.assertNotEqual(high.finalScore, low.finalScore)


class TestFreshness(unittest.TestCase):
    def test_recent_listing_beats_stale_listing(self):
        fresh = _score(_activity(publishedAt="2026-09-14T09:00:00"))
        stale = _score(_activity(publishedAt="2026-06-01T09:00:00"))
        self.assertGreater(fresh.freshnessScore, stale.freshnessScore)
        self.assertGreater(fresh.finalScore, stale.finalScore)


class TestScoreContract(unittest.TestCase):
    def test_all_scores_in_range(self):
        for activity in (_activity(), _activity(title="无名", tags=[], startDate=None, startTime=None,
                                                priceType="unknown", price=None, district=None,
                                                city=None, publishedAt=None, trustScore=0)):
            r = _score(activity)
            for value in (r.finalScore, r.relevanceScore, r.trustScore, r.timeFitScore,
                          r.locationFitScore, r.priceFitScore, r.freshnessScore):
                self.assertGreaterEqual(value, 0)
                self.assertLessEqual(value, 100)

    def test_final_score_is_the_declared_weighted_sum(self):
        r = _score(_activity())
        expected = round(sum(RANKING_WEIGHTS[k] * v for k, v in {
            "relevance": r.relevanceScore, "trust": r.trustScore, "time_fit": r.timeFitScore,
            "location_fit": r.locationFitScore, "freshness": r.freshnessScore,
            "price_fit": r.priceFitScore,
        }.items()))
        self.assertEqual(r.finalScore, expected)

    def test_weights_are_reported_with_every_score(self):
        self.assertEqual(_score(_activity()).weights, RANKING_WEIGHTS)

    def test_reasons_are_human_readable_and_capped(self):
        r = _score(_activity())
        self.assertTrue(r.reasons)
        self.assertLessEqual(len(r.reasons), 6)
        self.assertTrue(all(isinstance(x, str) and x.strip() for x in r.reasons))

    def test_multi_source_is_explained(self):
        two = _score(_activity(), sources=(("来源A", "high"), ("来源B", "medium")))
        self.assertTrue(any("2 个来源" in r for r in two.reasons))


class TestRankOrdering(unittest.TestCase):
    def test_approved_always_before_pending(self):
        approved = _candidate(_activity(id="ok"), sources=(("来源A", "high"),))
        pending_act = _activity(id="wait", status="needs_review", trustScore=95)
        pending = SearchCandidate(activity=pending_act, bucket="needs_review",
                                 provenance=[{"resultId": "x", "source": "来源B",
                                              "sourceType": "web", "sourceTrust": "low",
                                              "providerQuery": "q", "url": None}],
                                 queries=[])
        ranked = rank_candidates([pending, approved], DEMO_REQUEST, today=TODAY)
        self.assertEqual(ranked[0].candidate.activity["id"], "ok")

    def test_ordering_is_deterministic(self):
        cands = [_candidate(_activity(id="b1")),
                 _candidate(_activity(id="a1", title="Vibe Coding 工作坊", tags=["Vibe Coding"]))]
        first = [r.candidate.activity["id"] for r in rank_candidates(cands, DEMO_REQUEST, today=TODAY)]
        second = [r.candidate.activity["id"] for r in rank_candidates(list(reversed(cands)), DEMO_REQUEST, today=TODAY)]
        self.assertEqual(first, second)


if __name__ == "__main__":
    unittest.main()
