# Ingest layer — SourceAdapter interface (PHASE 15).
#
# A source adapter knows how to FETCH raw data and turn it into a list of
# raw-activity dicts (canonical field names, but values may be messy).
# Nothing in ingest normalizes or judges content.

import abc


class SourceAdapter(abc.ABC):
    """Base interface for all data sources.

    Subclasses implement:
      fetch()             -> raw payload (any shape the source uses)
      parse(payload)      -> list[dict] of raw activity field maps
      to_raw_activity(d)  -> canonical raw activity dict (id + fields)
    """

    name = "base"

    @abc.abstractmethod
    def fetch(self):  # pragma: no cover - interface
        raise NotImplementedError

    @abc.abstractmethod
    def parse(self, payload):  # pragma: no cover - interface
        raise NotImplementedError

    @abc.abstractmethod
    def to_raw_activity(self, item):  # pragma: no cover - interface
        raise NotImplementedError

    def collect(self):
        """Convenience: fetch + parse + to_raw_activity for every item."""
        out = []
        for item in self.parse(self.fetch()):
            out.append(self.to_raw_activity(item))
        return out


# Reserved adapters (NOT implemented in this MVP — interface placeholders only).

class WebSourceAdapter(SourceAdapter):
    """Future: crawl a public web listing page. Do not implement in MVP."""

    name = "web"


class WechatSourceAdapter(SourceAdapter):
    """Future: pull from WeChat official-account articles. Not in MVP."""

    name = "wechat"


class ManualSourceAdapter(SourceAdapter):
    """Future: human-submitted entries (form / spreadsheet). Not in MVP."""

    name = "manual"
