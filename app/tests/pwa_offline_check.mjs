// Offline smoke test: prove the PWA shell still loads with no network.
// 1) load online so the SW caches the app shell + assets
// 2) go offline (Network.emulateNetworkConditions)
// 3) reload -> the SW's navigation fallback should serve the cached shell
import { Session } from "../../pipeline/tests/cdp_session.mjs";

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:4180";
const URL = BASE_URL.endsWith("/") ? BASE_URL : BASE_URL + "/";
const s = new Session({ port: Number(process.env.CDP_PORT || 9342) });
let ok = false;
try {
  await s.launch({ width: 412, height: 900 });
  await s.connect();
  await s.goto(URL);
  await new Promise((r) => setTimeout(r, 2500)); // let SW cache shell+assets

  // Go fully offline.
  await s.send("Network.enable");
  await s.send("Network.emulateNetworkConditions", {
    offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0,
  });

  // Reload — navigation is intercepted by the SW fallback.
  await s.send("Page.reload", {});
  await new Promise((r) => setTimeout(r, 2500));

  const out = await s.eval(`
    return {
      title: document.title,
      hasRoot: !!document.getElementById("root"),
      rootChildren: document.getElementById("root")?.childElementCount || 0,
      swControlled: !!navigator.serviceWorker.controller,
    };
  `);
  console.log("Offline reload result:", JSON.stringify(out, null, 2));
  ok = out.swControlled && out.hasRoot && out.title.includes("Gorgon");
  console.log(ok ? "OFFLINE SHELL LOADS ✓" : "OFFLINE SHELL FAILED ✗");
} catch (e) {
  console.error("offline check error:", e.message || e);
} finally {
  try { await s.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }); } catch {}
  await s.close();
}
process.exit(ok ? 0 : 1);
