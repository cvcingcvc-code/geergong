# The canonical demo scenario (PHASE 12).
#
# A reproducible retrieval story: run this exact query on this exact
# reference date and the fixture produces a stable, reviewable result set.
#
# The reference date is PINNED because the fixture is a snapshot: on a later
# date the same query still works, but "本周末" no longer lines up with the
# recorded events and time-fit scores drop (which is the honest behaviour).

from datetime import date

from pipeline.search.service import search_events

DEMO_QUERY = "这个周末上海有什么 AI / Agent / Vibe Coding 的活动？最好免费，徐汇附近，下午开始。"
DEMO_TODAY = date(2026, 9, 15)   # Tuesday before the recorded weekend (09-19 / 09-20)


def run_demo(today=None, debug=True, provider=None):
    """Run the demo scenario. `today` defaults to the pinned snapshot date."""
    return search_events(
        DEMO_QUERY,
        provider=provider,
        today=today or DEMO_TODAY,
        debug=debug,
    )
