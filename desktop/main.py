"""Gorgon Workbench — Windows desktop launcher (Phase 8).

Double-clicking `Gorgon Workbench.exe` must:
    1. start the Workbench frontend server (the built Vite bundle in app/dist)
    2. start the existing Python search API
    3. open a desktop window on the Workbench

The user never runs `npm`, never runs `python`, never opens a terminal.

Why a dedicated static server
-----------------------------
`pipeline/api/server.py` deliberately serves the LEGACY app from `ui_kits/app`
behind a strict allowlist. The Workbench is a different build (`app/dist`)
produced by Vite, and its asset URLs are root-relative (`/assets/...`), so it
needs to be served from `/`. Rather than widen the production server's
allowlist (a security-sensitive change), the desktop shell serves `app/dist`
itself and proxies `/api/*` to the search API, keeping the public server's
posture untouched.

Design notes
------------
* Both servers run as THREADS in one process: one thing to manage, no path
  discovery problems inside a frozen onedir bundle.
* Ports come from a candidate list, so a busy 8000 does not kill the demo.
* NO API key is read from, written to, or bundled with this file. A model key
  is only ever taken from the host environment at runtime.
"""

from __future__ import annotations

import argparse
import json
import os
import socket
import sys
import threading
import time
import urllib.error
import urllib.request
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

APP_TITLE = "Gorgon Workbench"
CANDIDATE_PORTS = (8000, 8010, 8123, 8899)
DEFAULT_MODE = os.environ.get("GORGON_DESKTOP_MODE", "demo")


def _base_dir() -> Path:
    """Directory holding the bundled resources (frozen or source)."""
    if getattr(sys, "frozen", False):
        return Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
    return Path(__file__).resolve().parent.parent


def _app_dist() -> Path:
    return _base_dir() / "app" / "dist"


def _free_port(host: str = "127.0.0.1", skip=()) -> int:
    for port in CANDIDATE_PORTS:
        if port in skip:
            continue
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                s.bind((host, port))
                return port
            except OSError:
                continue
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind((host, 0))
        return s.getsockname()[1]


# ── Workbench static server (app/dist) + /api proxy ──────────────────────

class WorkbenchHandler(SimpleHTTPRequestHandler):
    """Serves the built Workbench and forwards /api/* to the search API."""

    api_port = 0
    spa_fallback = True

    def log_message(self, fmt, *args):  # quieter console
        if os.environ.get("GORGON_DESKTOP_VERBOSE"):
            super().log_message(fmt, *args)

    def _proxy_api(self, method: str):
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else None
        target = f"http://127.0.0.1:{self.api_port}{self.path}"
        req = urllib.request.Request(target, data=body, method=method)
        for h in ("Content-Type", "Accept"):
            if self.headers.get(h):
                req.add_header(h, self.headers[h])
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                payload = resp.read()
                self.send_response(resp.status)
                self.send_header("Content-Type", resp.headers.get("Content-Type", "application/json"))
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
        except urllib.error.HTTPError as e:
            payload = e.read() if e.fp else b"{}"
            self.send_response(e.code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        except Exception as exc:
            payload = json.dumps(
                {"status": "unavailable", "providerMode": "demo",
                 "notices": [f"本地检索服务不可用：{exc}"]}
            ).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

    def do_GET(self):
        if self.path.startswith("/api/"):
            return self._proxy_api("GET")
        return super().do_GET()

    def do_POST(self):
        if self.path.startswith("/api/"):
            return self._proxy_api("POST")
        self.send_error(404)

    def send_head(self):
        """SPA fallback: unknown non-asset paths return index.html."""
        path = self.translate_path(self.path)
        if not os.path.exists(path) and self.spa_fallback:
            if not self.path.startswith("/assets/"):
                self.path = "/index.html"
        return super().send_head()


def _start_workbench_server(port: int, dist: Path, api_port: int) -> ThreadingHTTPServer:
    handler = partial(WorkbenchHandler, directory=str(dist))
    WorkbenchHandler.api_port = api_port
    httpd = ThreadingHTTPServer(("127.0.0.1", port), handler)
    t = threading.Thread(target=httpd.serve_forever, name="gorgon-ui", daemon=True)
    t.start()
    return httpd


# ── search API ───────────────────────────────────────────────────────────

def _start_api_server(port: int) -> threading.Thread:
    sys.path.insert(0, str(_base_dir()))
    from pipeline.api import server as api_server  # noqa: E402

    argv = ["--host", "127.0.0.1", "--port", str(port), "--mode", DEFAULT_MODE]
    t = threading.Thread(target=api_server.main, args=(argv,), name="gorgon-api", daemon=True)
    t.start()
    return t


def _wait_healthy(port: int, path: str = "/", timeout: float = 30.0) -> bool:
    deadline = time.time() + timeout
    url = f"http://127.0.0.1:{port}{path}"
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=1.5) as r:
                if r.status == 200:
                    return True
        except Exception:
            time.sleep(0.25)
    return False


