# District Top-K correctness (PHASE 5.2).
#
# The bug this file exists to keep dead:
#
#   the district used to be applied by the BROWSER, to a list the server had
#   already ranked and cut to the city-wide top N. Retrieval could find a
#   徐汇 event, rank it 21st, cut it away, and the screen would then honestly
#   report "徐汇暂无符合条件的活动" about a list that no longer contained it.
#
# The fix is ordering: district eligibility is a property of a CANDIDATE, so
# it is decided after normalize and BEFORE dedupe / trust / ranking /
# maxResults. Everything below asserts that ordering, at three levels:
#
#   1. service level, on synthetic candidates built so the district hits can
#      only ever rank below the cut (the regression);
#   2. the HTTP contract, on the recorded demo fixture — real district hits
#      really do sit outside the city-wide top 20;
#   3. the pure eligibility predicate (unknown data is never guessed).

import json
import sys
import threading
import unittest
import urllib.request
import urllib.error
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = PIPELINE_DIR.parent
for p in (str(REPO_ROOT), str(PIPELINE_DIR)):
    if p not in sys.path:
        sys.path.insert(0, p)

from pipeline.api.server import GorgonRequestHandler, RateLimiter, make_server  # noqa: E402
from pipeline.normalize.location import (  # noqa: E402
    ALL_DISTRICTS_LABEL, district_matches, district_of_record, resolve_district,
)
from pipeline.search.demo import DEMO_QUERY, DEMO_TODAY  # noqa: E402
from pipeline.search.provider import ManualSearchProvider  # noqa: E402
from pipeline.search.service import search_events  # noqa: E402
from pipeline.search.settings import SearchSettings  # noqa: E402

TODAY = DEMO_TODAY

# urllib honours the machine's HTTP_PROXY, which would 502 every request to
# our own loopback server. An explicit empty ProxyHandler opts out.
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))

# 30 candidates. The first 20 are NOT in 徐汇 and DO match the topic; 21 and
# 22 ARE in 徐汇 and deliberately do not match it. So the 徐汇 pair can only
# ever rank 21st and 22nd — exactly the situation the old code lost them in.
TOTAL_CANDIDATES = 30
NON_XUHUI = 20
XUHUI_INDICES = (21, 22)
OTHER_DISTRICTS = ["浦东", "静安", "黄浦", "长宁", "杨浦", "普陀", "虹口", "闵行"]


def _candidate(index, district, title):
    """One retrieval hit, shaped exactly like a provider's RawSearchResult."""
    return {
        "resultId": "cand-%02d" % index,
        "providerQuery": "上海 AI 活动",
        "provider": "topk-test",
        "source": "测试来源",
        "sourceType": "community",
        "sourceTrust": "medium",
        "title": title,
        "snippet": "用于验证地区 Top-K 的候选活动",
        "url": "https://example.org/event/%02d" % index,
        "rawDate": "2026-10-%02d" % index,   # distinct dates: dedupe stays out of it
        "rawTime": "19:00",
        "rawVenue": "测试场地 %02d" % index,
        "rawLocation": ("上海·%s" % district) if district else "上海",
        "district": district,
        "city": "上海",
        "rawPrice": "免费",
        "organizer": "测试主办方",
        "publishedAt": "2026-09-01",
    }


def _thirty_candidates():
    rows = []
    for i in range(1, TOTAL_CANDIDATES + 1):
        district = "徐汇" if i in XUHUI_INDICES else OTHER_DISTRICTS[i % len(OTHER_DISTRICTS)]
        # Everything past the first 20 is deliberately OFF-TOPIC: none of it
        # can win on relevance, so the only way the 徐汇 pair survives is the
        # district constraint doing its job before the Top-K cut.
        title = ("AI Agent 沙龙 第 %02d 期" % i) if i <= NON_XUHUI \
            else "陶艺体验课 第 %02d 场" % i
        rows.append(_candidate(i, district, title))
    return rows


