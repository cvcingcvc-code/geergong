// ResponseCache — deterministic, in-memory cache keyed by provider+model+purpose+input.
//
// Identical requests should not re-invoke the model. Cached entries are flagged
// `cached:true` so callers/UI can show "来自本地缓存" instead of "AI 正在生成".

function cacheKey(provider, model, purpose, input) {
  return [provider, model, purpose, input].map((s) => String(s)).join("");
}

export function createResponseCache() {
  const map = new Map();

  return {
    has(provider, model, purpose, input) {
      return map.has(cacheKey(provider, model, purpose, input));
    },
    get(provider, model, purpose, input) {
      const hit = map.get(cacheKey(provider, model, purpose, input));
      if (!hit) return null;
      // Return a copy flagged as cached.
      return { ...hit, cached: true };
    },
    set(provider, model, purpose, input, response) {
      map.set(cacheKey(provider, model, purpose, input), { ...response, cached: false });
    },
    clear() {
      map.clear();
    },
    size() {
      return map.size;
    },
  };
}
