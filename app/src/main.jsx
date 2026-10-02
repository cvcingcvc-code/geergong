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

// Additive category extension (科技/黑客松/展览/市集/讲座/社交/校园/公益)
// — must run BEFORE the first render so var(--cat-*) resolves everywhere.
applyCategoryExtensions();

// The ?demo=1 reset chip (same behaviour as the legacy demo-reset.js).
initDemoReset();

createRoot(document.getElementById("root")).render(<App />);
