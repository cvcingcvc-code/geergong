# Crawler-layer models (REAL EVENT INDEX V1 — PHASE 1).
#
# RawEvent is the crawler's output record. It is intentionally FLAT and
# source-agnostic: one activity, one page, whatever the source actually
# published. A field the source did not publish stays null — never filled
# from a guess, never defaulted to a plausible value. `rawData` keeps the
# verbatim evidence (listing hints, detail microdata, fetch result) so any
# value here can be traced back to the page it came from.

from dataclasses import dataclass, field, asdict

# The fields PHASE 1 must produce. Everything else lives in rawData.
RAW_EVENT_FIELDS = (
    "title",
    "startTime",
    "endTime",
    "city",
    "district",
    "venueName",
    "address",
    "price",
    "organizer",
    "sourceName",
    "sourceUrl",
    "sourceEventId",
    "rawData",
)


@dataclass
class RawEvent:
    """One activity as the source published it. Unknown == null."""

    title: str = None
    # The source's own datetime attribute, verbatim, e.g. "2026-10-01T08:00:00".
    # Not normalised, not shifted to a timezone, not completed from context.
    startTime: str = None
    endTime: str = None
    city: str = None
    district: str = None          # short name ("长宁"), never a guessed one
    venueName: str = None         # only when the source names a venue as such
    address: str = None
    price: str = None             # the source's own price text, e.g. "免费"
    organizer: str = None
    sourceName: str = None
    sourceUrl: str = None         # the real activity page (traceable)
    sourceEventId: str = None
    rawData: dict = field(default_factory=dict)

    def to_dict(self):
        return asdict(self)

    @classmethod
    def from_dict(cls, d):
        d = d or {}
        known = set(cls().to_dict().keys())
        return cls(**{k: d[k] for k in known if k in d})

    # -- completeness (drives the crawl report) ---------------------------

    def missing_fields(self):
        missing = []
        for key in ("startTime", "venueName", "address"):
            if not getattr(self, key):
                missing.append(key)
        return missing


@dataclass
class ListingEntry:
    """One row found on a listing page: an activity URL plus listing hints.

    Hints are what the listing itself stated. They are used ONLY as a
    fallback when the detail page is missing the fact, and they are always
    recorded in RawEvent.rawData["listing"] so provenance stays visible.
    """

    url: str = None
    sourceEventId: str = None
    title: str = None
    startTime: str = None
    endTime: str = None
    city: str = None
    district: str = None
    address: str = None
    price: str = None
    organizer: str = None
    imageUrl: str = None

    def to_dict(self):
        return asdict(self)


@dataclass
class ListingPage:
    """Parsed listing page: its rows and what it says about pagination."""

    url: str = None
    entries: list = field(default_factory=list)
    totalPages: int = None        # only when the page states it
    hasNext: bool = False         # only when the page shows a next control

    def to_dict(self):
        return {"url": self.url, "count": len(self.entries),
                "totalPages": self.totalPages, "hasNext": self.hasNext}


@dataclass
class CrawlReport:
    """Everything the acceptance checklist asks for, plus failures verbatim."""

    source: str = None
    city: str = None
    startedAt: str = None
    finishedAt: str = None
    maxPages: int = None
    pagesFetched: int = 0
    activitiesDiscovered: int = 0
    uniqueActivityUrls: int = 0
    detailsFetched: int = 0
    success: int = 0
    failed: int = 0
    missingDate: int = 0
    missingVenue: int = 0
    missingAddress: int = 0
    stopReason: str = None
    listingUrls: list = field(default_factory=list)
    failures: list = field(default_factory=list)

    def to_dict(self):
        return asdict(self)

    def finish(self, events):
        """Derive the quality counters from the produced events.

        `success` counts events actually read off an activity page; a row that
        fell back to its listing hints is not a success and is already in
        `failed`, so success + failed == detailsFetched for a complete run.
        """
        self.success = sum(1 for e in events
                           if (getattr(e, "rawData", None) or {}).get("detailFetched"))
        self.missingDate = sum(1 for e in events if not e.startTime)
        self.missingVenue = sum(1 for e in events if not e.venueName)
        self.missingAddress = sum(1 for e in events if not e.address)
        return self
