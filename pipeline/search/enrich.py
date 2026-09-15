# Enrichment stage (PHASE 5): SearchResult -> PageFetcher -> EventExtractor.
#
# This is the step that makes Gorgon a real retrieval product rather than a
# search-results viewer. A search hit is NOT an event, so for the best hits we
#   fetch the candidate page
#   parse its metadata (og:image, twitter:image, JSON-LD, hero image, agenda)
#   extract the event fields, with per-field provenance
# and hand the RESULT back in the RawSearchResult shape the rest of the
# pipeline already understands. No second normalize, no second dedupe.
#
# Priority rules (never inverted):
#   page-extracted value  >  listing-row hint  >  nothing
# A page-extracted value NEVER overwrites a field the page did not state, and
# a listing hint is only used where it exists. Nothing is ever synthesised.
#
# Failure isolation: a single dead site yields a hit with fewer facts and a
# `fetch` record explaining why — the search itself still succeeds.

from pipeline.search.cache import MetadataCache, NullCache
from pipeline.search.events import EventExtractor
from pipeline.search.extract import IMG_PLACEHOLDER, parse_page
from pipeline.search.fetcher import PageFetcher
from pipeline.search.placeholders import is_placeholder
from pipeline.search.settings import SearchSettings

# Fields the extractor may fill on a RawSearchResult, and which the pipeline's
# canonical raw schema already knows about (see pipeline/search/adapter.py).
_EXTRACTED_FIELDS = (
    "title", "description", "rawDate", "rawTime", "rawEndTime", "rawEndDate",
    "city", "district", "venue", "address", "rawPrice", "organizer",
    "registrationUrl", "publishedAt", "imageUrl", "imageSource",
)

_HINT_FIELDS = ("rawDate", "rawTime", "rawEndTime", "city", "district",
                "rawVenue", "address", "rawPrice", "organizer", "imageUrl")

# imageSource is provenance, not a fact: it stays out of the field-origin map
# (which records which SOURCE supplied a value).
_PROVENANCE_ONLY_FIELDS = ("imageSource",)


