# End-to-end pipeline tests: run the real CLI on the real demo raw data and
# verify the outputs are valid JSON / valid JS (PHASE 13 / PHASE 16 hooks).

import json
import subprocess
import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
RUN = str(REPO_ROOT / "pipeline" / "run.py")


class TestEndToEnd(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.proc = subprocess.run(
            [sys.executable, RUN],
            capture_output=True, text=True, cwd=str(REPO_ROOT), timeout=120,
        )

    def test_cli_exits_zero(self):
        self.assertEqual(self.proc.returncode, 0, self.proc.stderr)

    def test_report_shape(self):
        out = self.proc.stdout
        for marker in ("RAW:", "NORMALIZED:", "DUPLICATES:", "NEEDS REVIEW:", "APPROVED:"):
            self.assertIn(marker, out)

    def test_approved_output_valid_json(self):
        data = json.loads(
            (REPO_ROOT / "pipeline/data/approved/activities.json").read_text(encoding="utf-8")
        )
        self.assertTrue(data["DEMO_DATA"])
        self.assertIsInstance(data["activities"], list)
        self.assertGreater(len(data["activities"]), 0)

    def test_review_queue_valid_json(self):
        data = json.loads(
            (REPO_ROOT / "pipeline/data/review/review_queue.json").read_text(encoding="utf-8")
        )
        for entry in data["queue"]:
            self.assertIn("activity", entry)
            self.assertIn("reason", entry)
            self.assertIn("trustScore", entry)
            self.assertIn("duplicateCandidates", entry)

    def test_gorgon_export_valid_js(self):
        text = (REPO_ROOT / "ui_kits/app/generated-data.js").read_text(encoding="utf-8")
        self.assertIn("window.GORGON_GENERATED_DATA", text)
        # The payload after the assignment must be a pure JSON array literal.
        body = text[text.index("["): text.rindex("]") + 1]
        records = json.loads(body)
        self.assertGreater(len(records), 0)
        for rec in records:
            self.assertIn("id", rec)
            self.assertIn("title", rec)
            self.assertIn("category", rec)
            self.assertIn("price", rec)


if __name__ == "__main__":
    unittest.main()
