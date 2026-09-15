# SearchProvider abstraction (PHASE 3).
#
# A provider KNOWS HOW TO SEARCH and returns RawSearchResult objects —
# nothing else. It does not normalize, dedupe, score or rank. Swapping
# providers must never require touching the pipeline.
#
# Included in this phase:
#   FixtureSearchProvider  reads pipeline/search/fixtures/*.json
#   ManualSearchProvider   explicit list (curl output pasted by a human,
#                          or an in-memory test double)
#
# Deliberately NOT included: any real network provider. This phase does not
# touch the internet (no crawlers, no map APIs, no third-party search APIs).

import abc
import json
import re
from pathlib import Path

from pipeline.search.models import RawSearchResult

FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures"
DEFAULT_FIXTURE = FIXTURE_DIR / "shanghai_ai_events.json"


class SearchProvider(abc.ABC):
    """Unified provider protocol."""

    name = "base"

    @abc.abstractmethod
    def search(self, query):
        """-> list[RawSearchResult] for one SearchQuery."""
        raise NotImplementedError

    # -- convenience --------------------------------------------------------

    def search_all(self, queries):
        """Run every query and concatenate results (order preserved)."""
        out = []
        for query in queries:
            out.extend(self.search(query))
        return out


def _query_text(query):
    return getattr(query, "text", None) or str(query)


# Relative date words carry no recall information for a recorded fixture:
# "上海 Vibe Coding 活动 本周末" and "上海 Vibe Coding 活动" describe the same
# search. They are stripped from BOTH sides before comparing, so a variant
# query still reaches its recording. Nothing else is fuzzed.
_DATE_TOKENS = (
    "本周末", "这周末", "这个周末", "下周末", "周末",
    "本周", "这周", "下周", "今天", "今日", "明天", "明日",
)


def _norm_query(text):
    t = re.sub(r"\s+", "", str(text or "")).casefold()
    for token in _DATE_TOKENS:
        t = t.replace(token, "")
    return t


def _load_rows(path):
    with open(path, "r", encoding="utf-8") as fh:
        payload = json.load(fh)
    if isinstance(payload, list):
        return payload
    for key in ("results", "items", "rawResults", "raw_results"):
        if isinstance(payload.get(key), list):
            return payload[key]
    return []


class FixtureSearchProvider(SearchProvider):
    """Serves a recorded fixture instead of the network.

    Matching rule (deterministic, documented in the contract): a fixture row
    is returned for a query when its `providerQuery` equals the query text
    after both are normalised (whitespace removed, relative date words
    dropped). No fuzzy matching — a fixture is a recording, not a search
    engine, so an unrecorded query returns nothing.
    """

    name = "fixture"

    def __init__(self, fixture_path=None, provider_name=None):
        self.fixture_path = Path(fixture_path or DEFAULT_FIXTURE)
        self.name = provider_name or "fixture:%s" % self.fixture_path.stem
        self._rows = [_normalize_row(r, self.name)
                      for r in _load_rows(self.fixture_path)]
        self._index = {}
        for row in self._rows:
            self._index.setdefault(_norm_query(row.providerQuery), []).append(row)

    @property
    def rows(self):
        return list(self._rows)

    def search(self, query):
        return list(self._index.get(_norm_query(_query_text(query)), []))

    def available_queries(self):
        return sorted({r.providerQuery for r in self._rows})


def _normalize_row(row, provider_name):
    """Fixture row -> RawSearchResult (keeps provider provenance)."""
    result = RawSearchResult.from_dict(row)
    if not result.resultId:
        from pipeline.search.models import new_raw_result
        result = new_raw_result(**{k: v for k, v in row.items()})
    if not result.provider:
        result.provider = provider_name
    return result


class ManualSearchProvider(SearchProvider):
    """Human-supplied results (pasted from a page, or a test double).

    `match_all=True` returns the same set for every query, which is how a
    human would hand over "everything I found today".
    """

    name = "manual"

    def __init__(self, results, name=None, match_all=False):
        self.name = name or "manual"
        self.match_all = match_all
        rows = results
        if isinstance(results, (str, Path)):
            rows = _load_rows(Path(results))
        self._rows = []
        for row in rows:
            if isinstance(row, RawSearchResult):
                item = row
                if not item.provider:
                    item.provider = self.name
            else:
                item = _normalize_row(row, self.name)
            self._rows.append(item)

    @property
    def rows(self):
        return list(self._rows)

    def search(self, query):
        if self.match_all:
            return list(self._rows)
        text = _query_text(query)
        return [r for r in self._rows if r.providerQuery == text]


def default_provider():
    """Provider used by the CLI / API when none is injected."""
    return FixtureSearchProvider()
