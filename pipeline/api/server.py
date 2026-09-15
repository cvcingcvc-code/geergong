# Gorgon Search API (PHASE 7, real-search ready in PHASE 5).
#
# Dependency-free HTTP server (Python stdlib only):
#   POST /api/search   {"query": "这个周末上海有什么 AI Agent 活动？最好免费，徐汇附近"}
#   GET  /api/search?q=...&debug=1&mode=real
#   GET  /api/providers                      which retrieval sources are live
#   GET  /api/health
#   GET  /*                                  static files
#
#   python pipeline/api/server.py --port 8000
#   python pipeline/api/server.py --port 8000 --mode demo    # fixtures only
#   python pipeline/api/server.py --port 8000 --mode hybrid   # real + fixture backfill
#   SEARCH_PROVIDER=brave SEARCH_API_KEY=xxx python pipeline/api/server.py
#
# The response carries the retrieval METADATA the UI needs to be honest:
#   status          ok | empty | unavailable
#   providerMode    demo | real | hybrid     -> drives the DEMO DATA / REAL SEARCH badge
#   notices[]       human-readable, renderable verbatim
#   providers[]     per-provider availability + reason
#   stages[]        the loading stages (no fake percentages anywhere)
#
# Internal pipeline fields stay hidden unless debug mode is on.

import argparse
import json
import sys
from datetime import date
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from pipeline.search.service import (  # noqa: E402
    STAGES, build_providers_for_mode, search_events,
)
from pipeline.search.settings import SearchSettings, with_mode  # noqa: E402

# Canonical fields safe to expose to a client.
PUBLIC_ACTIVITY_FIELDS = (
    "id", "title", "description", "startDate", "startTime", "endDate", "endTime",
    "venue", "address", "district", "city", "category", "tags",
    "priceType", "price", "organizer", "sourceName", "sourceUrl",
    "registrationUrl", "imageUrl", "imageSource", "agenda",
    "publishedAt", "trustScore", "trustReasons",
    "status", "duplicateOf",
)

DEFAULT_MAX_RESULTS = 20


def public_activity(activity, debug=False):
    if debug:
        return dict(activity)
    out = {k: activity.get(k) for k in PUBLIC_ACTIVITY_FIELDS if k in activity}
    out["trustReasons"] = list(activity.get("trustReasons") or [])
    out["agenda"] = [dict(a) for a in (activity.get("agenda") or [])]
    return out


def public_provenance(rows):
    """One source entry per contributing record: who said it, and where."""
    out = []
    for row in rows or []:
        trust = row.get("sourceTrust") or "medium"
        out.append({
            "source": row.get("source"),
            "sourceType": row.get("sourceType"),
            "sourceTrust": trust,
            "trustLabel": {"high": "高可信", "medium": "中可信", "low": "低可信"}.get(trust, "中可信"),
            "title": row.get("title"),
            "url": row.get("url"),
            "provider": row.get("provider"),
            "dataOrigin": row.get("dataOrigin"),
            "retrievedAt": row.get("retrievedAt"),
            "query": row.get("providerQuery"),
        })
    return out


def public_result(ranked, debug=False):
    """One ranked event, trimmed to the public contract."""
    activity = ranked.get("activity") or {}
    provenance = public_provenance(ranked.get("provenance"))
    sources = []
    for row in provenance:
        label = row.get("source")
        if label and label not in sources:
            sources.append(label)
    out = {
        "id": ranked.get("id"),
        "bucket": ranked.get("bucket"),
        "finalScore": ranked.get("finalScore"),
        "scores": dict(ranked.get("scores") or {}),
        "reasons": list(ranked.get("reasons") or []),
        "provenance": provenance,
        "sourceCount": len(sources) or 1,
        "sources": sources,
        "dataOrigin": (provenance[0].get("dataOrigin") if provenance else None) or "demo",
        "queries": list(ranked.get("queries") or []),
        "activity": public_activity(activity, debug=debug),
    }
    if debug:
        out["weights"] = dict(ranked.get("weights") or {})
        out["extract"] = dict(
            ((activity.get("_extra") or {}).get("extract")) or {})
    return out


def build_response(payload, debug=False, today=None, settings=None, mode=None):
    """SearchRequest payload -> API response dict."""
    payload = dict(payload or {})
    if not payload.get("query") and payload.get("q"):
        payload["query"] = payload["q"]
    if not mode and payload.get("mode"):
        mode = payload["mode"]
    payload.pop("mode", None)
    max_results = payload.get("maxResults") or payload.get("max_results") or DEFAULT_MAX_RESULTS
    payload["maxResults"] = int(max_results)
    payload.pop("q", None)

    inner_debug = bool(debug or payload.pop("debug", False))
    result = search_events(payload, today=today, debug=inner_debug,
                           settings=settings, mode=mode)

    response = {
        "status": result.get("status", "ok"),
        "providerMode": result.get("providerMode", "demo"),
        "request": result["request"],
        "plan": result["plan"],
        "notices": list(result.get("notices") or []),
        "providers": list(result.get("providers") or []),
        "providerErrors": list(result.get("providerErrors") or []),
        "stages": list(result.get("stages") or [{"key": k, "label": v} for k, v in STAGES]),
        "summary": result["summary"],
        "results": [public_result(r, debug=inner_debug) for r in result["results"]],
    }
    if inner_debug:
        response["debug"] = result.get("debug", {})
        response["settings"] = result.get("settings", {})
    return response


