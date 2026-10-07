/* Gorgon PWA service worker
 * Hand-written (no Workbox) so the build stays dependency-free and the
 * behaviour is fully transparent. Strategy:
 *   - install: precache the app shell + icons, then skipWaiting()
 *   - activate: drop stale caches, take control of open clients
 *   - fetch (same-origin GET only):
 *       * navigations      -> network-first, fall back to cached index.html
 *       * static assets    -> cache-first w/ runtime population (hashed names
 *                             from Vite are handled automatically)
 *       * /api GET         -> network-first w/ cache fallback (best-effort)
 *   Cross-origin requests are passed through untouched.
 */
const CACHE = "gorgon-pwa-v1";
const APP_SHELL = [
  "/index.html",
  "/manifest.webmanifest",
  "/icons/icon-256.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(APP_SHELL).catch(() => undefined))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // cross-origin: let it be

  if (req.mode === "navigate") {
    // Network-first for SPA navigations; fall back to the cached shell.
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("/index.html", copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match("/index.html").then((r) => r || caches.match("/")))
    );
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    // Best-effort offline data: try network, fall back to a cached response.
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // Static assets (hashed JS/CSS/PNG/SVG/woff): cache-first, populate on miss.
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          if (res && res.ok && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
    })
  );
});