def _provider():
    return ManualSearchProvider(_thirty_candidates(), name="topk-test",
                                match_all=True)


def _run(**payload):
    """search_events with the injected provider: no network, no page fetch."""
    payload.setdefault("query", "上海 AI 活动")
    payload.setdefault("topics", ["AI"])
    return search_events(payload, providers=[_provider()], today=TODAY,
                         enrich=False, debug=True,
                         settings=SearchSettings(mode="demo"))


class DistrictTopKServiceTest(unittest.TestCase):
    """The regression: 30 candidates, the district hits rank 21st and 22nd."""

    def test_district_hits_below_the_cut_are_still_returned(self):
        """district=徐汇 + maxResults=20 must contain candidates 21 and 22.

        Under the old implementation the server returned the city-wide top 20
        (none of which is in 徐汇) and the browser filtered that — so this
        returned an empty list and the screen said 徐汇暂无活动.
        """
        result = _run(district="徐汇", maxResults=20)
        ids = [r["id"] for r in result["results"]]
        self.assertEqual(sorted(ids), ["cand-21", "cand-22"],
                         "the two 徐汇 candidates survived the Top-K cut")
        for item in result["results"]:
            self.assertEqual((item["activity"] or {}).get("district"), "徐汇")

    def test_the_city_wide_top_twenty_really_excludes_them(self):
        """The fixture has to be adversarial, or the regression is vacuous.

        Without the district the two 徐汇 candidates must fall outside the
        top 20 — otherwise "they were returned" proves nothing.
        """
        plain = _run(maxResults=20)
        ids = [r["id"] for r in plain["results"]]
        self.assertEqual(len(ids), 20)
        self.assertNotIn("cand-21", ids)
        self.assertNotIn("cand-22", ids)

    def test_what_the_old_client_side_filter_would_have_shown(self):
        """Reproduce the removed behaviour and show it returns nothing.

        This is the shape of the bug, kept as an executable description:
        rank the whole city, cut to maxResults, then filter by district.
        """
        plain = _run(maxResults=20)
        client_filtered = [r for r in plain["results"]
                           if (r["activity"] or {}).get("district") == "徐汇"]
        self.assertEqual(client_filtered, [],
                         "the old path must be empty here — that is the bug")

    def test_the_constraint_runs_before_dedupe_trust_ranking_and_the_cut(self):
        """Pipeline order, read off the stage counters rather than assumed."""
        result = _run(district="徐汇", maxResults=20)
        stages = result["debug"]["stages"]
        self.assertEqual(stages["normalized"], 30)        # everything retrieved
        self.assertEqual(stages["districtEligible"], 2)   # cut BEFORE dedupe
        self.assertEqual(stages["deduped"], 2)
        self.assertEqual(stages["scored"], 2)
        self.assertEqual(stages["routed"], 2)
        self.assertEqual(stages["ranked"], 2)
        self.assertEqual(stages["candidates"], 2)
        self.assertEqual(result["debug"]["districtFilter"], {
            "district": "徐汇", "candidates": 30, "eligible": 2, "excluded": 28,
        })

    def test_max_results_now_counts_district_hits_not_city_hits(self):
        """maxResults is a budget over what survived the constraint."""
        result = _run(district="徐汇", maxResults=1)
        self.assertEqual(len(result["results"]), 1)
        self.assertEqual(result["results"][0]["id"], "cand-21")

    def test_all_shanghai_is_not_a_hard_filter(self):
        """'全上海' must leave every candidate eligible."""
        wide = _run(district=ALL_DISTRICTS_LABEL, maxResults=20)
        plain = _run(maxResults=20)
        self.assertEqual([r["id"] for r in wide["results"]],
                         [r["id"] for r in plain["results"]])
        self.assertIsNone(wide["request"]["district"] and
                          wide["debug"]["districtFilter"])
        self.assertIsNone(wide["debug"]["districtFilter"])

    def test_the_district_also_steers_recall_and_ranking(self):
        """A hard constraint overrides a soft preference parsed from prose."""
        result = _run(query="上海 徐汇附近 的 AI 活动", district="静安",
                      maxResults=20)
        self.assertEqual(result["request"]["district"], "静安")
        # "徐汇附近" would have set 徐汇; the explicit picker wins.
        self.assertEqual(result["request"]["locationPreference"], "静安")

    def test_unknown_district_data_is_never_guessed_into_the_selection(self):
        """A record with no usable district is eligible for nothing."""
        rows = _thirty_candidates()
        # A real place that is not a Shanghai district.
        rows[0]["district"] = "朝阳"
        # Nothing to go on anywhere: no district, and a location that only
        # names the city (`rawLocation` would otherwise still say a district).
        rows[1]["district"] = None
        rows[1]["rawLocation"] = "上海"
        # The district field is empty but the address states the district.
        rows[2]["district"] = None
        rows[2]["rawLocation"] = "上海"
        rows[2]["address"] = "上海市徐汇区龙腾大道 2600 号"
        provider = ManualSearchProvider(rows, name="topk-test", match_all=True)
        result = search_events(
            {"query": "上海 AI 活动", "topics": ["AI"], "district": "徐汇",
             "maxResults": 20},
            providers=[provider], today=TODAY, enrich=False,
            settings=SearchSettings(mode="demo"))
        ids = sorted(r["id"] for r in result["results"])
        self.assertEqual(ids, ["cand-03", "cand-21", "cand-22"])
        self.assertNotIn("cand-01", ids, "朝阳 must not be guessed into 徐汇")
        self.assertNotIn("cand-02", ids, "an unknown district must not match")


