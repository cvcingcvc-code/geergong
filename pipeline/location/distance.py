# Real distance math (PHASE 3).
#
# Haversine on a spherical Earth — the standard formula for "how far apart
# are two lat/lng points" at city scale. Accuracy note: at Shanghai
# latitudes the spherical approximation is within ~0.1% of the geodesic,
# which is far below the noise introduced by GCJ-02 datum offsets (~100-500m)
# and by address-level (not rooftop-level) geocoding. We say "约" in every
# user-facing distance string for exactly this reason.

import math

# Mean Earth radius, IUGG. The 6371.0 textbook value differs by ~0.001% —
# irrelevant here, but the constant is named so nobody "fixes" it silently.
EARTH_RADIUS_KM = 6371.0088

# Meter-ish sanity bounds. Anything outside cannot be Earth coordinates;
# accepting it would let a parsing bug silently poison every distance.
_MIN_LAT, _MAX_LAT = -90.0, 90.0
_MIN_LNG, _MAX_LNG = -180.0, 180.0


def _as_coordinate(value, name, lo, hi):
    try:
        value = float(value)
    except (TypeError, ValueError):
        raise ValueError("%s is not a number: %r" % (name, value))
    if math.isnan(value) or math.isinf(value):
        raise ValueError("%s is not finite: %r" % (name, value))
    if value < lo or value > hi:
        raise ValueError("%s out of range [%s, %s]: %r"
                         % (name, lo, hi, value))
    return value


def distance_km(lat1, lng1, lat2, lng2):
    """Great-circle distance between two points, in kilometers.

    Raises ValueError on non-numeric or out-of-range input — a coordinate
    error must be loud, not a silently wrong radius filter.
    """
    lat1 = _as_coordinate(lat1, "lat1", _MIN_LAT, _MAX_LAT)
    lng1 = _as_coordinate(lng1, "lng1", _MIN_LNG, _MAX_LNG)
    lat2 = _as_coordinate(lat2, "lat2", _MIN_LAT, _MAX_LAT)
    lng2 = _as_coordinate(lng2, "lng2", _MIN_LNG, _MAX_LNG)

    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lng2 - lng1)

    a = (math.sin(d_phi / 2.0) ** 2
         + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2.0) ** 2)
    # Clamp: floating error near antipodes can push `a` a hair above 1.0,
    # which would make sqrt negative and crash an otherwise valid call.
    a = min(1.0, max(0.0, a))
    central_angle = 2.0 * math.asin(math.sqrt(a))
    return EARTH_RADIUS_KM * central_angle


def within_radius(distance, radius_km):
    """The ONE radius predicate. `<=` is the contract: an event at exactly
    radius_km is inside ("附近 3km" includes 3.0). A 1e-9 tolerance absorbs
    pure floating-point noise (the Haversine of a 3.0km offset computes as
    3.0000000000000004) without ever admitting a real 3.1km event. Both
    bounds must be real numbers; None means "cannot judge" and is False —
    an event without a distance is never shown as nearby."""
    if distance is None or radius_km is None:
        return False
    try:
        return float(distance) <= float(radius_km) + 1e-9
    except (TypeError, ValueError):
        return False


def offset_lat_km(base_lat, base_lng, km_north, km_east):
    """A point `km_north`/`km_east` away from (base_lat, base_lng).

    Test fixture helper: it builds KNOWN distances from a known center, so
    radius-filter tests can be exact instead of eyeballed. Uses the SAME
    Earth radius as distance_km, so the round trip offset -> distance is
    exact to float precision. Not used by the production path — deliberately
    lives next to the math it mirrors.
    """
    base_lat = _as_coordinate(base_lat, "base_lat", _MIN_LAT, _MAX_LAT)
    base_lng = _as_coordinate(base_lng, "base_lng", _MIN_LNG, _MAX_LNG)
    km_per_degree = EARTH_RADIUS_KM * math.pi / 180.0
    d_lat = km_north / km_per_degree
    cos_lat = math.cos(math.radians(base_lat))
    if abs(cos_lat) < 1e-9:
        raise ValueError("base_lat too close to a pole for east offset")
    d_lng = km_east / (km_per_degree * cos_lat)
    return base_lat + d_lat, base_lng + d_lng
