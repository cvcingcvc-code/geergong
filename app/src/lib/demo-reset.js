// Gorgon — Demo Reset control.
//
// Migrated from ui_kits/app/demo-reset.js. Only visible when the page is
// opened with `?demo=1`. It is intentionally a very low-key fixed chip in a
// corner so it never disturbs the product visuals. Clicking it clears the
// demo localStorage keys and reloads to a clean state.

import * as Store from "../store/store.js";

export function initDemoReset() {
  if (!/[?&]demo=1\b/.test(window.location.search)) return;

  const mount = () => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "重置 Demo";
    btn.title = "清除 My Weekend / 收藏 / 审核状态，回到干净的演示状态";
    btn.setAttribute("data-gorgon-demo-reset", "1");
    btn.style.cssText = [
      "position:fixed",
      "left:12px",
      "bottom:12px",
      "z-index:2147483647",
      "font:600 11.5px/1 'Inter',system-ui,sans-serif",
      "letter-spacing:.02em",
      "color:#fff",
      "background:rgba(12,13,18,.55)",
      "backdrop-filter:blur(6px)",
      "border:1px solid rgba(255,255,255,.18)",
      "border-radius:999px",
      "padding:7px 12px",
      "cursor:pointer",
      "opacity:.55",
      "transition:opacity .2s ease",
    ].join(";");
    btn.addEventListener("mouseenter", () => { btn.style.opacity = "1"; });
    btn.addEventListener("mouseleave", () => { btn.style.opacity = ".55"; });
    btn.addEventListener("click", () => {
      Store.reset();
      window.location.reload();
    });
    document.body.appendChild(btn);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
}
