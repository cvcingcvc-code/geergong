# Tests for the relevance fixes found by wiring up real sources (PHASE 5).
#
# Three separate defects, each of which produced a *wrong answer* rather than a
# crash, and each of which is why these tests exist:
#
#   1. Topic matching used `token in text`, so the two-letter topic "AI" was
#      satisfied by "Shanghai", "email", "available" and "train". Every
#      Shanghai event scored as a perfect AI match and the UI printed
#      "AI 主题高度匹配" for activities with no AI content at all.
#   2. The provider topic gate fell back to the unfiltered listing when nothing
#      matched, so a browse page (音乐剧, 脱口秀) was returned as if it were the
#      answer to a search for AI meetups.
#   3. Location scoring returned early when the district was unknown, so a
#      北京 event outranked in-city events on a 上海 query.
#
# Plus the image-provenance contract: every row must leave the enricher with an
# imageUrl/imageSource/imageType triple that does not contradict itself.

import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from pipeline.search.enrich import Enricher                       # noqa: E402
from pipeline.search.extract import (IMG_PLACEHOLDER, IMG_THUMBNAIL,  # noqa: E402
                                     upgrade_image_size)
from pipeline.search.matching import matched_tokens, mentions     # noqa: E402
from pipeline.search.models import SearchRequest, new_raw_result  # noqa: E402
from pipeline.search.ranker import RANKING_WEIGHTS, score_location_fit  # noqa: E402
from pipeline.search.settings import SearchSettings               # noqa: E402
from pipeline.search.webproviders import (MeetupProvider,         # noqa: E402
                                          _meetup_state,
                                          detect_search_keyword,
                                          relevance_gate)


# --- 1. topic matching -------------------------------------------------------

class TopicMatchingTests(unittest.TestCase):

    def test_latin_token_is_not_satisfied_by_a_substring(self):
        """"AI" must not be found inside "Shanghai" — the whole bug."""
        self.assertFalse(mentions("Saturday Afternoon World Mates Meetup, Shanghai", ["ai"]))
        self.assertFalse(mentions("email available train painting", ["ai"]))
        self.assertFalse(mentions("Shanghai Pub Crawl", ["ai", "agent"]))

    def test_latin_token_still_matches_real_mentions(self):
        for text in ("上海 AI 活动", "AI/Agent 黑客松", "（AI）", "AI-Agent",
                     "用AI做产品", "an AI event", "vibe coding"):
            self.assertTrue(mentions(text, ["ai"]) or mentions(text, ["vibe coding"]), text)

    def test_cjk_token_matches_as_a_substring(self):
        # Chinese has no delimiters, so substring is the only correct rule.
        self.assertTrue(mentions("第30届智能体驱动的GOPS全球运维大会", ["智能体"]))
        self.assertFalse(mentions("第30届运维大会", ["智能体"]))

    def test_mixed_token_anchors_only_its_latin_edge(self):
        self.assertTrue(mentions("AI 产品经理沙龙", ["ai 产品"]))
        self.assertFalse(mentions("Shanghai 产品经理沙龙", ["ai 产品"]))

    def test_matching_is_case_insensitive_and_returns_the_hits(self):
        self.assertTrue(mentions("VIBE CODING 工作坊", ["vibe coding"]))
        self.assertEqual(matched_tokens("AI Agent 沙龙", ["AI", "Agent", "Vibe Coding"]),
                         ["AI", "Agent"])

    def test_empty_inputs_are_false_not_errors(self):
        self.assertFalse(mentions("", ["ai"]))
        self.assertFalse(mentions("AI", []))
        self.assertFalse(mentions(None, ["ai", None, ""]))


# --- 2. the provider topic gate ---------------------------------------------

