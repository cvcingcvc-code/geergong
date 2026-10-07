// Gorgon V1 — the ONE API configuration layer.
//
// Every request the frontend makes goes through this module. No component
// may hard-code an API URL.
//
// Resolution order:
//   1. VITE_API_BASE_URL (build-time env) — used for production deployments
//      where the frontend and the API live on different origins, e.g. a
//      future Tauri desktop build talking to the production HTTPS server:
//        VITE_API_BASE_URL=https://api.example.com npm run build
//   2. "" (same origin) — the default. In `vite dev` / `vite preview` the
//      dev server proxies /api -> http://127.0.0.1:8000 (see vite.config.js),
//      which is what "development defaults to 127.0.0.1:8000" means in
//      practice: the Python API server intentionally sends NO CORS headers
//      (docs/PUBLIC_DEPLOYMENT.md §G), so the browser must stay same-origin.
//
// SECURITY: nothing secret ever lives here. SEARCH_API_KEY and every
// provider key belong to the Python server and are never shipped to the
// browser. This module only knows a base URL — public information by design.

// `import.meta.env` is injected by Vite at build time. Guard the access so
// this module is also safe to import in plain Node (unit tests, SSR, etc.)
// where `import.meta.env` is undefined.
const ENV = (typeof import.meta !== "undefined" && import.meta.env) || {};
const RAW_BASE = (ENV.VITE_API_BASE_URL || "").trim();
export const API_BASE_URL = RAW_BASE.replace(/\/+$/, "");

/** Absolute URL for an API path ("/api/search" -> "<base>/api/search"). */
export function apiUrl(path) {
  const p = String(path || "");
  return API_BASE_URL + (p.charAt(0) === "/" ? p : "/" + p);
}

// A backstop above the server's own 40s deadline: the server's readable 504
// should win, and only a genuinely wedged connection gets aborted here.
export const REQUEST_TIMEOUT_MS = 45000;

/**
 * POST /api/search — the natural-language retrieval endpoint.
 *
 * Returns a discriminated result, never throws:
 *   { kind: "ok",    data }                    — HTTP 2xx, parsed JSON
 *   { kind: "error", status, detail }          — server answered 4xx/5xx
 *                                                (a REAL failure, report it)
 *   { kind: "unavailable" }                    — no server reachable at all
 *                                                (the caller may fall back
 *                                                to the recorded demo payload
 *                                                and must SAY SO)
 */
export async function searchActivities({ query, topics, maxResults = 30, district } = {}) {
  const body = { query: String(query || ""), maxResults };
  if (topics && topics.length) body.topics = topics;
  if (district) body.district = district;

  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : null;
  try {
    const res = await fetch(apiUrl("/api/search"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller ? controller.signal : undefined,
    });
    if (res.ok) {
      return { kind: "ok", data: await res.json() };
    }
    // A 4xx/5xx from a live server is a real failure, not "no API" — the
    // server sends a human-readable `message`; `detail` is the legacy key.
    let detail = "";
    try {
      const payload = await res.json();
      detail = payload.message || payload.detail || "";
    } catch (e) { /* non-JSON error body */ }
    return { kind: "error", status: res.status, detail };
  } catch (e) {
    if (e && e.name === "AbortError") {
      return { kind: "error", status: 0,
               detail: "检索超时，请稍后重试，或换一个更具体的关键词。" };
    }
    return { kind: "unavailable" };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
