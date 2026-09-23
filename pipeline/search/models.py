# Gorgon Information Retrieval — core models (PHASE 1 / PHASE 4).
#
# This module is the single source of truth for the retrieval contract.
# It deliberately contains NO rules and NO scoring: planner / provider /
# ranker / service own the behaviour.
#
# Object chain:
#   SearchRequest  user's natural-language need, structured + partial
#     -> SearchPlan   deterministic list of SearchQuery
#       -> RawSearchResult  one candidate hit, exactly as a source reported it
#         -> SearchCandidate  the hit after the EXISTING pipeline ran
#           -> RankedEvent  candidate + explainable ranking
#
# Everything is a plain dataclass with to_dict()/from_dict() so the API,
# the CLI and the tests all speak the same shape. JSON keys are camelCase;
# snake_case input aliases are accepted for convenience.

from dataclasses import dataclass, field, asdict

# --- controlled vocabularies ------------------------------------------------

PRICE_PREFERENCES = ("any", "free_preferred", "free_only", "paid_ok")
TIME_PREFERENCES = ("morning", "afternoon", "evening")
DATE_RANGE_TYPES = ("relative", "absolute")
SOURCE_TRUST_LEVELS = ("high", "medium", "low")

# Result buckets returned to callers. `rejected` never reaches the main list.
BUCKETS = ("approved", "needs_review", "duplicate_candidate", "rejected")


def _get(d, *names):
    """First present key among aliases (camelCase / snake_case)."""
    for name in names:
        if isinstance(d, dict) and name in d and d[name] is not None:
            return d[name]
    return None


def _to_float(value):
    """Lenient float coercion for request fields ("" and None -> None)."""
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


# --- SearchRequest ----------------------------------------------------------

@dataclass
class SearchRequest:
    """A user's need. EVERY field except `query` may be missing.

    Never force the user to fill a form: the planner works with whatever
    it gets and downgrades gracefully.
    """
    query: str = ""
    city: str = None
    topics: list = field(default_factory=list)
    dateRange: dict = None            # {"type":"relative","value":"this_weekend"}
    timePreference: str = None        # morning | afternoon | evening
    locationPreference: str = None    # SOFT district preference, e.g. "徐汇"
    district: str = None              # HARD district constraint, e.g. "徐汇"
    pricePreference: str = None       # see PRICE_PREFERENCES
    maxResults: int = 20
    # PHASE 3 — PLACE-BASED nearby search. A place is NOT a district: "五角
    # 场" must never degrade to "整个杨浦". place is resolved to real
    # coordinates by the geocoding layer; radiusKm then filters by REAL
    # Haversine distance. Callers may instead pass explicit coordinates,
    # which skip resolution entirely (but still record where they came from).
    place: str = None                 # e.g. "五角场" (never mapped to a district)
    latitude: float = None            # explicit target coordinate (caller-supplied)
    longitude: float = None
    radiusKm: float = None            # nearby radius; default applied in the service

    # `locationPreference` and `district` are NOT the same thing, and keeping
    # them apart is what makes the district filter correct:
    #
    #   locationPreference   parsed out of natural language ("徐汇附近").
    #                        It feeds RECALL (an extra plan query) and the
    #                        ranking's location_fit — a preference, never a
    #                        cut. "附近" means nearby; hard-filtering on it
    #                        would drop events the user asked to see.
    #   district             an explicit constraint from the caller (the UI's
    #                        district picker). It is a HARD eligibility rule
    #                        applied server-side, before dedupe / trust /
    #                        ranking / maxResults — never to a list that has
    #                        already been truncated to the city-wide top N.
    def to_dict(self):
        return {
            "query": self.query,
            "city": self.city,
            "topics": list(self.topics or []),
            "dateRange": dict(self.dateRange) if self.dateRange else None,
            "timePreference": self.timePreference,
            "locationPreference": self.locationPreference,
            "district": self.district,
            "pricePreference": self.pricePreference,
            "maxResults": self.maxResults,
            "place": self.place,
            "latitude": self.latitude,
            "longitude": self.longitude,
            "radiusKm": self.radiusKm,
        }

    @classmethod
    def from_dict(cls, d):
        if d is None:
            return cls()
        if isinstance(d, cls):
            return d
        if not isinstance(d, dict):
            return cls(query=str(d))
        topics = _get(d, "topics") or []
        if isinstance(topics, str):
            topics = [topics]
        dr = _get(d, "dateRange", "date_range")
        if isinstance(dr, str):
            dr = {"type": "relative", "value": dr}
        max_results = _get(d, "maxResults", "max_results")
        latitude = _get(d, "latitude")
        longitude = _get(d, "longitude")
        radius = _get(d, "radiusKm", "radius_km")
        return cls(
            query=_get(d, "query", "q") or "",
            city=_get(d, "city"),
            topics=[str(t) for t in topics],
            dateRange=dict(dr) if isinstance(dr, dict) else None,
            timePreference=_get(d, "timePreference", "time_preference"),
            locationPreference=_get(d, "locationPreference", "location_preference"),
            district=_get(d, "district"),
            pricePreference=_get(d, "pricePreference", "price_preference"),
            maxResults=int(max_results) if max_results else 20,
            place=_get(d, "place"),
            latitude=_to_float(latitude),
            longitude=_to_float(longitude),
            radiusKm=_to_float(radius),
        )