class RelevanceGateTests(unittest.TestCase):

    def test_strict_gate_refuses_to_pass_off_a_browse_listing(self):
        rows = [{"title": "音乐剧《时光代理人》"}, {"title": "脱口秀综艺"},
                {"title": "沉浸式悬疑话剧"}]
        self.assertEqual(relevance_gate(rows, ["ai"], strict=True), [])

    def test_strict_gate_keeps_only_the_rows_that_match(self):
        rows = [{"title": "音乐剧"}, {"title": "上海 AI 沙龙"}, {"title": "脱口秀"}]
        kept = relevance_gate(rows, ["ai"], strict=True)
        self.assertEqual([r["title"] for r in kept], ["上海 AI 沙龙"])

    def test_lenient_gate_preserves_recall_for_query_derived_hits(self):
        rows = [{"title": "音乐剧"}, {"title": "AI 沙龙"}]
        self.assertEqual(len(relevance_gate(rows, ["ai"], strict=False)), 1)
        # A search engine's near miss is still a result, so nothing matching
        # must not zero the list.
        self.assertEqual(len(relevance_gate([{"title": "音乐剧"}], ["ai"], strict=False)), 1)

    def test_no_topic_means_the_user_wants_to_browse(self):
        rows = [{"title": "音乐剧"}, {"title": "脱口秀"}]
        self.assertEqual(relevance_gate(rows, [], strict=True), rows)
        self.assertEqual(relevance_gate(rows, None, strict=True), rows)


# --- 3. Meetup: a real keyword-scoped source ---------------------------------

def _meetup_state_payload(events, extra=None):
    """A minimal Apollo cache shaped exactly like Meetup's own."""
    state = dict(extra or {})
    for event in events:
        state["Event:%s" % event["id"]] = event
    return state


def _event(event_id, title, date_time, **overrides):
    node = {
        "__typename": "Event", "id": event_id, "title": title,
        "description": "A casual meetup.", "dateTime": date_time,
        "eventUrl": "https://www.meetup.com/grp/events/%s/" % event_id,
        "eventType": "PHYSICAL",
        "venue": {"__typename": "Venue", "name": "1984 Book Store",
                  "address": "11 Hunan Road", "city": "Shanghai", "country": "cn"},
        "group": {"__typename": "Group", "name": "ShanghAI AI"},
    }
    node.update(overrides)
    return node


