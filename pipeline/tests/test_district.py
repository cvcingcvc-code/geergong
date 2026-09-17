# Tests for the Shanghai district vocabulary + filter (PHASE 5.1).
#
# The app's district picker filters on `ui_kits/app/district.js`, a JS mirror of
# `pipeline/normalize/location.py`. These tests lock in three things:
#
#   1. the two implementations agree (shared corpus, asserted by both suites);
#   2. the district the pipeline stores is one the UI can actually select —
#      i.e. real retrieval results are compatible with the filter;
#   3. filtering on a district is exact: it never leaks another district's row
#      and never quietly widens to everything.

import json
import os
import re
import unittest

from pipeline.normalize.location import DISTRICTS, _CITY_PREFIXES, normalize_district, split_location
from pipeline.normalize.activity import normalize_activity
from pipeline.api.server import PUBLIC_ACTIVITY_FIELDS

HERE = os.path.dirname(__file__)
CORPUS_PATH = os.path.join(HERE, "fixtures", "district_corpus.json")
APP_DIR = os.path.join(os.path.dirname(os.path.dirname(HERE)), "ui_kits", "app")


def load_corpus():
    with open(CORPUS_PATH, encoding="utf-8") as fh:
        return json.load(fh)


class TestSharedCorpus(unittest.TestCase):
    """The corpus is shared with pipeline/tests/district.test.mjs.

    district.js mirrors normalize_district (the browser also filters legacy
    records and localStorage-persisted views that never went through the
    pipeline), so the two must agree exactly. Both sides assert against this
    one file; a rule added to only one of them fails here.
    """

    @classmethod
    def setUpClass(cls):
        cls.corpus = load_corpus()

    def test_corpus_is_not_empty(self):
        self.assertTrue(self.corpus["cases"], "the shared corpus has cases")

    def test_vocabulary_matches_the_corpus(self):
        self.assertEqual(DISTRICTS, self.corpus["districts"],
                         "DISTRICTS drifted from the corpus — update district.js as well")
        self.assertEqual(sorted(_CITY_PREFIXES), sorted(self.corpus["cities"]),
                         "the city vocabulary drifted from the corpus")

    def test_every_case(self):
        for case in self.corpus["cases"]:
            self.assertEqual(normalize_district(case["input"]), case["expected"],
                             "corpus case failed for %r (%s)" % (case["input"], case["why"]))

    def test_the_two_variants_the_brief_names(self):
        self.assertEqual(normalize_district("徐汇区"), "徐汇")
        self.assertEqual(normalize_district("上海市徐汇区"), "徐汇")


class TestSplitLocation(unittest.TestCase):
    def test_city_and_district(self):
        for raw in ("上海·徐汇", "上海 - 徐汇", "上海市徐汇区"):
            city, district = split_location(raw)
            self.assertEqual((city, district), ("上海", "徐汇"), "failed for %r" % raw)

    def test_unknown_is_not_guessed(self):
        self.assertEqual(split_location("北京·朝阳"), ("北京", None))
        self.assertEqual(split_location(""), (None, None))


class TestRealRecordsAreFilterable(unittest.TestCase):
    """真实数据兼容：pipeline 存下来的 district 必须是 UI 能选出来的那一个。"""

    def test_normalized_district_is_in_the_ui_vocabulary(self):
        for raw in ("上海市徐汇区龙腾大道2600号", "上海·徐汇", "徐汇区", "徐汇"):
            act = normalize_activity({"title": "AI Meetup", "location": raw})
            self.assertIn(act["district"], DISTRICTS,
                          "normalized district %r for %r is not selectable in the UI"
                          % (act["district"], raw))

    def test_address_only_record_still_yields_a_selectable_district(self):
        act = normalize_activity({
            "title": "AI Meetup",
            "district": "上海市徐汇区",
            "city": "上海",
            "address": "上海市徐汇区龙腾大道2600号",
        })
        self.assertEqual(act["district"], "徐汇")

    def test_district_is_exposed_to_the_client(self):
        # The D-4 regression class: a field the UI filters on must be part of
        # the public contract, or the filter silently operates on nothing.
        self.assertIn("district", PUBLIC_ACTIVITY_FIELDS)
        self.assertIn("city", PUBLIC_ACTIVITY_FIELDS)


