# JsonSourceAdapter — the only working source in this MVP (PHASE 3/15).
#
# Reads every *.json file under pipeline/data/raw/. Files may be either:
#   [ {...}, {...}, ... ]                     (bare list)
#   {"DEMO_DATA": true, "activities": [...]}  (wrapped; any wrapper key ending
#                                              in "activities" works)
#
# DEMO DATA: everything under data/raw in this MVP is demo content.

import json
import os
from pathlib import Path

from pipeline.ingest.base import SourceAdapter


class JsonSourceAdapter(SourceAdapter):
    name = "json"

    def __init__(self, raw_dir):
        self.raw_dir = Path(raw_dir)

    # -- SourceAdapter interface -----------------------------------------

    def fetch(self):
        """Return [(file_label, payload_dict_or_list), ...] for every .json."""
        payloads = []
        if not self.raw_dir.is_dir():
            return payloads
        for path in sorted(self.raw_dir.glob("*.json")):
            with open(path, "r", encoding="utf-8") as fh:
                payloads.append((path.stem, json.load(fh)))
        return payloads

    def parse(self, payload):
        file_label, blob = payload
        if isinstance(blob, list):
            return [(file_label, item) for item in blob if isinstance(item, dict)]
        if isinstance(blob, dict):
            for key, value in blob.items():
                if key.lower().endswith("activities") and isinstance(value, list):
                    return [(file_label, item) for item in value if isinstance(item, dict)]
        return []

    def to_raw_activity(self, item):
        file_label, fields = item
        act = dict(fields)
        # Deterministic id: use provided id, else build one from the source
        # file and position is impossible here, so require an id per record;
        # fall back to a hash of the whole record for robustness.
        if not act.get("id"):
            import hashlib

            digest = hashlib.sha1(
                json.dumps(fields, ensure_ascii=False, sort_keys=True).encode("utf-8")
            ).hexdigest()[:10]
            act["id"] = "raw_%s_%s" % (file_label, digest)
        if not act.get("sourceName"):
            act["sourceName"] = file_label
        return act

    # -- local helper ------------------------------------------------------

    def collect_all(self):
        """All raw activities from all raw/*.json files, in stable order."""
        out = []
        for payload in self.fetch():
            for item in self.parse(payload):
                out.append(self.to_raw_activity(item))
        return out


def ingest_raw(raw_dir, collected_at=None):
    """Stage entry point: returns list of raw activities with collectedAt."""
    import datetime

    stamp = collected_at or datetime.datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
    acts = JsonSourceAdapter(raw_dir).collect_all()
    for act in acts:
        if not act.get("collectedAt"):
            act["collectedAt"] = stamp
        act.setdefault("status", "raw")
    return acts