class MeetupProviderTests(unittest.TestCase):

    def _provider(self):
        return MeetupProvider(settings=SearchSettings(online=False, proxy=None))

    def test_state_is_read_out_of_the_next_data_blob(self):
        payload = {"props": {"pageProps": {"__APOLLO_STATE__": {"Event:1": {"a": 1}}}}}
        html = ('<html><script id="__NEXT_DATA__" type="application/json">%s'
                '</script></html>' % json.dumps(payload))
        self.assertEqual(_meetup_state(html), {"Event:1": {"a": 1}})

    def test_missing_state_is_reported_not_crashed(self):
        self.assertIsNone(_meetup_state("<html>no data</html>"))
        self.assertIsNone(_meetup_state(""))

    def test_events_become_rows_with_source_stated_fields(self):
        state = _meetup_state_payload([
            _event("1", "ShanghAI AI 周六线下聚会", "2099-09-19T19:30:00+08:00"),
        ])
        rows = self._provider().parse_state(state)
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(row["title"], "ShanghAI AI 周六线下聚会")
        self.assertEqual(row["rawDate"], "2099-09-19")
        self.assertEqual(row["rawTime"], "19:30")
        self.assertEqual(row["city"], "上海")          # bridged from Shanghai
        self.assertEqual(row["rawVenue"], "1984 Book Store")
        self.assertEqual(row["organizer"], "ShanghAI AI")
        self.assertEqual(row["registrationUrl"],
                         "https://www.meetup.com/grp/events/1/")

    def test_district_is_never_invented_from_a_street_address(self):
        state = _meetup_state_payload([
            _event("1", "AI 沙龙", "2099-09-19T19:30:00+08:00")])
        self.assertIsNone(self._provider().parse_state(state)[0]["district"])

    def test_price_is_null_when_the_source_states_none(self):
        """Meetup renders no Free marker, so absence is not a free ticket."""
        state = _meetup_state_payload([
            _event("1", "AI 沙龙", "2099-09-19T19:30:00+08:00", feeSettings=None)])
        self.assertIsNone(self._provider().parse_state(state)[0]["rawPrice"])

    def test_price_comes_from_fee_settings_when_present(self):
        state = _meetup_state_payload([
            _event("1", "AI 峰会", "2099-09-19T19:30:00+08:00",
                   feeSettings={"__typename": "EventFeeSettings",
                                "accepts": "CASH", "currency": "USD",
                                "amount": 20})])
        self.assertEqual(self._provider().parse_state(state)[0]["rawPrice"], "USD 20")

    def test_online_events_say_so_instead_of_naming_a_venue(self):
        state = _meetup_state_payload([
            _event("1", "AI 线上分享", "2099-09-19T19:30:00+08:00",
                   eventType="ONLINE", venue=None)])
        row = self._provider().parse_state(state)[0]
        self.assertEqual(row["rawVenue"], "线上活动")
        self.assertIsNone(row["city"])

    def test_already_ended_events_are_dropped(self):
        state = _meetup_state_payload([
            _event("1", "AI 沙龙", "2000-01-01T19:30:00+08:00"),
            _event("2", "AI 沙龙", "2099-01-01T19:30:00+08:00")])
        rows = self._provider().parse_state(state)
        self.assertEqual([r["title"] for r in rows], ["AI 沙龙"])
        self.assertEqual(len(rows), 1)

    def test_a_ref_shaped_venue_is_dereferenced(self):
        state = _meetup_state_payload(
            [_event("1", "AI 沙龙", "2099-09-19T19:30:00+08:00",
                    venue={"__ref": "Venue:7"},
                    featuredEventPhoto={"__ref": "PhotoInfo:9"})],
            extra={"Venue:7": {"name": "WeWork 徐汇", "address": "虹桥路 1 号",
                               "city": "Shanghai", "country": "cn"},
                   "PhotoInfo:9": {"highResUrl": "https://img.test/a.jpg"}})
        row = self._provider().parse_state(state)[0]
        self.assertEqual(row["rawVenue"], "WeWork 徐汇")
        self.assertEqual(row["thumbnail"], "https://img.test/a.jpg")

    def test_the_row_image_is_then_labelled_a_thumbnail(self):
        state = _meetup_state_payload(
            [_event("1", "AI 沙龙", "2099-09-19T19:30:00+08:00",
                    featuredEventPhoto={"__ref": "PhotoInfo:9"})],
            extra={"PhotoInfo:9": {"highResUrl": "https://img.test/a.jpg"}})
        self.assertIsNotNone(self._provider().parse_state(state)[0]["thumbnail"])
        self.assertEqual(_listing_label("https://img.test/a.jpg"), IMG_THUMBNAIL)

    def test_a_listing_without_any_photo_reports_no_image(self):
        state = _meetup_state_payload(
            [_event("1", "AI 沙龙", "2099-09-19T19:30:00+08:00")])
        self.assertIsNone(self._provider().parse_state(state)[0]["thumbnail"])
        self.assertIsNone(_listing_label(None))

    def test_keyword_is_taken_from_the_query_not_the_whole_sentence(self):
        self.assertEqual(detect_search_keyword("上海 AI 活动 本周末"), "AI")
        self.assertEqual(detect_search_keyword("上海 AI Agent Meetup 本周末"), "AI Agent")
        self.assertEqual(detect_search_keyword("上海 vibe coding 活动"), "vibe coding")
        self.assertIsNone(detect_search_keyword("这个周末上海有什么活动"))

    def test_url_is_city_scoped_and_keyword_scoped(self):
        url = self._provider().build_url("上海 AI Agent 活动 本周末")
        self.assertIn("location=cn--Shanghai", url)
        self.assertIn("keywords=AI+Agent", url)

    def test_url_falls_back_to_browsing_when_there_is_no_topic(self):
        url = self._provider().build_url("这个周末上海有什么活动")
        self.assertIn("location=cn--Shanghai", url)
        self.assertNotIn("keywords=", url)

    def test_offline_never_returns_rows(self):
        provider = MeetupProvider(settings=SearchSettings(online=False, proxy=None))
        self.assertEqual(provider.search(_query("上海 AI 活动")), [])


def _listing_label(url):
    """Mirror of the label the provider attaches to a listing-row image."""
    from pipeline.search.webproviders import _listing_image_source
    return _listing_image_source(url)