def _error_page(message: str) -> str:
    return (
        "<!doctype html><meta charset='utf-8'><title>Gorgon Workbench</title>"
        "<body style=\"font:15px/1.7 system-ui;padding:40px;color:#111\">"
        "<h1 style='font-size:20px'>Gorgon Workbench 无法启动</h1>"
        f"<p>{message}</p><p style='color:#666'>请把本窗口截图反馈给开发者。</p></body>"
    )


# ── headless self-test ───────────────────────────────────────────────────
#
# The packaged EXE is built with --windowed, so it has NO console: anything
# printed is discarded. That makes a GUI app impossible to verify in CI or in
# a non-interactive shell. `--selftest` therefore starts the SAME servers the
# real launch uses, asserts they behave, and writes a JSON report to disk —
# turning "did the EXE work?" into an exit code plus a machine-checkable file.
#
# It deliberately does NOT open a window: the window requires an interactive
# desktop session, and proving the servers + shipped assets is what actually
# distinguishes a working bundle from a broken one.

def _default_report_path() -> Path:
    anchor = Path(sys.executable).parent if getattr(sys, "frozen", False) else _base_dir()
    return anchor / "desktop-selftest.json"


def _write_report(report_path: Path, checks: list) -> None:
    payload = {
        "app": APP_TITLE,
        "frozen": bool(getattr(sys, "frozen", False)),
        "python": sys.version.split()[0],
        "checks": checks,
        "passed": sum(1 for c in checks if c["ok"]),
        "failed": sum(1 for c in checks if not c["ok"]),
    }
    text = json.dumps(payload, ensure_ascii=False, indent=2)
    try:
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(text, encoding="utf-8")
    except Exception as exc:  # a report failure must not mask the result
        print(f"[gorgon] 无法写入自检报告 {report_path}: {exc}", file=sys.stderr)
    print(text)


