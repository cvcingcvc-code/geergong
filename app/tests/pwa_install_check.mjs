// PWA installability check for Gorgon (mobile).
//
// Loads the production preview in headless Edge and verifies the three
// hard requirements for "Add to Home Screen" / "Install app":
//   1. a valid web manifest (name, short_name, start_url, display, >=192px icon)
//   2. a registered, *active* service worker with a fetch handler (offline)
//   3. the install metadata is wired into <head> (theme-color, apple-touch-icon)
//
// Usage:
//   vite preview --host 127.0.0.1 --port 4180   # in another shell
//   node app/tests/pwa_install_check.mjs         # BASE_URL=http://127.0.0.1:4180
//
// Exit code 0 = installable, 1 = not.
import { Session } from "../../pipeline/tests/cdp_session.mjs";

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:4180";
const URL = BASE_URL.endsWith("/") ? BASE_URL : BASE_URL + "/";

const s = new Session({ port: Number(process.env.CDP_PORT || 9341) });
let ok = true;
function check(label, cond, detail) {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) ok = false;
  console.log(`  ${mark}  ${label}${detail ? " — " + detail : ""}`);
}

try {
  await s.launch({ width: 412, height: 900 }); // phone-ish viewport
  await s.connect();
  await s.goto(URL);
  // Give the SW time to install + activate + claim this client.
  await new Promise((r) => setTimeout(r, 2500));

  const out = await s.eval(`
    const o = {};
    const m = document.querySelector('link[rel="manifest"]');
    o.manifestHref = m ? m.href : null;
    o.hasThemeColor = !!document.querySelector('meta[name="theme-color"]');
    o.hasAppleTouch = !!document.querySelector('link[rel="apple-touch-icon"]');
    o.hasMobileCapable = !!document.querySelector('meta[name="mobile-web-app-capable"]');
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      o.swScope = reg ? reg.scope : null;
      o.swState = reg && reg.active ? reg.active.state
        : reg ? (reg.installing ? "installing" : reg.waiting ? "waiting" : "registered-no-active") : "none";
      o.swController = !!navigator.serviceWorker.controller;
    } catch (e) { o.swError = String(e); }
    try {
      const man = await (await fetch('/manifest.webmanifest')).json();
      o.manifest = {
        name: !!man.name, short_name: !!man.short_name,
        start_url: man.start_url || null, display: man.display || null,
        icons: (man.icons || []).map(i => i.sizes),
        maskable: (man.icons || []).some(i => (i.purpose || "").includes("maskable")),
        theme: man.theme_color || null, bg: man.background_color || null,
      };
      o.installable = !!(man.name && man.short_name && man.start_url && man.display
        && (man.icons || []).some((i) => {
          const w = parseInt(String(i.sizes).split("x")[0], 10);
          return w >= 192;
        }));
    } catch (e) { o.manifestError = String(e); }
    return o;
  `);

  console.log("PWA installability report @", URL);
  console.log(JSON.stringify(out, null, 2));
  console.log("");

  check("manifest linked in <head>", !!out.manifestHref, out.manifestHref || undefined);
  check("theme-color meta present", out.hasThemeColor);
  check("apple-touch-icon present (iOS)", out.hasAppleTouch);
  check("mobile-web-app-capable meta", out.hasMobileCapable);
  check("manifest parses & has name", out.manifest && out.manifest.name);
  check("manifest has short_name", out.manifest && out.manifest.short_name);
  check("manifest has start_url", out.manifest && !!out.manifest.start_url, out.manifest && out.manifest.start_url);
  check("manifest display=standalone", out.manifest && out.manifest.display === "standalone", out.manifest && out.manifest.display);
  check("manifest has >=192px icon", out.manifest && out.manifest.icons.some((x) => /192|256|512/.test(x)),
    out.manifest && out.manifest.icons.join(", "));
  check("manifest has maskable icon", out.manifest && out.manifest.maskable);
  check("service worker registered", !!out.swScope, out.swScope || out.swError || undefined);
  check("service worker active (offline-ready)", out.swState === "activated", out.swState);
  check("installable criteria met", out.installable !== false);

  console.log("");
  console.log(ok ? "RESULT: INSTALLABLE ✓" : "RESULT: NOT INSTALLABLE ✗");
} catch (e) {
  console.error("PWA check error:", e.message || e);
  ok = false;
} finally {
  await s.close();
}
process.exit(ok ? 0 : 1);
