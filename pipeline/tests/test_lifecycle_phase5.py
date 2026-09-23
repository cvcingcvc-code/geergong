# Lifecycle & freshness tests (PHASE 5).
#
# OFFLINE: direct repository upserts, pinned "today". Covers:
#   * past marking (start_time < today -> status='past')
#   * missing_from_source (seen in a previous crawl, absent from this one)
#   * source reappearance (re-seen row returns to active)
#   * past-event exclusion in search() and search_nearby() by default
#   * incremental upsert (second run: inserted=0, unchanged counts)
#   * freshness_stats shape
#   * date distribution stats

import sys
import unittest
from datetime import date
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = PIPELINE_DIR.parent
for p in (str(REPO_ROOT), str(PIPELINE_DIR)):
    if p not in sys.path:
        sys.path.insert(0, p)

from pipeline.crawlers.models import RawEvent  # noqa: E402
from pipeline.store.repository import EventRepository  # noqa: E402

TODAY = date(2026, 9, 23)
TODAY_STR = "2026-09-23"
NOW = "2026-09-23T12:00:00"
FUTURE = "2026-09-26T14:00:00"
PAST = "2026-09-01T14:00:00"


def _event(title, start, url_suffix):
    return RawEvent(
        title=title, startTime=start, city="上海", district="静安",
        address="南京西路 100 号", price="免费",
        sourceName="豆瓣同城",
        sourceUrl="https://www.douban.com/event/%s/" % url_suffix,
        sourceEventId=url_suffix)


class LifecycleFixture(unittest.TestCase):
    def setUp(self):
        self.repo = EventRepository(":memory:")
        self.repo.open()

    def tearDown(self):
        self.repo.close()

    def add(self, title, start, suffix):
        kind, row_id = self.repo.upsert_event(
            _event(title, start, suffix), now=NOW)
        return row_id

    def status_of(self, suffix):
        row = self.repo._find_by_source_url(
            "https://www.douban.com/event/%s/" % suffix)
        return row["status"] if row else None


class TestPastMarking(LifecycleFixture):
    def test_start_before_today_is_marked_past(self):
        self.add("已结束的活动", PAST, "1001")
        self.add("未来的活动", FUTURE, "1002")
        report = self.repo.apply_lifecycle(today=TODAY_STR, now=NOW)
        self.assertEqual(report["pastMarked"], 1)
        self.assertEqual(self.status_of("1001"), "past")
        self.assertEqual(self.status_of("1002"), "active")


class TestMissingFromSource(LifecycleFixture):
    def test_unseen_active_row_is_marked_missing_not_deleted(self):
        self.add("还在线", FUTURE, "2001")
        self.add("从来源消失了", FUTURE, "2002")
        report = self.repo.apply_lifecycle(
            today=TODAY_STR, seen_source_urls=["https://douban.com/event/2001"],
            source_name="豆瓣同城", now=NOW)
        self.assertEqual(report["missingMarked"], 1)
        self.assertEqual(self.status_of("2001"), "active")
        self.assertEqual(self.status_of("2002"), "missing_from_source")

    def test_reappearance_returns_row_to_active(self):
        self.add("消失又回来", FUTURE, "3001")
        self.repo.apply_lifecycle(today=TODAY_STR, seen_source_urls=[],
                                  source_name="豆瓣同城", now=NOW)
        self.assertEqual(self.status_of("3001"), "missing_from_source")
        # 来源重新出现：同一条活动再次被抓到
        self.repo.upsert_event(_event("消失又回来", FUTURE, "3001"), now=NOW)
        self.assertEqual(self.status_of("3001"), "active")

    def test_interrupted_crawl_marks_nothing_missing(self):
        """A BLOCKED / interrupted crawl passes source_name=None: no rows
        may be marked missing_from_source, or one anti-bot wall would
        "disappear" the whole database (PHASE 5 run.py contract)."""
        self.add("在线一", FUTURE, "3101")
        self.add("在线二", FUTURE, "3102")
        report = self.repo.apply_lifecycle(
            today=TODAY_STR, seen_source_urls=[],
            source_name=None, now=NOW)
        self.assertEqual(report["missingMarked"], 0)
        self.assertEqual(self.status_of("3101"), "active")
        self.assertEqual(self.status_of("3102"), "active")


