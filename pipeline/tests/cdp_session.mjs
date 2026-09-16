// Minimal zero-dependency CDP driver for headless Microsoft Edge.
//
// Why not Playwright: this machine has no Playwright and downloading a bundled
// Chromium is ~500MB for no benefit — Edge is already installed, and Node 22
// ships a global WebSocket, so the whole driver is ~150 lines.
//
// Two details that are load-bearing rather than cosmetic:
//
//   * the profile directory is UNIQUE per run. A reused profile serves cached
//     bundles, and then every assertion describes the previous build.
//   * `Network.setCacheDisabled` is switched on before the first navigation.
//     Python's http.server only sends Last-Modified, so a browser will happily
//     re-use a stale JS file and an E2E that "passes" is testing old code.

import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const EDGE_CANDIDATES = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];

function findEdge() {
  if (process.env.EDGE_BIN) return process.env.EDGE_BIN;
  const hit = EDGE_CANDIDATES.find((p) => fs.existsSync(p));
  if (!hit) throw new Error("Microsoft Edge not found; set EDGE_BIN");
  return hit;
}

export class Session {
  constructor({ port = Number(process.env.CDP_PORT || 9333), profile } = {}) {
    this.port = port;
    // Unique per run — never deleted, never reused, so nothing can be stale.
    this.profile = profile || path.join(os.tmpdir(), `gorgon-edge-${process.pid}-${Date.now()}`);
    this.id = 0;
    this.pending = new Map();
    this.console = [];
    this.errors = [];
    this.proc = null;
    this.ws = null;
  }

  async launch({ width = 1400, height = 920 } = {}) {
    this.proc = spawn(
      findEdge(),
      [
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        `--remote-debugging-port=${this.port}`,
        `--user-data-dir=${this.profile}`,
        // The host proxies everything; localhost must bypass it or every
        // request to our own server 502s.
        "--proxy-bypass-list=127.0.0.1;localhost",
        `--window-size=${width},${height}`,
        "about:blank",
      ],
      { stdio: "ignore" }
    );

    let version = null;
    for (let i = 0; i < 100; i++) {
      try {
        const r = await fetch(`http://127.0.0.1:${this.port}/json/version`);
        if (r.ok) { version = await r.json(); break; }
      } catch { /* not up yet */ }
      await sleep(250);
    }
    if (!version) throw new Error("Edge devtools endpoint never became ready");
    return version;
  }

  async connect() {
    const list = await (await fetch(`http://127.0.0.1:${this.port}/json`)).json();
    const page = list.find((t) => t.type === "page");
    if (!page) throw new Error("no page target");
    this.ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      this.ws.addEventListener("open", res, { once: true });
      this.ws.addEventListener("error", rej, { once: true });
    });

    this.ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { res, rej } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) rej(new Error(JSON.stringify(msg.error)));
        else res(msg.result);
        return;
      }
      if (msg.method === "Runtime.consoleAPICalled") {
        const text = (msg.params.args || [])
          .map((a) => (a.value !== undefined ? a.value : a.description || a.type))
          .join(" ");
        this.console.push({ level: msg.params.type, text });
        if (msg.params.type === "error") this.errors.push(text);
      }
      if (msg.method === "Runtime.exceptionThrown") {
        const d = msg.params.exceptionDetails;
        const text = d.exception?.description || d.text || "exception";
        this.console.push({ level: "exception", text });
        this.errors.push(text);
      }
      if (msg.method === "Log.entryAdded") {
        const e = msg.params.entry;
        this.console.push({ level: e.level, text: e.text });
        if (e.level === "error") this.errors.push(e.text);
      }
    });

    await this.send("Runtime.enable");
    await this.send("Log.enable");
    await this.send("Page.enable");
    // Before any navigation: a cached bundle makes the whole run a lie.
    await this.send("Network.enable");
    await this.send("Network.setCacheDisabled", { cacheDisabled: true });
  }

  send(method, params = {}, timeout = 120000) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          rej(new Error("timeout: " + method));
        }
      }, timeout);
    });
  }

  async goto(url) {
    const loaded = new Promise((res) => {
      const h = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.method === "Page.loadEventFired") {
          this.ws.removeEventListener("message", h);
          res();
        }
      };
      this.ws.addEventListener("message", h);
    });
    await this.send("Page.navigate", { url });
    await Promise.race([loaded, sleep(20000)]);
  }

  /** Evaluate an async body in the page and return its value. */
  async eval(body) {
    const r = await this.send("Runtime.evaluate", {
      expression: `(async () => { ${body} })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails) {
      throw new Error("eval threw: " +
        (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    }
    return r.result.value;
  }

  async waitFor(expression, { timeout = 20000, interval = 250 } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      try {
        if (await this.eval(`return (${expression});`)) return true;
      } catch { /* keep polling */ }
      await sleep(interval);
    }
    return false;
  }

  async text() {
    return this.eval("return document.body.innerText;");
  }

  async click(expression) {
    return this.eval(`
      const el = ${expression};
      if (!el) return false;
      el.click(); return true;
    `);
  }

  async shot(file) {
    const r = await this.send("Page.captureScreenshot", { format: "png" });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(r.data, "base64"));
    return file;
  }

  async close() {
    try { this.ws && this.ws.close(); } catch { /* already gone */ }
    if (this.proc?.pid) {
      try { spawn("taskkill", ["/PID", String(this.proc.pid), "/T", "/F"], { stdio: "ignore" }); }
      catch { /* best effort */ }
    }
  }
}
