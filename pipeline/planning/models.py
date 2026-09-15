# Planning schema (PHASE 10) — CONTRACT ONLY.
#
# Future goal: given several ranked activities, produce a runnable one-day
# route (活动 A 13:00 -> B 16:00 -> C 19:00, A->B by metro, B->C on foot).
#
# This phase defines the vocabulary and NOTHING else: no solver, no
# combinatorics, no map calls. Route legs are only ever filled by a future
# RouteProvider implementation (see pipeline/route/provider.py).

from dataclasses import dataclass, field

ITINERARY_CONSTRAINTS = ("time", "location", "travel_mode", "capacity")


@dataclass
class ItineraryRequest:
    """What the user wants out of a day.

    Every field except `date` may be missing — same rule as SearchRequest.
    """
    date: str = None                  # "YYYY-MM-DD"
    city: str = None
    startTime: str = None             # "HH:MM"
    endTime: str = None               # "HH:MM"
    origin: str = None                # starting point (address / venue / district)
    maxActivities: int = 3
    travelMode: str = "transit"
    activityIds: list = field(default_factory=list)   # pre-selected candidates
    searchRequest: dict = None        # the SearchRequest that produced them

    def to_dict(self):
        return {
            "date": self.date,
            "city": self.city,
            "startTime": self.startTime,
            "endTime": self.endTime,
            "origin": self.origin,
            "maxActivities": self.maxActivities,
            "travelMode": self.travelMode,
            "activityIds": list(self.activityIds or []),
            "searchRequest": dict(self.searchRequest) if self.searchRequest else None,
        }

    @classmethod
    def from_dict(cls, d):
        d = d or {}
        return cls(
            date=d.get("date"),
            city=d.get("city"),
            startTime=d.get("startTime"),
            endTime=d.get("endTime"),
            origin=d.get("origin"),
            maxActivities=int(d.get("maxActivities") or 3),
            travelMode=d.get("travelMode") or "transit",
            activityIds=list(d.get("activityIds") or []),
            searchRequest=d.get("searchRequest"),
        )


@dataclass
class RouteLeg:
    """One hop between two stops. Filled by a RouteProvider, never invented."""
    mode: str = "transit"             # transit | walk | bike | drive | taxi
    durationMinutes: int = None
    distanceKm: float = None
    fromPlace: str = None
    toPlace: str = None
    line: str = None                  # e.g. "地铁 10 号线"
    departureTime: str = None
    arrivalTime: str = None
    provider: str = None              # which RouteProvider produced it
    mock: bool = False
    note: str = None

    def to_dict(self):
        return {
            "mode": self.mode,
            "durationMinutes": self.durationMinutes,
            "distanceKm": self.distanceKm,
            "fromPlace": self.fromPlace,
            "toPlace": self.toPlace,
            "line": self.line,
            "departureTime": self.departureTime,
            "arrivalTime": self.arrivalTime,
            "provider": self.provider,
            "mock": self.mock,
            "note": self.note,
        }


@dataclass
class ItineraryCandidate:
    """One possible ordering of activities (a plan sketch, not a solution).

    `feasible` is a *schema-level* slot: a future solver decides it. This
    phase never computes it, so it stays None.
    """
    activityIds: list = field(default_factory=list)
    legs: list = field(default_factory=list)          # list[RouteLeg]
    totalTravelMinutes: int = None
    totalDurationMinutes: int = None
    feasible: bool = None
    conflicts: list = field(default_factory=list)
    score: int = None
    reasons: list = field(default_factory=list)

    def to_dict(self):
        return {
            "activityIds": list(self.activityIds or []),
            "legs": [l.to_dict() if isinstance(l, RouteLeg) else dict(l) for l in (self.legs or [])],
            "totalTravelMinutes": self.totalTravelMinutes,
            "totalDurationMinutes": self.totalDurationMinutes,
            "feasible": self.feasible,
            "conflicts": list(self.conflicts or []),
            "score": self.score,
            "reasons": list(self.reasons or []),
        }

    @classmethod
    def from_dict(cls, d):
        d = d or {}
        return cls(
            activityIds=list(d.get("activityIds") or []),
            legs=list(d.get("legs") or []),
            totalTravelMinutes=d.get("totalTravelMinutes"),
            totalDurationMinutes=d.get("totalDurationMinutes"),
            feasible=d.get("feasible"),
            conflicts=list(d.get("conflicts") or []),
            score=d.get("score"),
            reasons=list(d.get("reasons") or []),
        )


@dataclass
class ItineraryPlan:
    """The contract a future planner must satisfy."""
    request: dict = None
    candidates: list = field(default_factory=list)    # list[ItineraryCandidate]
    recommended: ItineraryCandidate = None
    warnings: list = field(default_factory=list)
    routeProvider: str = None
    solver: str = "not_implemented_this_phase"

    def to_dict(self):
        return {
            "request": dict(self.request) if self.request else None,
            "candidates": [c.to_dict() if isinstance(c, ItineraryCandidate) else dict(c)
                           for c in (self.candidates or [])],
            "recommended": self.recommended.to_dict() if isinstance(self.recommended, ItineraryCandidate) else None,
            "warnings": list(self.warnings or []),
            "routeProvider": self.routeProvider,
            "solver": self.solver,
        }


def plan_itinerary(request, candidates=None):
    """Reserved entry point — intentionally unimplemented.

    Kept as an explicit stub so nobody mistakes the schema for a working
    planner. A later phase will implement it on top of a real RouteProvider.
    """
    raise NotImplementedError(
        "Itinerary solving is reserved for a later phase. Only the schema "
        "(ItineraryRequest / ItineraryCandidate / RouteLeg / ItineraryPlan) "
        "is defined here."
    )
