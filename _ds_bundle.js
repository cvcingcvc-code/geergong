/*
 * _ds_bundle.js  —  RECONSTRUCTED runtime bundle for the Gorgon Design System
 * ---------------------------------------------------------------------------
 * STATUS: RECONSTRUCTED (NOT part of the original Claude export).
 *
 * The original Gorgon project relied on a runtime-generated `_ds_bundle.js`
 * produced by Claude's design-system tooling. That generated file was never
 * written into the recovered chat history and is therefore NOT available
 * verbatim. This file rebuilds the same `window.GorgonDesignSystem_56aa78`
 * namespace from the REAL recovered component sources:
 *     components/core/*, components/trust/*, components/location/*
 *
 * It does NOT modify or invent any component logic — it only performs the
 * mechanical import/export -> global-namespace glue that the original
 * generator did, and compiles JSX with the page's own Babel (loaded via CDN
 * in every index.html, available as window.Babel).
 *
 * If you later recover the original generated `_ds_bundle.js`, replace this
 * file with it. The component .jsx source files are untouched.
 *
 * NOTE: this file expects the project to be served from its ROOT
 * (e.g. `python3 -m http.server 8000` inside the Gorgon-Recovered folder),
 * because it fetches the component sources from root-relative paths.
 */
(function () {
  var NS = (window.GorgonDesignSystem_56aa78 = window.GorgonDesignSystem_56aa78 || {});

  // Root-relative paths (served from project root).
  // Order matters only for intra-component imports: ActivityCard imports
  // CATEGORIES (CategoryDot) and Tag, so it must be built LAST.
  var SOURCE = [
    "components/core/Button.jsx",
    "components/core/IconButton.jsx",
    "components/core/Tag.jsx",
    "components/core/Avatar.jsx",
    "components/core/Badge.jsx",
    "components/core/Input.jsx",
    "components/core/SearchField.jsx",
    "components/core/SegmentedControl.jsx",
    "components/core/StatBlock.jsx",
    "components/core/Switch.jsx",
    "components/core/CategoryDot.jsx",
    "components/trust/VerifiedBadge.jsx",
    "components/trust/SourceTag.jsx",
    "components/trust/TrustBanner.jsx",
    "components/trust/FreshnessLabel.jsx",
    "components/trust/ReportSheet.jsx",
    "components/location/RoutePlanner.jsx",
    "components/location/MapAppSheet.jsx",
    "components/core/ActivityCard.jsx"
  ];

  function req(url) {
    var x = new XMLHttpRequest();
    x.open("GET", url, false); // synchronous: keeps namespace ready before screens run
    x.send();
    if (x.status !== 200 && x.status !== 0) {
      throw new Error("failed to load " + url + " (status " + x.status + ")");
    }
    return x.responseText;
  }

  function build(code) {
    var names = [];
    // import React from "react"  ->  use the global UMD React
    code = code.replace(/import\s+React\s+from\s+["']react["'];?/g, "var React = window.React;");
    // import { X, Y } from "./Foo.jsx"  ->  pull from the design-system namespace
    code = code.replace(
      /import\s+\{([^}]+)\}\s+from\s+["']\.\/[\w-]+\.jsx["'];?/g,
      function (_, namesList) {
        return "var {" + namesList + "} = window.GorgonDesignSystem_56aa78;";
      }
    );
    // export function NAME  ->  function NAME  (collect for namespace assignment)
    code = code.replace(/export\s+function\s+(\w+)/g, function (_, n) {
      names.push(n);
      return "function " + n;
    });
    // export const NAME  ->  var NAME  (collect for namespace assignment)
    code = code.replace(/export\s+const\s+(\w+)/g, function (_, n) {
      names.push(n);
      return "var " + n;
    });
    // Compile JSX -> React.createElement via the page's Babel.
    var out = "";
    if (!window.Babel) {
      throw new Error("window.Babel is not available (CDN blocked?). Cannot compile components.");
    }
    out = window.Babel.transform(code, { presets: ["react"] }).code;
    // Expose every export on the namespace.
    out += "\n" + names
      .map(function (n) {
        return 'window.GorgonDesignSystem_56aa78["' + n + '"] = ' + n + ";";
      })
      .join("\n");
    (new Function(out))();
  }

  var failed = [];
  for (var i = 0; i < SOURCE.length; i++) {
    try {
      build(req("/" + SOURCE[i]));
    } catch (e) {
      failed.push(SOURCE[i] + " :: " + (e && e.message ? e.message : e));
    }
  }

  if (failed.length) {
    console.error("[_ds_bundle] Some components failed to build:\n" + failed.join("\n"));
  } else {
    console.log("[_ds_bundle] GorgonDesignSystem_56aa78 ready (" + Object.keys(NS).length + " exports).");
  }
  window.__GORGON_DS_READY__ = true;
  if (window.__GORGON_DS_WAITERS__) {
    window.__GORGON_DS_WAITERS__.forEach(function (f) { try { f(); } catch (e) {} });
  }
})();
