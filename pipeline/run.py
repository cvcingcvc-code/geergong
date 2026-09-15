#!/usr/bin/env python3
# GORGON DATA PIPELINE — MVP entry point (PHASE 11/12).
#
#   python pipeline/run.py                 full run: ingest→…→review→export
#   python pipeline/run.py --stage dedupe  run stages up to & incl. `dedupe`
#   python pipeline/run.py --export-gorgon also write ui_kits/app/generated-data.js
#
# Every stage is runnable and testable on its own. No LLM anywhere.

import argparse
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
PIPELINE_DIR = Path(__file__).resolve().parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

DATA_RAW = PIPELINE_DIR / "data" / "raw"
DATA_NORMALIZED = PIPELINE_DIR / "data" / "normalized"
DATA_WORK = PIPELINE_DIR / "data" / "work"
DATA_REVIEW = PIPELINE_DIR / "data" / "review"
DATA_APPROVED = PIPELINE_DIR / "data" / "approved"
GORGON_JS = REPO_ROOT / "ui_kits" / "app" / "generated-data.js"

STAGES = ["ingest", "normalize", "clean", "dedupe", "trust", "review", "export"]


def _write(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)


def _read(path, fallback):
    if not path.exists():
        return fallback
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


# --- stages -----------------------------------------------------------------

def stage_ingest(state):
    from pipeline.ingest.json_source import ingest_raw
    acts = ingest_raw(str(DATA_RAW))
    _write(DATA_WORK / "ingested.json", {"DEMO_DATA": True, "activities": acts})
    state["raw"] = len(acts)
    return acts


def stage_normalize(state):
    from pipeline.normalize.activity import normalize_all
    from pipeline.schema import fill_defaults, validate
    acts = state.get("acts") or _read(
        DATA_WORK / "ingested.json", {}
    ).get("activities", [])
    acts = normalize_all(acts)
    for act in acts:
        fill_defaults(act)
        problems = validate(act)
        if problems:
            state.setdefault("invalid", []).extend(
                ["%s: %s" % (act.get("id"), p) for p in problems]
            )
    _write(DATA_NORMALIZED / "normalized.json", {"DEMO_DATA": True, "activities": acts})
    state["normalized"] = len(acts)
    return acts


def stage_clean(state):
    from pipeline.clean.cleaner import clean_all
    acts = state.get("acts") or _read(
        DATA_NORMALIZED / "normalized.json", {}
    ).get("activities", [])
    acts = clean_all(acts)
    _write(DATA_WORK / "cleaned.json", {"DEMO_DATA": True, "activities": acts})
    state["cleaned"] = len(acts)
    return acts


def stage_dedupe(state):
    from pipeline.dedupe.deduplicator import dedupe_all
    acts = state.get("acts") or _read(
        DATA_WORK / "cleaned.json", {}
    ).get("activities", [])
    acts, stats = dedupe_all(acts)
    _write(DATA_WORK / "deduped.json", {"DEMO_DATA": True, "activities": acts, "stats": stats})
    state["duplicates"] = stats["duplicates_exact"] + stats["duplicates_near"]
    state["dedupe_stats"] = stats
    return acts


def stage_trust(state):
    from pipeline.trust.scorer import score_all
    acts = state.get("acts") or _read(
        DATA_WORK / "deduped.json", {}
    ).get("activities", [])
    acts = score_all(acts)
    _write(DATA_WORK / "scored.json", {"DEMO_DATA": True, "activities": acts})
    state["scored"] = len(acts)
    return acts


def stage_review(state):
    from pipeline.review.queue import build_queue, route
    acts = state.get("acts") or _read(
        DATA_WORK / "scored.json", {}
    ).get("activities", [])
    acts, summary = route(acts)
    queue = build_queue(acts, summary)
    _write(DATA_REVIEW / "review_queue.json", queue)
    approved = [a for a in acts if a.get("status") == "approved"]
    _write(DATA_APPROVED / "activities.json", {
        "DEMO_DATA": True, "count": len(approved), "activities": approved,
    })
    state["review"] = summary
    state["approved"] = len(approved)
    state["acts"] = acts
    return acts


def stage_export(state):
    approved = [a for a in (state.get("acts") or _read(
        DATA_APPROVED / "activities.json", {}
    ).get("activities", [])) if a.get("status") == "approved"]
    from pipeline.export.gorgon_export import export_gorgon_js
    out = export_gorgon_js(approved, str(GORGON_JS))
    state["export"] = out
    return approved


# --- orchestration ----------------------------------------------------------

def run(until="export", export_gorgon=False):
    state = {}
    order = STAGES[: STAGES.index(until) + 1]
    for stage in order:
        globals()["stage_%s" % stage](state)
    if export_gorgon and "export" not in order:
        stage_export(state)
    return state


def print_report(state):
    review = state.get("review", {})
    print("")
    print("GORGON DATA PIPELINE")
    print("")
    print("RAW: %s" % state.get("raw", 0))
    print("NORMALIZED: %s" % state.get("normalized", 0))
    print("DUPLICATES: %s" % state.get("duplicates", 0))
    print("NEEDS REVIEW: %s" % (review.get("needs_review", 0) + review.get("low_confidence", 0)))
    print("APPROVED: %s" % state.get("approved", 0))
    print("")
    print("OUTPUT:")
    print("  %s" % (DATA_APPROVED / "activities.json"))
    if state.get("export"):
        print("  %s" % state["export"])
    if state.get("invalid"):
        print("")
        print("SCHEMA WARNINGS:")
        for line in state["invalid"]:
            print("  - %s" % line)
    print("")


def main(argv=None):
    parser = argparse.ArgumentParser(description="Gorgon data pipeline MVP")
    parser.add_argument("--stage", choices=STAGES, help="run stages up to and including this one")
    parser.add_argument("--export-gorgon", action="store_true", help="also write ui_kits/app/generated-data.js")
    args = parser.parse_args(argv)
    until = args.stage or "export"
    state = run(until=until, export_gorgon=args.export_gorgon)
    print_report(state)
    return 0


if __name__ == "__main__":
    sys.exit(main())