# --- SearchPlan / SearchQuery ----------------------------------------------

@dataclass
class SearchQuery:
    """One concrete query to hand to a provider."""
    text: str
    topic: str = None       # which request topic produced it (None = derived)
    kind: str = "topic"     # topic | format | location

    def to_dict(self):
        return {"text": self.text, "topic": self.topic, "kind": self.kind}

    @classmethod
    def from_dict(cls, d):
        if isinstance(d, str):
            return cls(text=d)
        return cls(
            text=_get(d, "text") or "",
            topic=_get(d, "topic"),
            kind=_get(d, "kind") or "topic",
        )


@dataclass
class SearchPlan:
    """The search plan. Planning only — no fetching happens here."""
    queries: list = field(default_factory=list)     # list[SearchQuery]
    strategy: str = "deterministic_rules_v1"
    dateRange: dict = None                          # resolved dates
    notes: list = field(default_factory=list)

    def query_texts(self):
        return [q.text if isinstance(q, SearchQuery) else str(q) for q in self.queries]

    def to_dict(self):
        return {
            "queries": [q.to_dict() if isinstance(q, SearchQuery) else {"text": str(q)} for q in self.queries],
            "strategy": self.strategy,
            "dateRange": dict(self.dateRange) if self.dateRange else None,
            "notes": list(self.notes),
        }

    @classmethod
    def from_dict(cls, d):
        d = d or {}
        return cls(
            queries=[SearchQuery.from_dict(q) for q in (d.get("queries") or [])],
            strategy=d.get("strategy") or "deterministic_rules_v1",
            dateRange=d.get("dateRange"),
            notes=list(d.get("notes") or []),
        )


# --- RawSearchResult --------------------------------------------------------

@dataclass
class RawSearchResult:
    """One hit exactly as a source reported it — dirty values allowed.

    Field names are canonical *raw* names (they line up with
    pipeline/schema.py) so the adapter stays thin.

    PHASE 5 addition: the retrieval layer now talks to the real internet, so
    every hit must declare WHERE it came from and WHEN we saw it. A hit is
    never silently upgraded from demo to real.

      dataOrigin   "real"  -> fetched from a live source over the network
                   "demo"  -> served from a recorded fixture
      retrievedAt  ISO timestamp of the request that produced the hit
      rank         1-based position inside its own provider response
      rawDate/rawTime/rawVenue/...   the listing row's own values, used by the
                   EventExtractor as a LOWER-priority source than the detail
                   page — never as invented data.
      imageUrl     thumbnail the source itself published for this hit
                   (priority 50 in the image ladder: below og:image).
    """
    resultId: str = ""
    providerQuery: str = ""
    provider: str = ""          # which SearchProvider produced it
    source: str = ""            # human-readable channel, e.g. "AI 极客社区"
    sourceType: str = ""        # wechat | xhs | web | community | manual
    sourceTrust: str = "medium"  # high | medium | low (source-level, not the stage)
    dataOrigin: str = "demo"    # real | demo
    title: str = None
    snippet: str = None
    url: str = None
    registrationUrl: str = None
    publishedAt: str = None
    retrievedAt: str = None
    rank: int = None
    rawDate: str = None
    rawTime: str = None
    rawEndTime: str = None
    rawVenue: str = None
    address: str = None
    rawLocation: str = None
    city: str = None
    district: str = None
    rawPrice: str = None
    organizer: str = None
    imageUrl: str = None
    imageSource: str = None
    imageType: str = None      # remote | placeholder — how the URL was obtained
    tags: list = field(default_factory=list)
    # Populated by the enrichment stage (pipeline/search/enrich.py):
    #   {"url", "fetch": {...}, "confidence", "fieldSources", "agenda",
    #    "skipped", "structured"}
    extractInfo: dict = field(default_factory=dict)

    def to_dict(self):
        return asdict(self)

    @classmethod
    def from_dict(cls, d):
        d = d or {}
        known = set(cls().to_dict().keys())
        kwargs = {k: d[k] for k in known if k in d}
        extra_tags = kwargs.get("tags") or []
        if isinstance(extra_tags, str):
            kwargs["tags"] = [extra_tags]
        return cls(**kwargs)

    def searchable_text(self):
        return " ".join(str(x) for x in [
            self.title, self.snippet, self.rawVenue, self.rawLocation,
            " ".join(self.tags or []), self.source,
        ] if x)


