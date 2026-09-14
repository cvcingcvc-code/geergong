// Gorgon Demo MVP — tiny localStorage persistence layer.
//
// Scope: DEMO ONLY. No backend, no database. Everything lives in the browser.
// Keys are stable so "Reset Demo" can clear them deterministically.

(function () {
  var K_WEEKEND = "gorgon_my_weekend"; // string[] of activity ids
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

  window.GorgonStore = {
    KEYS: { weekend: K_WEEKEND, favorites: K_FAVORITES, admin: K_ADMIN, seed: K_SEED },

    // ---- My Weekend ----------------------------------------------------
    getWeekend: function () {
      return toArray(read(K_WEEKEND, []));
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
        localStorage.removeItem(K_FAVORITES);
        localStorage.removeItem(K_ADMIN);
        localStorage.removeItem(K_SEED);
      } catch (e) {}
    }
  };
})();