class TestPastExclusion(LifecycleFixture):
    def test_default_search_excludes_past(self):
        self.add("过去的", PAST, "4001")
        self.add("未来的", FUTURE, "4002")
        self.add("没写日期的", None, "4003")
        rows = self.repo.search(today=TODAY_STR)
        titles = [r["title"] for r in rows]
        self.assertNotIn("过去的", titles)
        self.assertIn("未来的", titles)
        self.assertIn("没写日期的", titles)   # unknown is not "past"
        rows_all = self.repo.search(today=TODAY_STR, include_past=True)
        self.assertIn("过去的", [r["title"] for r in rows_all])

    def test_default_nearby_excludes_past(self):
        row_id = self.add("过去的附近活动", PAST, "5001")
        self.repo.update_coordinates(row_id, 31.2235, 121.4453,
                                     geocode_source="test", now=NOW)
        row_id = self.add("未来的附近活动", FUTURE, "5002")
        self.repo.update_coordinates(row_id, 31.2235, 121.4453,
                                     geocode_source="test", now=NOW)
        hits = self.repo.search_nearby(latitude=31.2235, longitude=121.4453,
                                       radius_km=3, today=TODAY_STR)
        titles = [h["title"] for h in hits]
        self.assertEqual(titles, ["未来的附近活动"])
        hits_all = self.repo.search_nearby(latitude=31.2235,
                                           longitude=121.4453,
                                           radius_km=3, today=TODAY_STR,
                                           include_past=True)
        self.assertEqual(len(hits_all), 2)


class TestIncrementalUpsert(LifecycleFixture):
    def test_second_run_inserts_nothing_and_counts_unchanged(self):
        events = [_event("活动甲", FUTURE, "6001"),
                  _event("活动乙", FUTURE, "6002")]
        first = self.repo.upsert_many(events, now=NOW)
        self.assertEqual(first, {"inserted": 2, "updated": 0, "unchanged": 0})
        second = self.repo.upsert_many(events, now="2026-09-23T13:00:00")
        self.assertEqual(second["inserted"], 0,
                         "第二次 upsert 不得重新插入")
        self.assertEqual(second["unchanged"], 2)
        self.assertEqual(second["updated"], 0)
        self.assertEqual(self.repo.count(), 2)

    def test_content_change_counts_as_updated(self):
        self.add("旧标题", FUTURE, "7001")
        result = self.repo.upsert_many(
            [_event("新标题", FUTURE, "7001")], now=NOW)
        self.assertEqual(result["updated"], 1)
        self.assertEqual(result["unchanged"], 0)


class TestFreshnessStats(LifecycleFixture):
    def test_stats_shape_and_values(self):
        self.add("未来7天", "2026-09-28T10:00:00", "8001")
        self.add("未来30天", "2026-10-20T10:00:00", "8002")
        self.add("更远", "2026-11-20T10:00:00", "8003")
        self.add("已过期", PAST, "8004")
        # 本次 crawl 只看到 8001/8002；8003 未出现 → missing_from_source；
        # 8004 已过日期 → past
        seen = ["https://douban.com/event/8001",
                "https://douban.com/event/8002"]
        self.repo.apply_lifecycle(today=TODAY_STR, seen_source_urls=seen,
                                  source_name="豆瓣同城", now=NOW)
        stats = self.repo.freshness_stats(today=TODAY_STR, now=NOW)
        self.assertEqual(stats["totalEvents"], 4)
        self.assertEqual(stats["totalActive"], 2)
        self.assertEqual(stats["past"], 1)
        self.assertEqual(stats["missingFromSource"], 1)
        self.assertEqual(stats["next7Days"], 1)
        self.assertEqual(stats["next30Days"], 2)
        self.assertEqual(stats["fetchedLast24h"], 4)
        self.assertEqual(stats["coordinateCoverage"], 0.0)
        self.assertEqual(stats["sourceCoverage"],
                         [{"source": "豆瓣同城", "count": 4}])
        self.assertIsNotNone(stats["oldestFetchAgeHours"])


class TestDateDistribution(LifecycleFixture):
    def test_date_distribution_buckets(self):
        self.repo.upsert_many([
            _event("今天", "2026-09-23T19:00:00", "9001"),
            _event("三天内", "2026-09-26T10:00:00", "9002"),
            _event("七天内", "2026-09-29T10:00:00", "9003"),
            _event("三十天内", "2026-10-20T10:00:00", "9004"),
            _event("更远", "2027-01-01T10:00:00", "9005"),
            _event("过去", PAST, "9006"),
        ], now=NOW)
        rows = self.repo.search(include_past=True, today=TODAY_STR)
        from collections import Counter
        days = Counter((r["start_time"] or "")[:10] for r in rows)
        self.assertEqual(days["2026-09-23"], 1)
        self.assertEqual(days["2026-09-26"], 1)
        self.assertEqual(len([d for d in days if d < TODAY_STR]), 1)


if __name__ == "__main__":
    unittest.main()
