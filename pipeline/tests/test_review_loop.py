# Human Review Loop tests (PHASE 12).
#
# Covers: auto-approve path, pending/human-approve/reject, human edits,
# decisions-file validation, duplicate-decision determinism, and the
# PHASE 9 conflict upgrades (time / price / venue -> needs_review).

import copy
import json
import sys
import unittest
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = PIPELINE_DIR.parent
for p in (str(REPO_ROOT), str(PIPELINE_DIR)):
    if p not in sys.path:
        sys.path.insert(0, p)

from pipeline.review.apply import (  # noqa: E402
    DecisionsError, apply_decisions, validate_decisions,
)
from pipeline.trust.scorer import score_all  # noqa: E402
from pipeline.review.queue import route  # noqa: E402
from pipeline.export.admin_review_export import build_review_items  # noqa: E402


def _act(id, **kw):
    base = {
        "id": id,
        "title": "测试活动 %s" % id,
        "description": "描述",
        "startDate": "2026-09-20",
        "startTime": "19:00",
        "endTime": "21:00",
        "venue": "场地A",
        "district": "徐汇",
        "city": "上海",
        "tags": [],
        "priceType": "free",
        "price": 0,
        "organizer": "主办方",
        "sourceName": "src_%s" % id,
        "sourceUrl": "https://example.com/%s" % id,
        "registrationUrl": "https://example.com/%s/reg" % id,
        "trustScore": 90,
        "trustReasons": ["has_source_url"],
        "status": "approved",
        "duplicateOf": None,
    }
    base.update(kw)
    return base


def _conflict_pair(**overrides):
    """Two records in the same (title, date) group from different sources."""
    a = _act("g1", sourceName="src_a")
    b = _act("g2", sourceName="src_b", **overrides)
    b["title"] = a["title"]
    return [a, b]


class TestConflictDetection(unittest.TestCase):
    def _same_group(self, **overrides):
        return _conflict_pair(**overrides)

    def _status_of(self, acts, id):
        return {x["id"]: x["status"] for x in route(score_all(acts))[0]}[id]

    def test_time_conflict_needs_review(self):
        acts = self._same_group(startTime="20:00")
        st = self._status_of(acts, "g1")
        self.assertEqual(st, "needs_review")
        a1 = score_all(acts)[0]
        tokens = a1["trustReasons"]
        self.assertIn("time_conflict", tokens)
        self.assertIn("cross_source_conflict", tokens)
        self.assertIn("time_conflict", [c["type"] for c in a1["conflicts"]])

    def test_price_conflict_needs_review(self):
        acts = self._same_group(priceType="paid", price=99)
        st = self._status_of(acts, "g1")
        self.assertEqual(st, "needs_review")
        a1 = score_all(acts)[0]
        self.assertIn("price_conflict", [c["type"] for c in a1["conflicts"]])

    def test_venue_conflict_needs_review(self):
        acts = self._same_group(venue="浦东图书馆")
        st = self._status_of(acts, "g1")
        self.assertEqual(st, "needs_review")
        a1 = score_all(acts)[0]
        self.assertIn("location_conflict", [c["type"] for c in a1["conflicts"]])

    def test_identical_group_no_conflict(self):
        acts = self._same_group()  # same everything, two sources
        acts[1]["title"] = acts[0]["title"]
        out = route(score_all(acts))[0]
        statuses = {x["id"]: x["status"] for x in out}
        self.assertEqual(statuses["g1"], "approved")


