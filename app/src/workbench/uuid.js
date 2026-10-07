// Gorgon Workbench — uuid helper (Phase 2).
//
// crypto.randomUUID() is available in all modern browsers and Node >= 19
// (and Node 14.17/16+ behind the webcrypto global). This wrapper gives a
// deterministic RFC-4122 v4 fallback for exotic environments so the Task
// Engine never hard-fails on id generation. No third-party dependency.

export function randomUUID() {
  try {
    const c = typeof crypto !== "undefined" ? crypto : (globalThis && globalThis.crypto);
    if (c && typeof c.randomUUID === "function") return c.randomUUID();
    if (c && typeof c.getRandomValues === "function") {
      const b = c.getRandomValues(new Uint8Array(16));
      b[6] = (b[6] & 0x0f) | 0x40; // version 4
      b[8] = (b[8] & 0x3f) | 0x80; // variant 10
      const hex = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
  } catch { /* fall through */ }
  // Last resort: Math.random v4-shaped id (still unique enough locally).
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