def providers_payload(settings, mode=None):
    settings = with_mode(settings, mode)
    providers, notices, provider_mode = build_providers_for_mode(
        settings.mode, settings=settings)
    return {
        "providerMode": provider_mode,
        "mode": settings.mode,
        "settings": settings.describe(),
        "providers": [
            getattr(p, "status", None).to_dict() if getattr(p, "status", None)
            else {"name": getattr(p, "name", "provider"), "kind": "fixture",
                  "available": True, "reason": None, "detail": None, "hits": None}
            for p in providers
        ],
        "notices": notices,
        "stages": [{"key": k, "label": v} for k, v in STAGES],
    }


class GorgonRequestHandler(SimpleHTTPRequestHandler):
    """Static file server + the search API."""

    repo_root = str(REPO_ROOT)
    debug_default = False
    today_override = None
    settings = None

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=self.repo_root, **kwargs)

    # -- helpers ------------------------------------------------------------

    def _settings(self):
        return self.settings or SearchSettings(mode="real")

    def _send_json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return {"query": raw.decode("utf-8", "replace")}

    def log_message(self, fmt, *args):  # quieter, but still useful
        sys.stderr.write("[gorgon-api] %s\n" % (fmt % args))

    # -- routes -------------------------------------------------------------

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self):
        if self.path.split("?")[0].rstrip("/") != "/api/search":
            self._send_json({"error": "not_found", "path": self.path}, status=404)
            return
        try:
            payload = self._read_body()
            if isinstance(payload, str):
                payload = {"query": payload}
            response = build_response(payload, debug=self.debug_default,
                                      today=self.today_override,
                                      settings=self._settings())
            self._send_json(response, status=200)
        except Exception as exc:  # noqa: BLE001 - API boundary
            self._send_json({"error": "search_failed", "detail": str(exc)}, status=500)

    def do_GET(self):
        from urllib.parse import parse_qs, urlparse
        parsed = urlparse(self.path)
        if parsed.path == "/favicon.ico":
            # No favicon shipped; answer quietly instead of spamming the
            # browser console with a 404 on every page load.
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            return
        if parsed.path.rstrip("/") == "/api/health":
            settings = self._settings()
            self._send_json({
                "status": "ok",
                "providerMode": settings.mode,
                "demoData": settings.mode == "demo",
                "today": (self.today_override or date.today()).isoformat(),
                "settings": settings.describe(),
            })
            return
        if parsed.path.rstrip("/") == "/api/providers":
            params = parse_qs(parsed.query)
            try:
                self._send_json(providers_payload(
                    self._settings(),
                    mode=(params.get("mode") or [None])[0]), status=200)
            except Exception as exc:  # noqa: BLE001
                self._send_json({"error": "providers_failed", "detail": str(exc)},
                                status=500)
            return
        if parsed.path.rstrip("/") == "/api/search":
            params = parse_qs(parsed.query)
            payload = {
                "query": (params.get("q") or params.get("query") or [""])[0],
                "debug": (params.get("debug") or ["0"])[0] not in ("0", "", "false"),
            }
            for key in ("city", "timePreference", "locationPreference",
                        "pricePreference", "mode"):
                if params.get(key):
                    payload[key] = params[key][0]
            if params.get("topics"):
                payload["topics"] = [t for t in params["topics"][0].split(",") if t]
            try:
                self._send_json(build_response(payload, debug=self.debug_default,
                                               today=self.today_override,
                                               settings=self._settings()), status=200)
            except Exception as exc:  # noqa: BLE001
                self._send_json({"error": "search_failed", "detail": str(exc)}, status=500)
            return
        super().do_GET()


def make_server(port=8000, host="127.0.0.1", debug=False, today=None,
                mode="real", settings=None):
    handler = GorgonRequestHandler
    handler.debug_default = debug
    handler.today_override = today
    handler.settings = with_mode(settings or SearchSettings(mode=mode), mode)
    return ThreadingHTTPServer((host, port), handler)


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Gorgon static server + /api/search (real search capable)")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--debug", action="store_true", help="include internal debug payload")
    parser.add_argument("--today", help="pin the reference date (YYYY-MM-DD) for demos/tests")
    parser.add_argument("--mode", default="real", choices=("real", "hybrid", "demo"),
                        help="retrieval mode: real (network) | hybrid (real + fixture) | demo (fixture)")
    parser.add_argument("--no-fetch", action="store_true",
                        help="skip candidate page fetching (results keep listing-only facts)")
    args = parser.parse_args(argv)

    today = date.fromisoformat(args.today) if args.today else None
    settings = SearchSettings(mode=args.mode,
                              fetch_pages=False if args.no_fetch else None)
    server = make_server(args.port, args.host, debug=args.debug, today=today,
                         mode=args.mode, settings=settings)
    banner = {"real": "REAL SEARCH", "hybrid": "HYBRID", "demo": "DEMO DATA"}[args.mode]
    print("GORGON SERVER (%s)" % banner)
    print("  static    : http://%s:%d/ui_kits/app/" % (args.host, args.port))
    print("  api       : POST http://%s:%d/api/search" % (args.host, args.port))
    print("  providers : http://%s:%d/api/providers" % (args.host, args.port))
    print("  health    : http://%s:%d/api/health" % (args.host, args.port))
    describe = settings.describe()
    print("  provider  : %s | apiKey=%s | sources=%s | fetchPages=%s"
          % (describe["provider"], "yes" if describe["apiKeyConfigured"] else "no",
             ",".join(describe["eventSources"]) or "-", describe["fetchPages"]))
    if today:
        print("  today     : %s (pinned)" % today.isoformat())
    print("Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