class TestApplyDecisions(unittest.TestCase):
    def setUp(self):
        self.acts = [
            _act("auto1"),                                   # auto approved
            _act("p1", status="needs_review", trustScore=70),  # pending
            _act("p2", status="needs_review", trustScore=70),  # human approve
            _act("p3", status="needs_review", trustScore=70),  # human reject
            _act("p4", status="needs_review", trustScore=70),  # human edit+approve
            _act("p5", status="needs_review", trustScore=70),  # needs_edit
        ]

    def _decisions(self):
        return {
            "p2": {"decision": "approved", "reviewedAt": "T1", "edits": {}},
            "p3": {"decision": "rejected", "reviewedAt": "T2", "edits": {}},
            "p4": {"decision": "approved", "reviewedAt": "T3", "edits": {"venue": "人工修改的场地", "price": "¥29"}},
            "p5": {"decision": "needs_edit", "reviewedAt": "T4", "edits": {}},
        }

    def test_full_merge(self):
        final, counts, _ = apply_decisions(self.acts, self._decisions())
        ids = {a["id"] for a in final}
        # auto approved needs no human decision
        self.assertIn("auto1", ids)
        # pending not decided -> excluded
        self.assertNotIn("p1", ids)
        # human approve -> included
        self.assertIn("p2", ids)
        # human reject -> excluded
        self.assertNotIn("p3", ids)
        # needs_edit -> stays pending, excluded
        self.assertNotIn("p5", ids)
        self.assertEqual(counts["auto_approved"], 1)
        self.assertEqual(counts["human_approved"], 2)
        self.assertEqual(counts["human_rejected"], 1)
        self.assertEqual(counts["human_pending"], 2)
        self.assertEqual(len(final), 3)

    def test_edits_applied_and_provenance(self):
        final, _, _ = apply_decisions(self.acts, self._decisions())
        p4 = {a["id"]: a for a in final}["p4"]
        self.assertEqual(p4["venue"], "人工修改的场地")
        self.assertEqual(p4["priceType"], "paid")
        self.assertEqual(p4["price"], 29)
        self.assertEqual(p4["reviewedBy"], "human")
        self.assertEqual(p4["reviewDecision"], "approved")
        self.assertTrue(p4["humanEdited"])
        self.assertEqual(p4["reviewedAt"], "T3")
        auto = {a["id"]: a for a in final}["auto1"]
        self.assertEqual(auto["reviewedBy"], "auto")
        self.assertEqual(auto["reviewDecision"], "auto_approved")
        self.assertFalse(auto["humanEdited"])

    def test_original_records_not_modified(self):
        original = copy.deepcopy(self.acts)
        apply_decisions(self.acts, self._decisions())
        self.assertEqual(self.acts, original)

    def test_validation_unknown_id_rejected(self):
        with self.assertRaises(DecisionsError):
            validate_decisions(
                {"version": 1, "decisions": {"ghost": {"decision": "approved"}}},
                known_ids={"p1"},
            )

    def test_validation_bad_decision_enum(self):
        with self.assertRaises(DecisionsError):
            validate_decisions(
                {"version": 1, "decisions": {"p1": {"decision": "maybe"}}},
                known_ids={"p1"},
            )

    def test_validation_non_editable_field(self):
        with self.assertRaises(DecisionsError):
            validate_decisions(
                {"version": 1,
                 "decisions": {"p1": {"decision": "approved",
                                      "edits": {"trustScore": 99}}}},
                known_ids={"p1"},
            )

    def test_duplicate_decision_last_wins(self):
        raw = json.dumps({
            "version": 1,
            "decisions": {
                "p1": {"decision": "rejected", "reviewedAt": "T1", "edits": {}},
                "p1": {"decision": "approved", "reviewedAt": "T2", "edits": {}},
            },
        })
        doc = json.loads(raw)  # JSON spec: last duplicate key wins
        decisions = validate_decisions(doc, known_ids={"p1"})
        self.assertEqual(decisions["p1"]["decision"], "approved")

    def test_missing_decision_file_shape(self):
        with self.assertRaises(DecisionsError):
            validate_decisions({"foo": 1}, known_ids={"p1"})


class TestAdminReviewExport(unittest.TestCase):
    def test_review_items_shape(self):
        acts = score_all([
            _act("x1", status="needs_review", trustScore=65),
            _act("x2", title="测试活动 x1", sourceName="other", status="needs_review",
                 trustScore=65, duplicateOf="x1", duplicateConfidence=0.9),
        ])
        route(acts)
        queue = {"queue": [
            {"activity": acts[0], "reason": "medium_confidence",
             "trustScore": 65, "duplicateCandidates": []},
            {"activity": acts[1], "reason": "duplicate_candidate",
             "trustScore": 65,
             "duplicateCandidates": [{"duplicateOf": "x1", "duplicateConfidence": 0.9}]},
        ]}
        items = build_review_items(acts, queue["queue"])
        self.assertEqual(len(items), 2)
        dup = items[1]
        self.assertEqual(dup["reviewReason"], "duplicate_candidate")
        self.assertEqual(dup["duplicateCandidates"][0]["duplicateOf"], "x1")
        cand = dup["duplicateCandidates"][0]["activity"]
        for key in ("title", "startDate", "venue", "organizer", "sourceName"):
            self.assertIn(key, cand)

    def test_conflict_reaches_export(self):
        acts = score_all(_conflict_pair(startTime="20:00"))
        route(acts)
        queue = {"queue": [
            {"activity": acts[0], "reason": "cross_source_conflict",
             "trustScore": acts[0]["trustScore"], "duplicateCandidates": []},
        ]}
        items = build_review_items(acts, queue["queue"])
        types = [c["type"] for c in items[0]["conflicts"]]
        self.assertIn("time_conflict", types)


if __name__ == "__main__":
    unittest.main()