class Enricher(object):
    """Fetch + extract for a bounded number of search hits."""

    name = "enricher"

    def __init__(self, settings=None, fetcher=None, extractor=None, cache=None,
                 today=None, clock=None):
        self.settings = settings or SearchSettings()
        self.fetcher = fetcher or PageFetcher(self.settings)
        self.extractor = extractor or EventExtractor(today=today)
        if cache is None:
            cache = (MetadataCache(self.settings.cache_dir)
                     if self.settings.cache_dir else NullCache())
        self.cache = cache
        self._clock = clock
        self.stats = {
            "candidates": 0, "attempted": 0, "fetched": 0, "cacheHits": 0,
            "failed": 0, "skippedBudget": 0, "placeholderImages": 0,
            "realImages": 0, "byReason": {},
        }

    # -- time ---------------------------------------------------------------

    def _now(self):
        if self._clock:
            return self._clock()
        import time
        return time.monotonic()

    # -- hints --------------------------------------------------------------

    @staticmethod
    def hint_of(result):
        """The listing row's own values, offered to the extractor as hints."""
        return {
            "title": result.title,
            "snippet": result.snippet,
            "rawDate": result.rawDate,
            "rawTime": result.rawTime,
            "rawEndTime": result.rawEndTime,
            "rawVenue": result.rawVenue,
            "address": result.address,
            "city": result.city,
            "district": result.district,
            "rawPrice": result.rawPrice,
            "organizer": result.organizer,
            "registrationUrl": result.registrationUrl,
            "thumbnail": result.imageUrl,
            "tags": list(result.tags or []),
        }

    # -- one result ---------------------------------------------------------

    def enrich_one(self, result):
        """Fetch + extract for a single RawSearchResult (mutates and returns).

        The cache stores the EXTRACTED payload (not the raw HTML and not the
        parsed page), so a cached run produces byte-identical fields to a
        fresh run — HTML is not kept on disk, and images are referenced by
        URL rather than downloaded.
        """
        url = result.url
        info = {
            "url": url,
            "fetch": None,
            "confidence": "thin",
            "fieldSources": {},
            "agenda": [],
            "skipped": None,
        }

        cached = None if not url else self.cache.get("extract", url)
        if cached is not None:
            self.stats["cacheHits"] += 1
            info["fetch"] = dict(cached.get("fetch") or {})
            info["fetch"]["fromCache"] = True
            info["confidence"] = cached.get("confidence") or "thin"
            info["fieldSources"] = dict(cached.get("fieldSources") or {})
            info["agenda"] = list(cached.get("agenda") or [])
            self._apply(result, cached.get("fields") or {})
            # Safety net for entries written before imageSource was cached:
            # a placeholder URL must never be presented as real artwork.
            if not result.imageSource and result.imageUrl and is_placeholder(result.imageUrl):
                result.imageSource = IMG_PLACEHOLDER
            result.extractInfo = info
            if (cached.get("imageType") or "remote") == "placeholder":
                self.stats["placeholderImages"] += 1
            else:
                self.stats["realImages"] += 1
            return result

        page = None
        if url:
            self.stats["attempted"] += 1
            fetched = self.fetcher.fetch(url)
            info["fetch"] = fetched.to_dict()
            if fetched.ok:
                self.stats["fetched"] += 1
                page = parse_page(fetched.html, url=url, final_url=fetched.finalUrl)
            else:
                self.stats["failed"] += 1
                reason = fetched.reason or "unknown"
                self.stats["byReason"][reason] = self.stats["byReason"].get(reason, 0) + 1

        extracted = self.extractor.extract(
            page, hint=self.hint_of(result), source_url=url,
            fallback_title=result.title)

        fields = {}
        for field_name in _EXTRACTED_FIELDS:
            value = getattr(extracted, field_name, None)
            if value not in (None, "", []):
                fields[field_name] = value
        applied = {k: extracted.fieldSources.get(k) for k in fields
                   if k not in _PROVENANCE_ONLY_FIELDS}
        for hint_field in _HINT_FIELDS:
            if hint_field in fields:
                continue
            if getattr(result, hint_field, None) not in (None, "", []):
                applied[hint_field] = "listing"

        self._apply(result, fields)
        if extracted.tags:
            result.tags = list(extracted.tags)
        result.imageSource = extracted.imageSource
        info["confidence"] = extracted.confidence
        info["fieldSources"] = applied
        info["agenda"] = [dict(a) for a in extracted.agenda]
        info["structured"] = _structured_summary(extracted)
        result.extractInfo = info

        if self.cache.enabled and url:
            self.cache.put("extract", url, {
                "fields": fields,
                "fieldSources": applied,
                "confidence": extracted.confidence,
                "agenda": info["agenda"],
                "imageType": extracted.imageType,
                "fetch": {k: v for k, v in (info["fetch"] or {}).items()
                          if k != "html"},
            })

        if extracted.imageType == "placeholder":
            self.stats["placeholderImages"] += 1
        else:
            self.stats["realImages"] += 1
        return result

    @staticmethod
    def _apply(result, fields):
        for key, value in (fields or {}).items():
            if value in (None, "", []):
                continue
            setattr(result, key, value)

    # -- batch --------------------------------------------------------------

    def enrich(self, results, limit=None, budget=None, workers=None):
        """Enrich up to `limit` hits within `budget` seconds.

        Order is preserved. Hits past the limit (or past the budget) are
        returned untouched, flagged with skipped="limit"/"budget" so the UI
        can say so instead of pretending they were checked.
        """
        settings = self.settings
        limit = settings.enrich_limit if limit is None else limit
        budget = settings.enrich_budget if budget is None else budget
        workers = settings.enrich_workers if workers is None else workers
        self.stats["candidates"] = len(results)

        if not settings.fetch_pages or not results:
            for result in results:
                result.extractInfo = {"skipped": "fetch_disabled", "fetch": None,
                                      "confidence": "thin", "fieldSources": {},
                                      "agenda": []}
            return list(results), self.stats

        targets = list(results[:max(0, limit)])
        untouched = list(results[len(targets):])
        for result in untouched:
            result.extractInfo = {"skipped": "limit", "fetch": None,
                                  "confidence": "thin", "fieldSources": {},
                                  "agenda": []}
        self.stats["skippedBudget"] += len(untouched)

        # Spend the fetch budget on the hits that already look like events: a
        # row the source itself dated or located is far more likely to be a
        # real activity page than a generic search result. Order is restored
        # afterwards, so `enrich` never reorders the caller's list.
        priority = sorted(range(len(targets)),
                          key=lambda i: (-_promise(targets[i]), i))
        ordered = [targets[i] for i in priority]

        started = self._now()
        done = {}
        if workers and workers > 1 and len(ordered) > 1:
            from concurrent.futures import ThreadPoolExecutor
            with ThreadPoolExecutor(max_workers=min(workers, len(ordered))) as pool:
                for index, enriched in zip(priority, pool.map(self._guarded, ordered)):
                    done[index] = enriched
        else:
            for index, result in zip(priority, ordered):
                if (self._now() - started) > budget:
                    result.extractInfo = {"skipped": "budget", "fetch": None,
                                          "confidence": "thin", "fieldSources": {},
                                          "agenda": []}
                    self.stats["skippedBudget"] += 1
                    done[index] = result
                    continue
                done[index] = self._guarded(result)

        enriched = [done.get(i, targets[i]) for i in range(len(targets))]
        return enriched + untouched, self.stats

    def _guarded(self, result):
        try:
            return self.enrich_one(result)
        except Exception as exc:  # noqa: BLE001 - one page must not kill a search
            result.extractInfo = {
                "skipped": "error", "fetch": {"ok": False, "reason": "extract_error",
                                              "detail": repr(exc)[:160]},
                "confidence": "thin", "fieldSources": {}, "agenda": []}
            self.stats["failed"] += 1
            return result


def _promise(result):
    """How likely is this hit to be a real, usable event page? (0-4)"""
    score = 0
    if result.rawDate or result.rawTime:
        score += 2
    if result.rawVenue or result.district or result.address:
        score += 1
    if result.rawPrice or result.organizer:
        score += 1
    return score


def _structured_summary(extracted):
    sources = sorted({v for v in (extracted.fieldSources or {}).values() if v})
    return {"fieldSources": sources, "confidence": extracted.confidence,
            "imageSource": extracted.imageSource}
