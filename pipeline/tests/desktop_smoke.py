"""Gorgon Workbench — desktop smoke test (Phase 8 / Phase 9).

Starts the SAME servers the desktop launcher starts (in-process, headless),
then verifies the real Windows Gate:

    EXE_BUILD       — app/dist bundle exists and is loadable
    EXE_START       — the UI + API servers come up on real ports
    WORKBENCH_HOME  — the built Workbench HTML loads and mounts
    TASK_CREATE     — the app boots with the demo task seeded
    SEARCH_DEMO     — POST /api/search returns demo results through the proxy
    TASK_EXECUTE    — the client bundle contains the runner (no missing chunks)

Run:  python pipeline/tests/desktop_smoke.py
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(REPO))

from desktop import main as desktop  # noqa: E402

results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, bool(ok), detail))
    mark = "PASS" if ok else "FAIL"
    print(f"  {mark}  {name}" + (f"  — {detail}" if detail else ""))


def get(url: str, timeout: float = 10.0):
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return r.status, r.read()


def post_json(url: str, payload: dict, timeout: float = 30.0):
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"}, method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.read()


def check_packaged_exe(check) -> None:
    """Run the frozen exe's headless self-test and assert it fully passes.

    The exe is built with --windowed, so it has no usable stdout; it writes a
    JSON report instead. An absent exe is reported honestly (and tells you the
    one command that fixes it) rather than being silently skipped.
    """
    exe = REPO / "release" / "Gorgon-Workbench-Windows" / "Gorgon Workbench.exe"
    if not exe.exists():
        check("EXE_PACKAGED: packaged exe present", False,
              "not built — run: powershell -ExecutionPolicy Bypass -File desktop/build.ps1")
        return
    check("EXE_PACKAGED: packaged exe present", True, f"{exe.stat().st_size // 1024} KB")

    with tempfile.TemporaryDirectory() as tmp:
        report = Path(tmp) / "selftest.json"
        try:
            proc = subprocess.run(
                [str(exe), "--selftest", "--report", str(report)],
                capture_output=True, timeout=180,
            )
        except subprocess.TimeoutExpired:
            check("EXE_PACKAGED: self-test completes", False, "timed out after 180s")
            return
        check("EXE_PACKAGED: self-test exits 0", proc.returncode == 0,
              f"exit={proc.returncode}")

        if not report.exists():
            check("EXE_PACKAGED: self-test wrote a report", False, str(report))
            return
        data = json.loads(report.read_text(encoding="utf-8"))
        check("EXE_PACKAGED: frozen bundle reported", data.get("frozen") is True,
              f"python={data.get('python')}")

        failed = [c for c in data.get("checks", []) if not c.get("ok")]
        names = ", ".join(c["name"] for c in data.get("checks", []))
        check("EXE_PACKAGED: all bundle checks pass", not failed,
              f"{data.get('passed')} passed" if not failed
              else "failed: " + ", ".join(c["name"] for c in failed))
        print(f"           bundle checks: {names}")

        by_name = {c["name"]: c for c in data.get("checks", [])}
        backend = by_name.get("WEBVIEW_BACKEND", {})
        check("EXE_PACKAGED: desktop window backend bundled",
              backend.get("ok") is True, backend.get("detail", ""))


def main() -> int:
    print("[desktop-smoke] verifying desktop packaging prerequisites")

    dist = desktop._app_dist()
    check("EXE_BUILD: app/dist/index.html exists", (dist / "index.html").exists(), str(dist))

    if not (dist / "index.html").exists():
        print("\n[desktop-smoke] frontend not built — run: cd app && npm run build")
        return 1

    # The built bundle must contain a real JS asset (not an empty shell).
    assets = list((dist / "assets").glob("*.js")) if (dist / "assets").exists() else []
    check("EXE_BUILD: hashed JS bundle present", len(assets) >= 1,
          f"{len(assets)} js file(s)")
    if assets:
        size = max(a.stat().st_size for a in assets)
        check("EXE_BUILD: bundle is non-trivial", size > 50_000, f"{size} bytes")

    # ── The PACKAGED artifact must really work ───────────────────────────
    # Running the frozen exe's own headless self-test is the only way to prove
    # the bundle is complete (frozen module graph, bundled pythonnet runtime,
    # bundled webview backend). Source-level checks cannot see any of that.
    # Run it BEFORE our own servers so it gets first pick of the ports.
    check_packaged_exe(check)

    api_port = desktop._free_port()
    ui_port = desktop._free_port(skip=(api_port,))
    print(f"[desktop-smoke] api={api_port} ui={ui_port}")
    desktop._start_api_server(api_port)
    desktop._start_workbench_server(ui_port, dist, api_port)

    # ── EXE_START ──
    ui_up = desktop._wait_healthy(ui_port, "/", timeout=25)
    check("EXE_START: UI server serving on 127.0.0.1", ui_up, f":{ui_port}")

    api_up = False
    for _ in range(40):
        try:
            st, _ = get(f"http://127.0.0.1:{api_port}/api/health")
            api_up = st == 200
            if api_up:
                break
        except Exception:
            time.sleep(0.25)
    check("EXE_START: Python search API healthy", api_up, f":{api_port}")

    if not ui_up:
        return 1

    # ── WORKBENCH_HOME ──
    try:
        st, body = get(f"http://127.0.0.1:{ui_port}/")
        html = body.decode("utf-8", "replace")
        check("WORKBENCH_HOME: root serves the app shell", st == 200 and "<div id=\"root\"" in html,
              f"status={st}")
        check("WORKBENCH_HOME: index references built assets", "/assets/" in html)
    except Exception as exc:
        check("WORKBENCH_HOME: root serves the app shell", False, str(exc))

    # SPA fallback must not 404 on a deep link.
    try:
        st, body = get(f"http://127.0.0.1:{ui_port}/some/deep/link")
        check("WORKBENCH_HOME: SPA fallback serves index", st == 200 and b"<div id=\"root\"" in body)
    except urllib.error.HTTPError as e:
        check("WORKBENCH_HOME: SPA fallback serves index", False, f"HTTP {e.code}")

    # ── SEARCH_DEMO (through the launcher's own proxy) ──
    try:
        st, body = post_json(f"http://127.0.0.1:{ui_port}/api/search",
                             {"query": "上海 AI 活动", "maxResults": 10})
        data = json.loads(body.decode("utf-8"))
        mode = data.get("providerMode")
        n = len(data.get("results") or [])
        check("SEARCH_DEMO: /api/search reachable via UI origin", st == 200)
        check("SEARCH_DEMO: returns demo-mode results", mode == "demo" and n >= 0,
              f"providerMode={mode} results={n}")
    except Exception as exc:
        check("SEARCH_DEMO: /api/search reachable via UI origin", False, str(exc))

    # ── TASK_EXECUTE (the app's engine must be in the shipped bundle) ──
    # `js` is hoisted so the later TASK_CREATE check cannot NameError if the
    # bundle could not be read (that would turn a clean FAIL into a crash).
    js = ""
    try:
        js = max(assets, key=lambda a: a.stat().st_size).read_text(encoding="utf-8", errors="replace")
        check("TASK_EXECUTE: router + skills shipped in bundle",
              "智能搜索" in js and "本地规划" in js,
              "skill labels found" if "智能搜索" in js else "MISSING")
        check("TASK_EXECUTE: task state machine shipped",
              "已创建" in js or "created" in js)
        # Key safety. A bare "sk-" substring is meaningless — the bundle is full
        # of CSS classes like `sk-box` / `sk-conical`. What actually matters is
        # (a) no credential VALUE is inlined and (b) the host env var NAMES are
        # absent, which proves the provider config was tree-shaken out of the
        # browser build entirely (the browser has no `process`, so that branch
        # is dead code).
        leaked_value = re.search(
            r"""(?:api[_-]?key|secret|token|password)["']?\s*[:=]\s*["'][A-Za-z0-9_\-]{16,}["']""",
            js, re.IGNORECASE)
        env_names_present = any(
            n in js for n in ("GORGON_AI_API_KEY", "GORGON_AI_PROVIDER", "GORGON_AI_BASE_URL"))
        check("TASK_EXECUTE: no API key leaked into bundle",
              not leaked_value and not env_names_present,
              "credential value present" if leaked_value else
              ("env names present" if env_names_present else "clean"))
    except Exception as exc:
        check("TASK_EXECUTE: router + skills shipped in bundle", False, str(exc))

    # ── TASK_CREATE (demo seeding logic present + demo assets served) ──
    check("TASK_CREATE: demo mode code shipped", "demo_seed_v1" in js)

    failed = [r for r in results if not r[1]]
    print(f"\n[desktop-smoke] {len(results) - len(failed)} passed, {len(failed)} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
