# Guard: every trust reason the scorer can emit has a human-readable label.
#
# `pipeline/trust/scorer.py` writes its OWN rule names into `trustReasons`, and
# PHASE 5 found the detail page printing them verbatim — a reader saw
# "cross_source_conflict". The UI now translates them, but a translation table
# is only as good as its coverage: the day someone adds a rule to the scorer,
# the page silently starts leaking a developer string again.
#
# So the vocabulary is DERIVED from the scorer here, not copied, and checked
# against the label table in the app's view model.

import os
import re
import unittest

from pipeline.trust import scorer

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
VIEW_MODEL = os.path.join(REPO, "ui_kits", "app", "activity-view.js")

# Emitted by score_activity / _conflict_groups in addition to the rule tables.
_EXTRA_REASONS = {
    "invalid_time_range",   # startTime/endTime table is inconsistent
    "location_conflict",    # cross-source venue disagreement
    "price_conflict",       # cross-source price disagreement
}


def _emittable_reasons():
    return set(scorer.POINTS) | set(scorer.PENALTIES) | _EXTRA_REASONS


def _label_keys():
    """Codes listed in the TRUST_REASON_LABEL table of the view model."""
    with open(VIEW_MODEL, encoding="utf-8") as fh:
        source = fh.read()
    block = re.search(r"var TRUST_REASON_LABEL = \{(.*?)\n  \};", source, re.S)
    if not block:
        raise AssertionError("TRUST_REASON_LABEL table not found in " + VIEW_MODEL)
    return set(re.findall(r"^\s*([a-z_]+):\s*\"", block.group(1), re.M))


class TestTrustReasonLabels(unittest.TestCase):

    def test_the_scorer_vocabulary_is_fully_translated(self):
        missing = sorted(_emittable_reasons() - _label_keys())
        self.assertEqual(
            missing, [],
            "these trust rules would render as developer strings: %s" % missing)

    def test_the_table_has_no_stale_entries(self):
        # A label for a rule the scorer no longer emits is dead weight, and a
        # hint that the two files have drifted apart.
        stale = sorted(_label_keys() - _emittable_reasons())
        self.assertEqual(stale, [], "labels with no matching scorer rule: %s" % stale)

    def test_labels_are_chinese_and_not_codes(self):
        with open(VIEW_MODEL, encoding="utf-8") as fh:
            source = fh.read()
        block = re.search(r"var TRUST_REASON_LABEL = \{(.*?)\n  \};", source, re.S).group(1)
        for code, label in re.findall(r"^\s*([a-z_]+):\s*\"([^\"]*)\"", block, re.M):
            with self.subTest(code=code):
                self.assertRegex(label, r"[\u4e00-\u9fff]",
                                 "%s is not translated" % code)
                self.assertNotEqual(label, code)


if __name__ == "__main__":
    unittest.main()