def _query(text, topic=None):
    from pipeline.search.models import SearchQuery
    return SearchQuery(text=text, topic=topic or "AI")


# --- 4. location scoring -----------------------------------------------------

class LocationScoringTests(unittest.TestCase):

    def _request(self):
        return SearchRequest.from_dict({
            "query": "上海 AI 活动", "city": "上海", "locationPreference": "徐汇"})

    def test_a_wrong_city_loses_even_when_the_district_is_unknown(self):
        request = self._request()
        beijing, _ = score_location_fit({"city": "北京", "district": None}, request)
        shanghai_unknown, _ = score_location_fit({"city": "上海", "district": None}, request)
        self.assertLess(beijing, shanghai_unknown)

    def test_an_exact_district_beats_everything(self):
        request = self._request()
        exact, reasons = score_location_fit({"city": "上海", "district": "徐汇"}, request)
        same_city, _ = score_location_fit({"city": "上海", "district": "浦东"}, request)
        self.assertGreater(exact, same_city)
        self.assertEqual(reasons, ["位于徐汇"])

    def test_no_preference_is_neutral(self):
        request = SearchRequest.from_dict({"query": "上海 活动", "city": "上海"})
        score, reasons = score_location_fit({"city": "北京"}, request)
        self.assertEqual(reasons, [])

    def test_relevance_dominates_the_weights(self):
        # Guards the product decision, not the arithmetic: topic fit must stay
        # the single heaviest signal.
        self.assertEqual(max(RANKING_WEIGHTS, key=RANKING_WEIGHTS.get), "relevance")


# --- 5. the image contract --------------------------------------------------

class ImageConsistencyTests(unittest.TestCase):

    def _enricher(self):
        return Enricher(settings=SearchSettings(online=False, proxy=None,
                                                fetch_pages=False))

    def test_a_row_with_no_picture_gets_a_labelled_placeholder(self):
        result = new_raw_result(resultId="r1", title="AI 沙龙", city="上海")
        out, _stats = self._enricher().enrich([result])
        row = out[0]
        self.assertTrue(row.imageUrl)
        self.assertEqual(row.imageSource, IMG_PLACEHOLDER)
        self.assertEqual(row.imageType, "placeholder")

    def test_a_listing_image_is_labelled_as_a_thumbnail_not_as_our_artwork(self):
        result = new_raw_result(resultId="r1", title="AI 沙龙",
                                imageUrl="https://cdn.test/cover.jpg")
        out, _stats = self._enricher().enrich([result])
        self.assertEqual(out[0].imageSource, IMG_THUMBNAIL)
        self.assertEqual(out[0].imageType, "remote")

    def test_a_placeholder_url_is_never_dressed_up_as_a_real_photo(self):
        result = new_raw_result(
            resultId="r1", title="AI 沙龙",
            imageUrl="/assets/placeholders/ai.svg")
        out, _stats = self._enricher().enrich([result])
        self.assertEqual(out[0].imageSource, IMG_PLACEHOLDER)
        self.assertEqual(out[0].imageType, "placeholder")

    def test_the_triple_always_agrees(self):
        rows = [new_raw_result(resultId="a", title="有图", imageUrl="https://cdn.test/a.jpg"),
                new_raw_result(resultId="b", title="无图")]
        out, _stats = self._enricher().enrich(rows)
        for row in out:
            self.assertTrue(row.imageUrl, "every row must carry something to draw")
            self.assertEqual(row.imageType,
                             "placeholder" if row.imageSource == IMG_PLACEHOLDER
                             else "remote")

    def test_douban_posters_are_upgraded_to_the_large_rendition(self):
        small = "https://img3.doubanio.com/pview/event_poster/small/public/x.jpg"
        self.assertEqual(upgrade_image_size(small),
                         "https://img3.doubanio.com/pview/event_poster/large/public/x.jpg")

    def test_unknown_hosts_are_left_alone(self):
        url = "https://cdn.test/photos/small/public/x.jpg"
        self.assertEqual(upgrade_image_size(url), url)
        self.assertIsNone(upgrade_image_size(None))


if __name__ == "__main__":
    unittest.main()