def new_raw_result(**kwargs):
    """Build a RawSearchResult, deriving a deterministic resultId if absent.

    The id is derived from (provider, url) when a URL is present, so the same
    page found by two different plan queries collapses in merge_raw_results;
    otherwise it falls back to a hash of the whole payload.
    """
    if not kwargs.get("resultId"):
        import hashlib
        url = kwargs.get("url")
        provider = kwargs.get("provider")
        if url:
            seed = "%s|%s" % (provider or "", str(url).strip().rstrip("/").casefold())
        else:
            import json as _json
            seed = _json.dumps(kwargs, ensure_ascii=False, sort_keys=True, default=str)
        kwargs["resultId"] = "sr_" + hashlib.sha1(seed.encode("utf-8")).hexdigest()[:10]
    return RawSearchResult.from_dict(kwargs)


# --- SearchCandidate --------------------------------------------------------

@dataclass
class SearchCandidate:
    """A record that went through the EXISTING pipeline.

    `activity` is the untouched canonical record (pipeline/schema.py).
    Everything else here is retrieval-layer metadata.
    """
    activity: dict = field(default_factory=dict)
    bucket: str = "needs_review"      # approved | needs_review | duplicate_candidate | rejected
    provenance: list = field(default_factory=list)   # [{resultId, source, sourceType, sourceTrust, url}]
    queries: list = field(default_factory=list)      # plan queries that surfaced it

    def to_dict(self):
        return {
            "activity": dict(self.activity),
            "bucket": self.bucket,
            "provenance": [dict(p) for p in self.provenance],
            "queries": list(self.queries),
        }

    @property
    def source_count(self):
        return len({(p.get("source") or "") for p in self.provenance if p.get("source")}) or 1


def bucket_for(activity):
    """Map a pipeline record's status onto a retrieval bucket (deterministic)."""
    status = (activity or {}).get("status")
    if status == "approved":
        return "approved"
    if activity.get("duplicateOf"):
        return "duplicate_candidate"
    if status == "rejected":
        return "rejected"
    return "needs_review"


# --- RankedEvent ------------------------------------------------------------

@dataclass
class RankedEvent:
    """A candidate plus every score that produced its position.

    Ranking answers "is this worth attending for THIS user?" — it is not
    trust ("is this information credible?"). Both are reported separately.
    """
    candidate: SearchCandidate = None
    finalScore: int = 0
    relevanceScore: int = 0
    trustScore: int = 0
    timeFitScore: int = 0
    locationFitScore: int = 0
    priceFitScore: int = 0
    freshnessScore: int = 0
    reasons: list = field(default_factory=list)
    weights: dict = field(default_factory=dict)

    def to_dict(self):
        return {
            "id": self.candidate.activity.get("id") if self.candidate else None,
            "bucket": self.candidate.bucket if self.candidate else None,
            "activity": dict(self.candidate.activity) if self.candidate else {},
            "provenance": [dict(p) for p in (self.candidate.provenance if self.candidate else [])],
            "queries": list(self.candidate.queries if self.candidate else []),
            "finalScore": self.finalScore,
            "scores": {
                "relevance": self.relevanceScore,
                "trust": self.trustScore,
                "timeFit": self.timeFitScore,
                "locationFit": self.locationFitScore,
                "priceFit": self.priceFitScore,
                "freshness": self.freshnessScore,
            },
            "reasons": list(self.reasons),
            "weights": dict(self.weights),
        }
