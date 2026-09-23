# Location-layer models (PHASE 3).
#
# PlaceResolution is the single contract between the place parser, the
# geocoder and the search service. Every nearby-search response carries one,
# so a caller can always tell WHY a place search produced what it produced:
#
#   resolved         real coordinates from a real geocoder
#   not_configured   no Geocoding API key configured — no coordinates exist,
#                    none may be guessed
#   not_found        a configured geocoder was asked and did not know the place
#   error            the geocoder was reachable but failed (bad key, network,
#                    malformed payload)
#
# `not_configured` and `not_found` must lead to an honest empty result, never
# to a district fallback or a fabricated coordinate.

from dataclasses import dataclass

PLACE_STATUSES = ("resolved", "not_configured", "not_found", "error")


@dataclass
class PlaceResolution(object):
    """Outcome of resolving one place text into coordinates."""
    place: str = None              # the place text as the caller gave it
    status: str = "not_configured" # one of PLACE_STATUSES
    latitude: float = None         # only when status == "resolved"
    longitude: float = None
    provider: str = None           # "amap" | "baidu" | "nominatim" | "caller"
    displayName: str = None        # the geocoder's own formatted name
    coordSystem: str = None        # "gcj02" | "wgs84" | "bd09" (provider datum)
    detail: str = None             # human-readable why, when not resolved

    @property
    def ok(self):
        return self.status == "resolved"

    def to_dict(self):
        return {
            "place": self.place,
            "status": self.status,
            "resolvedPlace": self.displayName or (self.place if self.ok else None),
            "latitude": self.latitude,
            "longitude": self.longitude,
            "provider": self.provider,
            "coordSystem": self.coordSystem,
            "detail": self.detail,
        }

    @classmethod
    def from_dict(cls, d):
        d = d or {}
        return cls(
            place=d.get("place"),
            status=d.get("status") or "not_configured",
            latitude=d.get("latitude"),
            longitude=d.get("longitude"),
            provider=d.get("provider"),
            displayName=d.get("displayName") or d.get("resolvedPlace"),
            coordSystem=d.get("coordSystem"),
            detail=d.get("detail"),
        )