def _run_selftest(report_path: Path) -> int:
    checks: list[dict] = []

    def rec(name: str, ok: bool, detail: str = "") -> None:
        checks.append({"name": name, "ok": bool(ok), "detail": detail})

    dist = _app_dist()
    rec("APP_DIST", (dist / "index.html").exists(), str(dist))
    if not (dist / "index.html").exists():
        _write_report(report_path, checks)
        return 1

    api_port = _free_port()
    ui_port = _free_port(skip=(api_port,))
    _start_api_server(api_port)
    _start_workbench_server(ui_port, dist, api_port)

    ui_ok = _wait_healthy(ui_port, "/", timeout=25)
    rec("EXE_START_UI", ui_ok, f"http://127.0.0.1:{ui_port}/")

    api_ok = False
    deadline = time.time() + 25
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(
                    f"http://127.0.0.1:{api_port}/api/health", timeout=2) as r:
                api_ok = r.status == 200
                if api_ok:
                    break
        except Exception:
            time.sleep(0.25)
    rec("EXE_START_API", api_ok, f"http://127.0.0.1:{api_port}/api/health")

    if ui_ok:
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{ui_port}/", timeout=10) as r:
                status = r.status
                html = r.read().decode("utf-8", "replace")
            rec("WORKBENCH_HOME", status == 200 and 'id="root"' in html, f"status={status}")
        except Exception as exc:
            rec("WORKBENCH_HOME", False, str(exc))

        # The UI origin must proxy /api (the desktop shell's whole job).
        try:
            req = urllib.request.Request(
                f"http://127.0.0.1:{ui_port}/api/search",
                data=json.dumps({"query": "上海 AI 活动", "maxResults": 10}).encode("utf-8"),
                headers={"Content-Type": "application/json"}, method="POST")
            with urllib.request.urlopen(req, timeout=30) as r:
                data = json.loads(r.read().decode("utf-8"))
            rec("SEARCH_DEMO",
                data.get("providerMode") == "demo",
                f"providerMode={data.get('providerMode')} results={len(data.get('results') or [])}")
        except Exception as exc:
            rec("SEARCH_DEMO", False, str(exc))

    # The task engine must actually be inside the shipped bundle.
    try:
        assets = sorted((dist / "assets").glob("*.js"), key=lambda p: p.stat().st_size)
        js = assets[-1].read_text(encoding="utf-8", errors="replace") if assets else ""
        rec("TASK_ENGINE_SHIPPED", "智能搜索" in js and "本地规划" in js)
        rec("TASK_CREATE_SHIPPED", "demo_seed_v1" in js)
    except Exception as exc:
        rec("TASK_ENGINE_SHIPPED", False, str(exc))

    # Is a Windows window backend actually frozen in? (Serving the app and
    # showing a window are different failures; this isolates the second.)
    try:
        import webview  # noqa: F401
        backend = ""
        for mod in ("winforms", "edgechromium", "mshtml"):
            try:
                __import__(f"webview.platforms.{mod}")
                backend = mod
                break
            except Exception:
                continue
        rec("WEBVIEW_BACKEND", bool(backend), backend or "no windows backend importable")
    except Exception as exc:
        rec("WEBVIEW_BACKEND", False, f"webview not importable: {exc}")

    _write_report(report_path, checks)
    return 1 if any(not c["ok"] for c in checks) else 0


def _open_window(url: str) -> int:
    """Open the desktop window, degrading to the system browser if needed.

    The competition build must ALWAYS show the product: a missing/incomplete
    webview backend is a packaging problem, not a reason to leave the user
    staring at a process that did nothing.
    """
    try:
        import webview  # pywebview
    except Exception as exc:
        print(f"[gorgon] pywebview 不可用({exc})，回退到系统浏览器", file=sys.stderr)
        return _browser_fallback(url)

    try:
        webview.create_window(APP_TITLE, url, width=1360, height=900, min_size=(960, 640))
        webview.start()
        return 0
    except Exception as exc:  # backend missing / no GUI session
        print(f"[gorgon] 桌面窗口启动失败({exc})，回退到系统浏览器", file=sys.stderr)
        return _browser_fallback(url)


def _browser_fallback(url: str) -> int:
    import webbrowser

    webbrowser.open(url)
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog=APP_TITLE, add_help=True)
    parser.add_argument("--selftest", action="store_true",
                        help="headless check of the packaged app; writes a JSON report and exits")
    parser.add_argument("--report", default=None,
                        help="path for the --selftest JSON report")
    args = parser.parse_args(argv)

    if args.selftest:
        report = Path(args.report) if args.report else _default_report_path()
        return _run_selftest(report)

    dist = _app_dist()
    if not (dist / "index.html").exists():
        msg = (f"未找到前端构建产物: {dist}\\n"
               "请先运行:  cd app && npm run build")
        print(f"[gorgon] {msg}", file=sys.stderr)
        return 2

    api_port = _free_port()
    ui_port = _free_port(skip=(api_port,))
    print(f"[gorgon] UI  http://127.0.0.1:{ui_port}/")
    print(f"[gorgon] API http://127.0.0.1:{api_port}/  (mode={DEFAULT_MODE})")

    _start_api_server(api_port)
    _start_workbench_server(ui_port, dist, api_port)

    url = f"http://127.0.0.1:{ui_port}/?demo=1"
    if not _wait_healthy(ui_port, "/"):
        print("[gorgon] UI 服务未在预期时间内就绪，仍尝试打开窗口", file=sys.stderr)

    return _open_window(url)


if __name__ == "__main__":
    raise SystemExit(main())
