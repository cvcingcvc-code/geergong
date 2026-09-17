// Gorgon Demo MVP — Demo Reset control.
//
// Only visible when the page is opened with `?demo=1`. It is intentionally a very
// low-key fixed chip in a corner so it never disturbs the product visuals.
// Clicking it clears the demo localStorage keys and reloads to a clean state.

(function () {
  if (!/[?&]demo=1\b/.test(location.search)) return;

  function mount() {
    var btn = document.createElement("button");
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
      "transition:opacity .2s ease"
    ].join(";");
    btn.addEventListener("mouseenter", function () { btn.style.opacity = "1"; });
    btn.addEventListener("mouseleave", function () { btn.style.opacity = ".55"; });
    btn.addEventListener("click", function () {
      if (window.GorgonStore) window.GorgonStore.reset();
      else {
        try {
          localStorage.removeItem("gorgon_my_weekend");
          localStorage.removeItem("gorgon_favorites");
          localStorage.removeItem("gorgon_admin_review");
          localStorage.removeItem("gorgon_demo_v1");
          localStorage.removeItem("gorgon_selected_district");
        } catch (e) {}
      }
      location.reload();
    });
    document.body.appendChild(btn);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
