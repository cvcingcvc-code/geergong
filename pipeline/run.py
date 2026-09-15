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
ADMIN_REVIEW_JS = REPO_ROOT / "ui_kits" / "admin" / "generated-review-data.js"
DEFAULT_DECISIONS = DATA_REVIEW / "human_decisions.json"

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
    _write(DATA_WORK / "routed.json", {"DEMO_DATA": True, "activities": acts})
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

    # Admin review queue export (Human Review Loop PHASE 2).
    acts = state.get("acts") or _read(DATA_WORK / "scored.json", {}).get("activities", [])
    queue = _read(DATA_REVIEW / "review_queue.json", {"summary": {}, "queue": []})
    from pipeline.export.admin_review_export import export_admin_review_js
    admin_out, n_items = export_admin_review_js(acts, queue, str(ADMIN_REVIEW_JS))
    state["export_admin"] = admin_out
    state["review_items"] = n_items
    return approved


def apply_reviews(decisions_path):
    """PHASE 6-8: merge human decisions into the final approved dataset."""
    from pipeline.review.apply import (
        DecisionsError, apply_decisions, load_decisions_file, validate_decisions,
    )
    from pipeline.export.gorgon_export import export_gorgon_js

    acts = _read(DATA_WORK / "routed.json", {}).get("activities", [])
    if not acts:
        # older pipeline runs may not have routed.json; fall back to scored.json
        acts = _read(DATA_WORK / "scored.json", {}).get("activities", [])
    if not acts:
        print("ERROR: no pipeline data. Run `python pipeline/run.py` first.")
        return 1
    known_ids = {a.get("id") for a in acts if a.get("id")}

    doc = load_decisions_file(decisions_path)
    try:
        decisions = validate_decisions(doc, known_ids)
    except DecisionsError as exc:
        print("DECISIONS REJECTED: %s" % exc)
        return 1

    final, counts, warnings = apply_decisions(acts, decisions)

    _write(DATA_APPROVED / "activities.json", {
        "DEMO_DATA": True,
        "count": len(final),
        "activities": final,
    })
    out = export_gorgon_js(final, str(GORGON_JS))

    print("")
    print("HUMAN REVIEW APPLY")
    print("")
    print("AUTO APPROVED: %s" % counts["auto_approved"])
    print("HUMAN APPROVED: %s" % counts["human_approved"])
    print("HUMAN REJECTED: %s" % counts["human_rejected"])
    print("HUMAN PENDING: %s" % counts["human_pending"])
    print("")
    print("FINAL APPROVED: %s" % len(final))
    print("")
    print("OUTPUT:")
    print("  %s" % (DATA_APPROVED / "activities.json"))
    print("  %s" % out)
    if warnings:
        print("")
        print("WARNINGS:")
        for w in warnings:
            print("  - %s" % w)
    print("")
    return 0


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
    parser.add_argument("--apply-reviews", nargs="?", const=str(DEFAULT_DECISIONS), metavar="DECISIONS_JSON",
                        help="apply human review decisions (default: pipeline/data/review/human_decisions.json)")
    args = parser.parse_args(argv)

    if args.apply_reviews:
        return apply_reviews(args.apply_reviews)

    until = args.stage or "export"
    state = run(until=until, export_gorgon=args.export_gorgon)
    print_report(state)
    return 0


if __name__ == "__main__":
    sys.exit(main())
