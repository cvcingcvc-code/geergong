# Metadata cache (PHASE 5).
#
# Refreshing the results list must not re-fetch every event page, so page
# metadata and the resolved image URL are cached on disk. Scope is
# deliberately small: a JSON file per URL, holding the parsed metadata —
# NOT the images themselves (downloading hundreds of MB of pictures is
# explicitly out of scope; the UI renders the origin URL).
#
#   pipeline/data/cache/pages/<sha1>.json     parsed PageMetadata
#   pipeline/data/cache/images/<sha1>.json    resolved image for a page url
#
# Cache entries carry a TTL; an expired entry is ignored, never deleted, so
# a broken write can never destroy the only copy of something.

import hashlib
import json
import os
import time

DEFAULT_TTL_SECONDS = 6 * 60 * 60      # 6h: long enough for a browsing session
MAX_ENTRIES = 500                      # hard cap so the cache cannot grow forever


def _key(url):
    return hashlib.sha1(str(url).encode("utf-8")).hexdigest()


class MetadataCache(object):
    """Tiny JSON-on-disk cache. All operations are failure-tolerant."""

    def __init__(self, cache_dir, ttl=DEFAULT_TTL_SECONDS, enabled=True, clock=None):
        self.cache_dir = cache_dir
        self.ttl = ttl
        self.enabled = bool(enabled and cache_dir)
        self._clock = clock or time.time
        self.stats = {"hits": 0, "misses": 0, "writes": 0, "expired": 0}

    # -- paths --------------------------------------------------------------

    def _dir(self, namespace):
        return os.path.join(self.cache_dir, namespace)

    def _path(self, namespace, url, suffix="json"):
        return os.path.join(self._dir(namespace), "%s.%s" % (_key(url), suffix))

    # -- generic ------------------------------------------------------------

    def get(self, namespace, url):
        if not self.enabled:
            return None
        path = self._path(namespace, url)
        try:
            with open(path, "r", encoding="utf-8") as fh:
                payload = json.load(fh)
        except (OSError, ValueError):
            self.stats["misses"] += 1
            return None
        stored = payload.get("storedAt")
        if not isinstance(stored, (int, float)) or (self._clock() - stored) > self.ttl:
            self.stats["expired"] += 1
            self.stats["misses"] += 1
            return None
        self.stats["hits"] += 1
        return payload.get("value")

    def put(self, namespace, url, value):
        if not self.enabled:
            return False
        directory = self._dir(namespace)
        try:
            if not os.path.isdir(directory):
                os.makedirs(directory)
            tmp = self._path(namespace, url, "tmp")
            final = self._path(namespace, url)
            with open(tmp, "w", encoding="utf-8", newline="\n") as fh:
                json.dump({"url": url, "storedAt": self._clock(), "value": value},
                          fh, ensure_ascii=False)
            os.replace(tmp, final)
            self.stats["writes"] += 1
            self._prune(namespace)
            return True
        except OSError:
            return False

    def _prune(self, namespace):
        directory = self._dir(namespace)
        try:
            entries = [os.path.join(directory, n) for n in os.listdir(directory)
                       if n.endswith(".json")]
        except OSError:
            return
        if len(entries) <= MAX_ENTRIES:
            return
        entries.sort(key=lambda p: os.path.getmtime(p) or 0)
        for path in entries[:len(entries) - MAX_ENTRIES]:
            try:
                os.remove(path)
            except OSError:
                pass

    def clear(self):
        import shutil
        for namespace in ("pages", "images"):
            directory = self._dir(namespace)
            if os.path.isdir(directory):
                shutil.rmtree(directory, ignore_errors=True)

    def summary(self):
        return dict(self.stats)


class NullCache(MetadataCache):
    """Cache that stores nothing (tests / GORGON_CACHE_DIR=off)."""

    def __init__(self):
        MetadataCache.__init__(self, cache_dir=None, enabled=False)

    def get(self, namespace, url):
        return None

    def put(self, namespace, url, value):
        return False
