# Gorgon Search API (PHASE 7).
#
# Dependency-free HTTP server (Python stdlib only):
#   POST /api/search   {"query": "这个周末上海有什么 AI Agent 活动？最好免费，徐汇附近"}
#   GET  /api/search?q=...&debug=1
#   GET  /api/health
#   GET  /*            static files (so this replaces `python -m http.server`)
#
#   python pipeline/api/server.py --port 8000
#   python pipeline/api/server.py --port 8000 --today 2026-09-15 --debug
#
# The response exposes only what a client needs; internal pipeline fields
# are hidden unless debug mode is on.

import argparse
import json
import sys
from datetime import date
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from pipeline.search.service import search_events  # noqa: E402
from pipeline.search.provider import default_provider  # noqa: E402

# Canonical fields safe to expose to a client.
PUBLIC_ACTIVITY_FIELDS = (
    "id", "title", "description", "startDate", "startTime", "endDate", "endTime",
    "venue", "address", "district", "city", "category", "tags",
    "priceType", "price", "organizer", "sourceName", "sourceUrl",
    "registrationUrl", "publishedAt", "trustScore", "trustReasons",
    "status", "duplicateOf",
)

DEFAULT_MAX_RESULTS = 20


def public_activity(activity, debug=False):
    if debug:
        return dict(activity)
    out = {k: activity.get(k) for k in PUBLIC_ACTIVITY_FIELDS if k in activity}
    out["trustReasons"] = list(activity.get("trustReasons") or [])
    return out


def public_result(ranked, debug=False):
    """One ranked event, trimmed to the public contract."""
    out = {
        "id": ranked.get("id"),
        "bucket": ranked.get("bucket"),
        "finalScore": ranked.get("finalScore"),
        "scores": dict(ranked.get("scores") or {}),
        "reasons": list(ranked.get("reasons") or []),
        "provenance": [
            {k: p.get(k) for k in ("source", "sourceType", "sourceTrust", "url")}
            for p in (ranked.get("provenance") or [])
        ],
        "queries": list(ranked.get("queries") or []),
        "activity": public_activity(ranked.get("activity") or {}, debug=debug),
    }
    if debug:
        out["weights"] = dict(ranked.get("weights") or {})
    return out


def build_response(payload, debug=False, today=None):
    """SearchRequest payload -> API response dict."""
    payload = dict(payload or {})
    if not payload.get("query") and payload.get("q"):
        payload["query"] = payload["q"]
    max_results = payload.get("maxResults") or payload.get("max_results") or DEFAULT_MAX_RESULTS
    payload["maxResults"] = int(max_results)
    payload.pop("q", None)

    inner_debug = bool(debug or payload.pop("debug", False))
    result = search_events(payload, today=today, debug=inner_debug)

    response = {
        "request": result["request"],
        "plan": result["plan"],
        "summary": result["summary"],
        "results": [public_result(r, debug=inner_debug) for r in result["results"]],
    }
    if inner_debug:
        response["debug"] = result.get("debug", {})
    return response


class GorgonRequestHandler(SimpleHTTPRequestHandler):
    """Static file server + the search API."""

    repo_root = str(REPO_ROOT)
    debug_default = False
    today_override = None

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=self.repo_root, **kwargs)

    # -- helpers ------------------------------------------------------------

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
                                      today=self.today_override)
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
            self._send_json({
                "status": "ok",
                "demoData": True,
                "providers": [default_provider().name],
                "today": (self.today_override or date.today()).isoformat(),
            })
            return
        if parsed.path.rstrip("/") == "/api/search":
            params = parse_qs(parsed.query)
            payload = {
                "query": (params.get("q") or params.get("query") or [""])[0],
                "debug": (params.get("debug") or ["0"])[0] not in ("0", "", "false"),
            }
            for key in ("city", "timePreference", "locationPreference", "pricePreference"):
                if params.get(key):
                    payload[key] = params[key][0]
            if params.get("topics"):
                payload["topics"] = [t for t in params["topics"][0].split(",") if t]
            try:
                self._send_json(build_response(payload, debug=self.debug_default,
                                               today=self.today_override), status=200)
            except Exception as exc:  # noqa: BLE001
                self._send_json({"error": "search_failed", "detail": str(exc)}, status=500)
            return
        super().do_GET()


def make_server(port=8000, host="127.0.0.1", debug=False, today=None):
    handler = GorgonRequestHandler
    handler.debug_default = debug
    handler.today_override = today
    return ThreadingHTTPServer((host, port), handler)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Gorgon static server + /api/search")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--debug", action="store_true", help="include internal debug payload")
    parser.add_argument("--today", help="pin the reference date (YYYY-MM-DD) for demos/tests")
    args = parser.parse_args(argv)

    today = date.fromisoformat(args.today) if args.today else None
    server = make_server(args.port, args.host, debug=args.debug, today=today)
    print("GORGON SERVER (DEMO DATA)")
    print("  static : http://%s:%d/ui_kits/app/" % (args.host, args.port))
    print("  api    : POST http://%s:%d/api/search" % (args.host, args.port))
    print("  health : http://%s:%d/api/health" % (args.host, args.port))
    if today:
        print("  today  : %s (pinned)" % today.isoformat())
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