class DistrictPredicateTest(unittest.TestCase):
    """The pure rule, pinned directly (it is shared with ui_kits/app/district.js)."""

    def test_whole_city_values_resolve_to_no_constraint(self):
        for value in (None, "", "   ", ALL_DISTRICTS_LABEL, "上海"):
            self.assertIsNone(resolve_district(value), repr(value))

    def test_known_districts_resolve_to_their_short_name(self):
        for value in ("徐汇", "徐汇区", "上海市徐汇区", "上海·徐汇", "浦东", "浦东新区"):
            self.assertEqual(resolve_district(value),
                             "徐汇" if "徐汇" in value else "浦东", value)

    def test_unknown_values_are_passed_through_so_they_match_nothing(self):
        # Dropping them silently would turn a typo into a city-wide search.
        self.assertEqual(resolve_district("朝阳"), "朝阳")
        self.assertEqual(resolve_district("火星"), "火星")

    def test_unknown_record_districts_are_never_the_selected_one(self):
        for value in (None, "", "朝阳", "北京·朝阳", "火星", "上海"):
            self.assertIsNone(district_of_record({"district": value}), repr(value))
            self.assertFalse(district_matches({"district": value}, "徐汇"), repr(value))

    def test_a_record_without_a_district_is_not_eligible(self):
        self.assertFalse(district_matches({}, "徐汇"))
        self.assertFalse(district_matches({"district": None}, "徐汇"))

    def test_an_address_may_carry_the_district_the_field_omitted(self):
        self.assertTrue(district_matches({"address": "上海市徐汇区龙腾大道 2600 号"},
                                         "徐汇"))

    def test_no_constraint_means_everything_is_eligible(self):
        for activity in ({}, {"district": None}, {"district": "浦东"}):
            self.assertTrue(district_matches(activity, None))
            self.assertTrue(district_matches(activity, ""))
            self.assertTrue(district_matches(activity, ALL_DISTRICTS_LABEL))

    def test_a_wrong_district_is_not_eligible(self):
        self.assertFalse(district_matches({"district": "浦东"}, "徐汇"))
        self.assertTrue(district_matches({"district": "徐汇"}, "徐汇"))


