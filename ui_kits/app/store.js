// Gorgon Demo MVP — tiny localStorage persistence layer.
//
// Scope: DEMO ONLY. No backend, no database. Everything lives in the browser.
// Keys are stable so "Reset Demo" can clear them deterministically.
//
// PHASE 5: My Weekend now stores the FULL activity snapshot, not just the id.
// A search result the user saved must still be there after a refresh — and it
// must render even when the search session is gone (no API, new query, etc.).
// The old id-list key is still written (and still read) so existing storage
// keeps working.

(function () {
  var K_WEEKEND = "gorgon_my_weekend"; // string[] of activity ids
  var K_WEEKEND_ITEMS = "gorgon_my_weekend_items"; // { [id]: activityView }
  var K_FAVORITES = "gorgon_favorites"; // string[] of activity ids
  var K_ADMIN = "gorgon_admin_review"; // { [itemId]: "approve" | "return" | "reject" }
  var K_SEED = "gorgon_demo_v1"; // flag: demo dataset has been seeded once

  function read(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (raw == null) return fallback;
      var v = JSON.parse(raw);
      return v == null ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      /* private mode / quota — demo degrades to in-memory */
    }
  }

  function toArray(v) {
    return Array.isArray(v) ? v.filter(function (x) { return typeof x === "string"; }) : [];
  }

  function toMap(v) {
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  }

  window.GorgonStore = {
    KEYS: {
      weekend: K_WEEKEND, weekendItems: K_WEEKEND_ITEMS,
      favorites: K_FAVORITES, admin: K_ADMIN, seed: K_SEED,
    },

    // ---- My Weekend ----------------------------------------------------
    /** id -> saved activity snapshot. The source of truth for the UI. */
    getWeekendItems: function () {
      return toMap(read(K_WEEKEND_ITEMS, {}));
    },
    setWeekendItems: function (map) {
      map = toMap(map);
      write(K_WEEKEND_ITEMS, map);
      // keep the id list in sync for anything still reading it
      write(K_WEEKEND, Object.keys(map).filter(function (k) { return map[k]; }));
    },
    getWeekend: function () {
      var items = toMap(read(K_WEEKEND_ITEMS, {}));
      var ids = Object.keys(items);
      // Fall back to the legacy id list when no snapshots were ever saved.
      return ids.length ? ids : toArray(read(K_WEEKEND, []));
    },
    setWeekend: function (ids) {
      write(K_WEEKEND, toArray(ids));
    },
    toggleWeekend: function (id, currentMap) {
      var map = currentMap ? Object.assign({}, currentMap) : {};
      map[id] = !map[id];
      var ids = Object.keys(map).filter(function (k) { return map[k]; });
      write(K_WEEKEND, ids);
      return map;
    },

    // ---- Favorites -----------------------------------------------------
    getFavorites: function () {
      return toArray(read(K_FAVORITES, []));
    },
    setFavorites: function (ids) {
      write(K_FAVORITES, toArray(ids));
    },

    // ---- Admin review --------------------------------------------------
    getAdmin: function () {
      var v = read(K_ADMIN, {});
      return v && typeof v === "object" && !Array.isArray(v) ? v : {};
    },
    setAdmin: function (obj) {
      write(K_ADMIN, obj && typeof obj === "object" ? obj : {});
    },

    // ---- Demo seed flag (so the demo starts clean but non-empty) -------
    isSeeded: function () {
      return read(K_SEED, false) === true;
    },
    markSeeded: function () {
      write(K_SEED, true);
    },

    // ---- Reset ---------------------------------------------------------
    reset: function () {
      try {
        localStorage.removeItem(K_WEEKEND);
        localStorage.removeItem(K_WEEKEND_ITEMS);
        localStorage.removeItem(K_FAVORITES);
        localStorage.removeItem(K_ADMIN);
        localStorage.removeItem(K_SEED);
      } catch (e) {}
    }
  };
})();
