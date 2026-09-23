# Location layer (PHASE 3 — REAL EVENT INDEX V1).
#
# Place text -> real coordinates -> real distance -> nearby search.
#
# Honesty rules this package enforces (mirroring the retrieval layer):
#   * coordinates come from a real Geocoding API or they do not exist —
#     a missing key is `not_configured`, never a guessed point;
#   * every stored coordinate records WHERE it came from (geocode_source)
#     and WHEN (geocoded_at);
#   * a district name is never used as a stand-in for a place coordinate.