class DistrictTopKApiContractTest(unittest.TestCase):
    """The HTTP boundary, on the recorded fixture — real data, real districts.

    Today is pinned to the demo's reference date so the ranking (and hence
    which 徐汇 activities sit outside the city-wide top 20) is reproducible.
    """

    @classmethod
    def setUpClass(cls):
        cls._saved_limiter = GorgonRequestHandler.rate_limiter
        cls.server = make_server(port=0, host="127.0.0.1", mode="demo",
                                 today=TODAY,
                                 settings=SearchSettings(mode="demo"))
        GorgonRequestHandler.rate_limiter = RateLimiter(limit=10_000)
        cls.base = "http://127.0.0.1:%d" % cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        GorgonRequestHandler.rate_limiter = cls._saved_limiter
        cls.server.shutdown()
        cls.server.server_close()

    def search(self, **payload):
        payload.setdefault("query", DEMO_QUERY)
        payload.setdefault("maxResults", 20)
        data = json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            self.base + "/api/search", data=data,
            headers={"Content-Type": "application/json"}, method="POST")
        try:
            with OPENER.open(request, timeout=60) as response:
                return response.status, json.loads(
                    response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            return exc.code, json.loads(exc.read().decode("utf-8"))

    # -- the contract -------------------------------------------------------

    def test_district_is_forwarded_not_just_echoed(self):
        status, body = self.search(district="徐汇")
        self.assertEqual(status, 200)
        self.assertEqual(body["district"], "徐汇")
        self.assertEqual(body["request"]["district"], "徐汇")
        self.assertEqual(body["request"]["locationPreference"], "徐汇")

    def test_every_returned_activity_is_in_the_requested_district(self):
        status, body = self.search(district="徐汇")
        self.assertEqual(status, 200)
        self.assertTrue(body["results"])
        for item in body["results"]:
            self.assertEqual((item.get("activity") or {}).get("district"), "徐汇")

    def test_district_hits_outside_the_city_wide_top_twenty_are_returned(self):
        """The regression, over HTTP, on real recorded data.

        The demo fixture holds 13 徐汇 activities, but only 10 of them are
        inside the city-wide top 20. The old contract could therefore only
        ever return 10 — and reported the district as empty when it had none.
        """
        status_plain, plain = self.search(maxResults=20)
        self.assertEqual(status_plain, 200)
        in_top20 = {r["id"] for r in plain["results"]
                    if (r.get("activity") or {}).get("district") == "徐汇"}

        status, body = self.search(district="徐汇", maxResults=20)
        self.assertEqual(status, 200)
        scoped = {r["id"] for r in body["results"]}

        self.assertTrue(in_top20, "the fixture must contain 徐汇 hits in the top 20")
        self.assertTrue(scoped.issuperset(in_top20))
        beyond = scoped - in_top20
        self.assertTrue(beyond,
                        "no 徐汇 activity outside the city-wide top 20 came back")
        # Pinned: 13 in the district, 10 of them inside the top 20.
        self.assertEqual(len(scoped), 13)
        self.assertEqual(len(in_top20), 10)
        self.assertEqual(sorted(beyond), ["sr002", "sr007", "sr024"])

    def test_all_shanghai_returns_the_uncut_city_wide_list(self):
        status_plain, plain = self.search(maxResults=20)
        status, body = self.search(district="全上海", maxResults=20)
        self.assertEqual(status, 200)
        self.assertEqual(body["district"], "全上海")
        self.assertEqual([r["id"] for r in body["results"]],
                         [r["id"] for r in plain["results"]])
        districts = {(r["activity"] or {}).get("district") for r in body["results"]}
        self.assertGreater(len(districts), 1)

    def test_an_unsupported_district_is_still_refused(self):
        status, body = self.search(district="火星")
        self.assertEqual(status, 400)
        self.assertEqual(body["error"], "invalid_district")

    def test_a_district_with_no_activities_is_empty_not_filled(self):
        """Honest emptiness: never padded with another district's rows."""
        status, body = self.search(district="金山", maxResults=20)
        self.assertEqual(status, 200)
        self.assertEqual(body["results"], [])


if __name__ == "__main__":
    unittest.main()
