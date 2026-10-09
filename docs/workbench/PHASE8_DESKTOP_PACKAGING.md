# Phase 8 — Windows Desktop Packaging

> 目标：交出一个**双击就能跑**的 Windows 程序。
> 用户不需要 npm、不需要 python、不需要命令行 —— 双击 EXE，窗口打开，产品就在那里。

## 1. 交付形态

```text
release/Gorgon-Workbench-Windows/
  Gorgon Workbench.exe        # 启动器（含图标）
  _internal/                  # 冻结的 Python 运行时 + 前端 + 检索服务
    app/dist/                 # 已构建的 Workbench 前端（Vite 产物）
    pipeline/                 # 检索 API（纯标准库）
    webview/ pythonnet/ clr_loader/   # 桌面窗口后端
```

选择 **onedir** 而非 onefile：onefile 每次启动都要解压到临时目录，
在带 webview 的场景下更慢也更脆。比赛场景下**稳定 > 文件数**。

`release/` 与 `build/` 已加入 `.gitignore`：它们是**可复现的构建产物**
（`desktop/build.ps1` 随时重建），把一整个冻结运行时塞进 git 没有收益。

## 2. 启动时到底发生了什么

`desktop/main.py` 在一个进程里起两个**线程**：

| 线程 | 作用 |
| --- | --- |
| `gorgon-api` | 直接复用现有 `pipeline/api/server.py`（demo 模式） |
| `gorgon-ui` | 托管 `app/dist`，并把 `/api/*` 反向代理到上面的 API |

然后用 `pywebview` 打开 `http://127.0.0.1:<ui>/?demo=1`。

**为什么自己托管前端，而不让 `server.py` 直接服务 `app/dist`？**
`server.py` 出于安全考虑对静态暴露面有**严格白名单**（只服务 `ui_kits/app`）。
Workbench 是另一份 Vite 构建、且资源是根相对路径（`/assets/...`），
必须从 `/` 提供。与其放宽生产服务器的白名单（一个安全敏感的改动），
不如让桌面外壳自己托管并反代 —— 生产服务器的暴露姿态**一行未动**。

其它设计点：

- 端口从候选表 `(8000, 8010, 8123, 8899)` 里挑空闲的，
  8000 被占也不会让演示挂掉。
- **没有任何 Key** 被读取、写入或打包。模型 Key 只在运行时从宿主环境取。
- SPA 回退：未知的非 `/assets/` 路径返回 `index.html`。
- 若 webview 后端不可用或桌面会话缺失，**自动回退到系统浏览器** ——
  产品永远能打开，不会留下一个什么都没干的进程。

## 3. 可验证性：`--selftest`

EXE 用 `--windowed` 构建，**没有控制台**，print 全部丢弃 ——
这让「EXE 到底行不行」变得不可验证。因此启动器提供：

```bash
"Gorgon Workbench.exe" --selftest --report selftest.json
```

它启动与正常启动**完全相同**的两个服务，跑完断言，写一份 JSON 报告，
并用退出码表示成败。它**故意不开窗口**：开窗需要交互式桌面会话，
而「服务 + 已打包资源是否完整」才是区分「能用的包」和「坏包」的关键。

检查项（冻结环境实测 8/8）：

```text
APP_DIST            前端产物在冻结目录里
EXE_START_UI        UI 服务在真实端口上起来了
EXE_START_API       检索 API 健康
WORKBENCH_HOME      根路径返回应用外壳（含 #root）
SEARCH_DEMO         UI 源站能反代 /api/search 并拿到 demo 结果
TASK_ENGINE_SHIPPED 路由与技能标签真的在 JS bundle 里
TASK_CREATE_SHIPPED 演示种子逻辑真的在 bundle 里
WEBVIEW_BACKEND     Windows 窗口后端可导入（winforms）
```

## 4. 打包工具链（实测）

| 组件 | 版本 | 备注 |
| --- | --- | --- |
| Python | 3.14.2（系统） | PyInstaller 6.22.3 已支持 3.14 |
| PyInstaller | 6.22.3 | onedir |
| pywebview | 6.2.1 | |
| pythonnet | 3.2.1 | 提供 `cp314` wheel；`Python.Runtime.dll` 已随包 |
| Pillow | 12.2.0 | 仅用于生成图标 |

**环境陷阱（真实踩到）**：`python` 在 PATH 上指向的是**托管 3.13**
（没有 pyinstaller/pywebview）。因此 `build.ps1` 接受 `GORGON_PYTHON` 覆盖，
并会**主动校验**解释器里有这两个包，否则**直接报错退出**，
而不是产出一个坏包。

`pyinstaller-hooks-contrib` 自带 `hook-webview.py` / `hook-clr.py` / `hook-clr_loader.py`，
所以 pywebview + pythonnet 会被自动收集（平台子模块是动态导入，是常见坑，
这里由 hook + 实测报告 `WEBVIEW_BACKEND=winforms` 双重确认）。

## 5. 图标

`desktop/make_icon.py` 用 Pillow **几何绘制**品牌图标（7 种尺寸 16→256），
仓库里不存二进制设计稿，图标随时可复现。用色与产品品牌色一致
（`#5B47E0`，同 `manifest.webmanifest` 的 `theme_color`）。

## 6. 验收（实测，非推断）

```text
EXE_BUILD        PASS   Gorgon Workbench.exe 5.87 MB + _internal/
EXE_START        PASS   UI:8010 / API:8000 均起来
WORKBENCH_HOME   PASS   status=200，含 #root 与 /assets/
SEARCH_DEMO      PASS   providerMode=demo, results=10（经真实反代）
TASK_CREATE      PASS   demo_seed_v1 在 bundle 内
TASK_EXECUTE     PASS   智能搜索 / 本地规划 在 bundle 内
EXE_PACKAGED     8/8    冻结包自检全绿（frozen=true, python=3.14.2）
REAL_LAUNCH      PASS   直接启动 EXE：UI:8010 返回 200、反代 search=demo/5 条、
                        进程存活；且 msedge 增量为 0（= 走的是原生窗口，不是浏览器回退）
DESKTOP_SMOKE    19/19  pipeline/tests/desktop_smoke.py
```

`desktop_smoke.py` 现在**会真的去跑打包后的 EXE**（`--selftest`），
因为源码级检查看不见冻结模块图、pythonnet 运行时、webview 后端这三件事。

## 7. 明确不做

不做 Electron 重写、不做安装器、不做自动更新、不做代码签名。
比赛阶段这些是 P2；P0 是「双击能跑、窗口能开、链路能走完」——已达成。