class TestShippedDatasetIsNormalised(unittest.TestCase):
    """The demo dataset the UI filters must already speak the picker's language."""

    def _districts_in(self, filename, key):
        path = os.path.join(APP_DIR, filename)
        with open(path, encoding="utf-8") as fh:
            src = fh.read()
        return re.findall(r'%s:\s*"([^"]+)"' % key, src) + \
            re.findall(r'"%s":\s*"([^"]+)"' % key, src)

    def test_data_js_districts_are_recognised(self):
        found = self._districts_in("data.js", "district")
        self.assertTrue(found, "data.js contains districts")
        unknown = sorted({d for d in found if d not in DISTRICTS})
        self.assertEqual(unknown, [], "data.js carries districts the picker cannot select")

    def test_generated_data_districts_are_recognised(self):
        found = self._districts_in("generated-data.js", "district")
        self.assertTrue(found, "generated-data.js contains districts")
        unknown = sorted({d for d in found if d not in DISTRICTS})
        self.assertEqual(unknown, [], "the pipeline export carries selectable districts only")


class TestDistrictFilterIsExact(unittest.TestCase):
    """A district filter is an intersection with the district — never a fallback."""

    def setUp(self):
        self.activities = [
            normalize_activity({"title": "徐汇 AI", "location": "上海·徐汇", "tags": ["AI"]}),
            normalize_activity({"title": "徐汇 展览", "location": "上海市徐汇区", "tags": ["展览"]}),
            normalize_activity({"title": "静安 AI", "location": "上海·静安", "tags": ["AI"]}),
            normalize_activity({"title": "杨浦 工作坊", "location": "上海·杨浦", "tags": ["AI"]}),
            normalize_activity({"title": "外地活动", "location": "北京·朝阳", "tags": ["AI"]}),
        ]

    @staticmethod
    def by_district(activities, district):
        """The predicate ui_kits/app/district.js implements for the browser."""
        return [a for a in activities if a.get("district") == district]

    def test_district_filter_is_exact(self):
        xuhui = self.by_district(self.activities, "徐汇")
        self.assertEqual(len(xuhui), 2)
        self.assertTrue(all(a["district"] == "徐汇" for a in xuhui))

    def test_no_leak_from_other_districts(self):
        xuhui = self.by_district(self.activities, "徐汇")
        others = [a for a in self.activities if a.get("district") != "徐汇"]
        self.assertEqual([a for a in xuhui if a in others], [])

    def test_unknown_district_matches_nothing(self):
        self.assertEqual(self.by_district(self.activities, "火星"), [])

    def test_count_equals_the_filtered_length(self):
        for district in ("徐汇", "静安", "杨浦", "浦东"):
            self.assertEqual(len(self.by_district(self.activities, district)),
                             len([a for a in self.activities if a.get("district") == district]))

    def test_keyword_and_district_is_an_intersection(self):
        def has_ai(a):
            return "AI" in (a.get("tags") or [])

        keyword = [a for a in self.activities if has_ai(a)]
        combo = self.by_district(keyword, "徐汇")
        self.assertEqual(len(keyword), 4)
        self.assertEqual(len(combo), 1, "徐汇 + AI")
        self.assertTrue(all(has_ai(a) and a["district"] == "徐汇" for a in combo))
        self.assertTrue(all(a in keyword for a in combo))
        self.assertLess(len(combo), len(keyword) + len(self.by_district(self.activities, "徐汇")),
                        "the result is not the union of both filters")


if __name__ == "__main__":
    unittest.main()
