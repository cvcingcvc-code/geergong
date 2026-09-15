# RouteProvider interface (PHASE 9) — INTERFACE ONLY.
#
# This phase does NOT integrate any map service. Not 高德, not 百度,
# not Google Maps, not Apple Maps. Nothing in this repository may call a
# routing API until a later phase explicitly allows it.
#
# What exists today: the protocol, a deterministic mock for tests, and the
# documented shape every future implementation must return.

import abc

# Travel modes a future provider must understand.
TRAVEL_MODES = ("transit", "walk", "bike", "drive", "taxi")

# Route result shape (dict form, JSON-serialisable):
#   {
#     "provider": "mock",
#     "mock": True,
#     "travelMode": "transit",
#     "origin": "...", "destination": "...",
#     "departureTime": "2026-09-19T13:00:00" | None,
#     "totalDurationMinutes": 24,
#     "totalDistanceKm": 5.4,
#     "legs": [
#       {"mode": "walk", "durationMinutes": 6, "distanceKm": 0.4,
#        "from": "...", "to": "...", "line": None, "note": "..."}
#     ],
#   }


class RouteProvider(abc.ABC):
    """Interface for any future routing backend."""

    name = "base"
    is_mock = False

    @abc.abstractmethod
    def get_route(self, origin, destination, departure_time=None,
                  travel_mode="transit"):
        """-> route dict (see the shape documented above).

        Implementations must raise NotImplementedError rather than invent
        a route they cannot actually compute.
        """
        raise NotImplementedError


class NullRouteProvider(RouteProvider):
    """Default provider used in this phase: refuses to answer.

    Keeps the call site honest — production code must never silently
    receive a made-up travel time.
    """

    name = "null"

    def get_route(self, origin, destination, departure_time=None,
                  travel_mode="transit"):
        raise NotImplementedError(
            "Real routing is not implemented in this phase. Inject "
            "MockRouteProvider for tests, or add a real provider later."
        )


class MockRouteProvider(RouteProvider):
    """Deterministic fake routing, for tests and UI demos only.

    Every result is clearly flagged `mock: True` so it can never be mistaken
    for a real travel plan. Distance/duration are derived from a stable hash,
    so the same pair of places always yields the same answer.
    """

    name = "mock"
    is_mock = True

    def __init__(self, base_minutes=18, minutes_per_km=3.0):
        self.base_minutes = base_minutes
        self.minutes_per_km = minutes_per_km

    def _seed(self, origin, destination, travel_mode):
        raw = "%s|%s|%s" % (origin, destination, travel_mode)
        total = sum(ord(ch) for ch in raw)
        return total

    def get_route(self, origin, destination, departure_time=None,
                  travel_mode="transit"):
        if travel_mode not in TRAVEL_MODES:
            raise ValueError("unsupported travel_mode: %r" % travel_mode)
        seed = self._seed(origin, destination, travel_mode)
        distance_km = round(1.0 + (seed % 90) / 10.0, 1)          # 1.0 - 10.0 km
        duration = int(round(self.base_minutes + distance_km * self.minutes_per_km))
        first_mode = "walk" if travel_mode == "transit" else travel_mode
        return {
            "provider": self.name,
            "mock": True,
            "travelMode": travel_mode,
            "origin": origin,
            "destination": destination,
            "departureTime": departure_time,
            "totalDurationMinutes": duration,
            "totalDistanceKm": distance_km,
            "legs": [
                {
                    "mode": first_mode,
                    "durationMinutes": duration,
                    "distanceKm": distance_km,
                    "from": origin,
                    "to": destination,
                    "line": None,
                    "note": "MOCK ROUTE — 非真实路线，仅用于测试与演示",
                }
            ],
        }


def default_route_provider():
    """This phase's default: no invented routes."""
    return NullRouteProvider()
