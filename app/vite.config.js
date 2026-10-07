import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

// The retrieval API (pipeline/api/server.py) deliberately sends NO
// Access-Control-Allow-Origin header (see docs/PUBLIC_DEPLOYMENT.md §G), so a
// cross-origin fetch from the Vite dev server would be blocked by the
// browser. In dev/preview the app therefore talks to /api on its OWN origin
// and Vite proxies it to the Python server on 127.0.0.1:8000. Production
// builds point at a real server via VITE_API_BASE_URL (see src/lib/api.js).
const API_PROXY = {
  "/api": {
    target: "http://127.0.0.1:8000",
    changeOrigin: true,
  },
};

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // The app imports the design-system sources (components/) and the
    // pipeline-generated demo data (ui_kits/app/generated-*.js) straight from
    // the repo, so the dev server must be allowed to read the repo root.
    fs: { allow: [REPO_ROOT] },
    proxy: API_PROXY,
  },
  preview: {
    port: 4173,
    proxy: API_PROXY,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
