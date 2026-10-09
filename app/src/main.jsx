// Gorgon V1 — frontend entry point.
//
// Replaces ui_kits/app/index.html's runtime stack (React development build
// + ReactDOM development build + Babel Standalone + window.lucide +
// _ds_bundle.js runtime fetch/compile) with a standard Vite module graph.
// Everything below is compiled at BUILD time; the production bundle ships
// the production React and no transpiler.

// Design system CSS — the SAME files the legacy app links, imported (not
// copied) so the two frontends can never drift apart visually.
import "../../styles.css";
import "../../ui_kits/app/responsive.css";

import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { applyCategoryExtensions } from "./lib/categories.js";
import { initDemoReset } from "./lib/demo-reset.js";
import { initDemoMode } from "./lib/demo-mode.js";

// Additive category extension (科技/黑客松/展览/市集/讲座/社交/校园/公益)
// — must run BEFORE the first render so var(--cat-*) resolves everywhere.
applyCategoryExtensions();

// Phase 7: ?demo=1 seeds a reproducible, offline competition demo task
// (idempotent), then mounts the reset chip. Must run BEFORE the first render
// so the seeded task is present when App reads the repository.
initDemoMode();
initDemoReset();

// Register the PWA service worker in production builds only (skip the Vite
// dev server so it never caches dev assets). localhost is a secure context,
// so installability also works under `vite preview` and any HTTPS deploy.
if (import.meta.env.PROD && "serviceWorker" in navigator && location.protocol.startsWith("http")) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

createRoot(document.getElementById("root")).render(<App />);
