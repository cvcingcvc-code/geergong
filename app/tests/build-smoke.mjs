// Gorgon V1 — production build smoke test.
//
// Runs a real `vite build`, then asserts on the dist/ output:
//   1. dist/index.html exists and references a bundled module script
//   2. JS/CSS assets exist
//   3. the placeholder SVGs were copied (dist is self-contained)
//   4. NO Babel Standalone / React development build / window.lucide
//      runtime markers anywhere in the shipped files
//   5. NO secrets (SEARCH_API_KEY or any *_API_KEY / secret-looking tokens)
//   6. no debug internals (no pipeline/ paths, no absolute filesystem paths)
//
// Run:  node tests/build-smoke.mjs        (from app/)
//       npm run test:build

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(APP, "dist");

let passed = 0;
const failures = [];
function ok(cond, label) {
  if (cond) { passed++; console.log("  PASS  " + label); return; }
  failures.push(label);
  console.error("  FAIL  " + label);
}

/* ── 1. build ─────────────────────────────────────────────────────────── */
console.log("[build-smoke] running vite build ...");
execFileSync(process.execPath, [path.join(APP, "node_modules", "vite", "bin", "vite.js"), "build"], {
  cwd: APP, stdio: "inherit",
});

/* ── 2. structure ─────────────────────────────────────────────────────── */
const indexHtml = path.join(DIST, "index.html");
ok(fs.existsSync(indexHtml), "dist/index.html exists");
const html = fs.readFileSync(indexHtml, "utf8");
ok(/<script[^>]+type="module"[^>]+src="[^"]*assets\/[^"]+\.js"/.test(html),
  "index.html loads a bundled module script");

const assetDir = path.join(DIST, "assets");
const assets = fs.existsSync(assetDir) ? fs.readdirSync(assetDir) : [];
const jsFiles = assets.filter((f) => f.endsWith(".js"));
const cssFiles = assets.filter((f) => f.endsWith(".css"));
ok(jsFiles.length > 0, `JS bundle emitted (${jsFiles.length} file(s))`);
ok(cssFiles.length > 0, `CSS bundle emitted (${cssFiles.length} file(s))`);

const placeholders = path.join(DIST, "assets", "placeholders");
const svgCount = fs.existsSync(placeholders)
  ? fs.readdirSync(placeholders).filter((f) => f.endsWith(".svg")).length : 0;
ok(svgCount >= 13, `placeholder SVGs bundled into dist (${svgCount})`);

/* ── 3. read every shipped text file once ─────────────────────────────── */
function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else yield p;
  }
}
const shipped = [...walk(DIST)].filter((p) => /\.(html|js|css|map)$/.test(p));
const corpus = shipped.map((p) => ({ p, text: fs.readFileSync(p, "utf8") }));

/* ── 4. no development/runtime-compiler leftovers ─────────────────────── */
const BANNED = [
  ["babel.min.js", "Babel Standalone script reference"],
  ["window.Babel", "Babel runtime API"],
  ["react.development.js", "React development build"],
  ["react-dom.development.js", "ReactDOM development build"],
  ["data-lucide", "window.lucide icon placeholder (icons must be React-owned)"],
  ["lucide.createIcons", "window.lucide runtime"],
  ["_ds_bundle", "runtime DS bundle (build-time imports only)"],
  ["GorgonDesignSystem_56aa78", "window DS namespace (build-time imports only)"],
  ["text/babel", "in-browser JSX transform"],
];
for (const [needle, why] of BANNED) {
  const hit = corpus.find((f) => f.text.includes(needle));
  ok(!hit, `no ${why}` + (hit ? ` — found in ${path.basename(hit.p)}` : ""));
}

/* ── 5. no secrets ────────────────────────────────────────────────────── */
const SECRET_PATTERNS = [
  /SEARCH_API_KEY/i,
  /(?:api[_-]?key|secret|token|password)["']?\s*[:=]\s*["'][A-Za-z0-9_\-]{16,}["']/i,
];
for (const re of SECRET_PATTERNS) {
  const hit = corpus.find((f) => re.test(f.text));
  ok(!hit, `no secret pattern ${re}` + (hit ? ` — found in ${path.basename(hit.p)}` : ""));
}

/* ── 6. no debug internals / absolute paths ───────────────────────────── */
const hitPipeline = corpus.find((f) => /pipeline[\\\/]api[\\\/]server\.py/.test(f.text));
ok(!hitPipeline, "no server-internal file paths in bundle");
const hitAbs = corpus.find((f) => /[A-Za-z]:[\\\/]Users[\\\/]/.test(f.text));
ok(!hitAbs, "no absolute filesystem paths in bundle");

console.log(`\n[build-smoke] ${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
