# Search exports (PHASE 12).
#
#   pipeline/data/search/demo_search.json      full retrieval result (canonical)
#   ui_kits/app/generated-search-demo.js       pre-computed demo result for the
#                                              static (no-API) UI fallback
#
# Same philosophy as the existing exports: the UI stays usable even when the
# API is not running — it just can't answer arbitrary new queries.

import json
from pathlib import Path

from pipeline.api.server import public_result


def export_search_json(result, out_path, debug=False):
    """Write the full retrieval result as pretty JSON."""
    path = Path(out_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "DEMO_DATA": True,
        "request": result.get("request"),
        "plan": result.get("plan"),
        "summary": result.get("summary"),
        "results": [public_result(r) for r in result.get("results", [])],
    }
    if debug and result.get("debug"):
        payload["debug"] = result["debug"]
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
    return str(path)


def export_search_demo_js(result, out_path, query):
    """Write ui_kits/app/generated-search-demo.js.

    window.GORGON_SEARCH_DEMO = { query, request, plan, summary, results }
    The app uses this only when POST /api/search is unavailable AND the user
    asked the recorded demo query.
    """
    path = Path(out_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "DEMO_DATA": True,
        "demo": True,
        "query": query,
        "request": result.get("request"),
        "plan": result.get("plan"),
        "summary": result.get("summary"),
        "results": [public_result(r) for r in result.get("results", [])],
    }
    header = (
        "// Gorgon generated search demo — DO NOT EDIT BY HAND.\n"
        "// ⚠️ DEMO DATA — produced by `python pipeline/run.py --search-demo`.\n"
        "// Used by the app ONLY as a fallback when /api/search is unavailable.\n"
    )
    body = json.dumps(payload, ensure_ascii=False, indent=2)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(header + "window.GORGON_SEARCH_DEMO = " + body + ";\n")
    return str(path)
