# CURRENT_STATE.md — Gorgon 当前状态快照

> 更新于 2026-10-07。只记录**已验证事实**；任何与此处不一致的说法以本文件与代码为准。
> 下一个 Agent 接手时先读本文件，再读 `AGENTS.md` 与 `docs/ROADMAP.md`。

```yaml
BRANCH: feature/v1-frontend-build
HEAD_COMMIT: <见本文件末尾「提交」节，Phase 1 收尾已提交>
PHASE: Phase 1 — Frontend Engineering · DONE（验收通过）
```

## 能力状态

| 模块 | 状态 | 说明 |
|---|---|---|
| Frontend (legacy) | DONE | `ui_kits/app/` 六个界面，Babel 运行时，稳定，保留为 reference |
| Frontend (V1 `app/`) | DONE | 六屏 + AppShell + atoms + DistrictPicker 迁移为 ES 模块；`vite build` 通过；单测/E2E/文档齐全 |
| Backend (API server) | DONE | `pipeline/api/server.py`：静态白名单 + `POST /api/search`，限流/校验/无 CORS |
| Database | NOT STARTED | 无数据库；活动数据为演示 JSON + 检索时抓取 |
| Real Search | DONE | 免密钥 provider 真实检索，缺失来源如实降级；通用网页搜索需 `SEARCH_API_KEY`（未配置则声明 `web_search_not_configured`） |
| Discover Feed | DONE | 演示数据集 + 分类/免费/区域筛选，计数实时一致 |
| Review | PARTIAL | review queue + 本地审核后台（localStorage）；单来源记录全进人工审核（设计如此），「通过」层长期近乎为空 |
| User Account | NOT STARTED | 无注册/登录/OAuth |
| Favorites | PARTIAL | localStorage 持久化 + 收藏页可移除；**详情页没有「添加收藏」按钮（既有缺口，见 `docs/V1_FRONTEND_KNOWN_ISSUES.md` KI-1）** |
| My Weekend | DONE | 快照持久化、刷新不丢、周六/周日时间线、时间冲突标记 |
| Routing | NOT STARTED | 只有 `MockRouteProvider`；UI 明示「交通时间尚未计算」 |
| Planning | NOT STARTED | 只有 `planning/models.py` 契约，无求解器 |
| Desktop App | NOT STARTED | 无 Tauri/Electron |
| Deployment | DONE | 公网只读部署：<https://shanghai-activity-search.app.workbuddy.host/>（托管平台，见 `docs/PUBLIC_DEPLOYMENT.md`） |
| Tests | DONE | 新前端：纯函数 27 + 构建冒烟 18 + 浏览器 E2E 58 全绿（2026-10-07）；管线 Python 268 / JS view-model 125 / JS district 131（2026-10-02 基线） |

## 本轮（Phase 1）已完成

- `feature/v1-frontend-build` 分支，`master` 未动（master HEAD = `631cb7f`）。
- `app/`：Vite 5 + React 18.3.1（生产版）+ lucide-react；`npm install` 与 `vite build` 通过，`dist/` 可生成（JS ~329 kB / gzip ~96 kB）。
- 六屏 + AppShell + atoms + DistrictPicker 全部迁移为 ES 模块；`window.React` / Babel Standalone / `window.lucide` / `_ds_bundle.js` 在新前端中已不存在。
- 统一 API 层 `app/src/lib/api.js`；dev/preview 经 Vite 代理 `/api → 127.0.0.1:8000`（API 服务端按设计不发 CORS 头）；`VITE_API_BASE_URL` 预留给跨域生产/Tauri 构建。
- 设计系统组件源（`components/core/`）原样直接 import；`SearchField`/`ActivityCard` 因含 `<i data-lucide>` 各 vendor 了一份仅换图标的副本（`app/src/components/ds/`，原因写在文件头）。
- 占位图复制到 `app/public/assets/placeholders/`，dist 自包含。
- **测试收尾：** `app/tests/` 纯函数单测 27（district / activity-view / store，与 Python 共享语料对齐）；构建冒烟 `build-smoke.mjs` 18；浏览器 E2E `e2e_v1_frontend.mjs` 58（Edge CDP，四档 viewport 390/768/1440/1920 + console errors=0），全部 PASS。
- **文档：** `docs/V1_FRONTEND_BUILD.md`（工程化说明、环境变量、目录、迁移对照、Tauri 接入）、`docs/V1_FRONTEND_KNOWN_ISSUES.md`（5 条与迁移无关的既有问题）。
- **验收：** FRONTEND_V1_PHASE1 验收清单逐项 PASS（见下「Phase 1 验收」）。

## 未完成（Phase 1 收尾项）

无。Phase 1 全部收尾完成并通过验收。

## 验收结果（FRONTEND_V1_PHASE1，2026-10-07）

| # | 验收项 | 结果 |
|---|---|---|
| 1 | `npm install` / `npm run dev` / `npm run build` / `npm run preview` 可用，生成 `dist/` | PASS |
| 2 | 从 React dev build + Babel 浏览器运行时迁移为 React + Vite 生产构建 | PASS |
| 3 | 新代码只在 `feature/v1-frontend-build`，`master` 未动 | PASS |
| 4 | 统一 API 配置层 `app/src/lib/api.js`，所有请求经该模块，无 key 入 bundle | PASS（构建冒烟验证） |
| 5 | React 生产版 + lucide-react npm 包，无 babel.min.js / react.development.js | PASS（构建冒烟验证） |
| 6 | UI / 交互 / 布局 / 响应式 / 数据结构 / 搜索体验 / district filter / localStorage / My Weekend / Detail / Discover / Map / Natural Search 保持 | PASS |
| 7 | 复用 tokens/ / styles.css / responsive.css，四档 viewport 渲染无崩 | PASS（E2E 四档） |
| 8 | legacy `ui_kits/app/` 保留为 reference，不清理 | PASS |
| 9 | 18 条功能链路全绿（Discover / district / Search / Natural Search + POST /api/search / Detail / My Weekend / 刷新持久化 / 收藏 / Map / 移动 bottom nav / 桌面 sidebar+header / console 0 错误） | PASS（E2E 58 项） |
| 10 | 迁移关键纯函数测试 + build smoke + dist 可经 HTTP 打开 + 浏览器 smoke | PASS（27+18+58） |
| 11 | 安全：build 无 SEARCH_API_KEY / 无真实 Secret / 不暴露 debug / API URL 可配置 | PASS（构建冒烟验证） |
| 12 | 文档：`V1_FRONTEND_BUILD.md` + `V1_FRONTEND_KNOWN_ISSUES.md` | PASS |

## 当前问题（已确认）

- 收藏功能：详情页无添加收藏入口，只能从收藏页移除 —— legacy 既有缺口（KI-1），与本次迁移无关，待产品决策。
- 新前端 dev 下跨域直连 API 会被浏览器拦（服务端无 CORS 头）——已通过 Vite 代理规避；Tauri 阶段需在服务端按来源放开。

## 技术债

- `_ds_bundle.js` 为重建版（原版不可考），legacy 前端仍依赖 Babel Standalone 运行时；legacy 退役前不动。
- `app/src/components/ds/` 两份 vendored 副本（SearchField / ActivityCard）在 legacy 退役后消失。
- 桌面详情页描述在 header 与「活动介绍」重复渲染（KI-2 / PHASE 5 已知限制 #6）。
- 疑似重复记录借用「存在冲突」状态展示（KI-3 / PHASE 5 已知限制 #5）。
- 字体仍走 Google Fonts CDN（取不到退化为系统字体，有意取舍）。

## 明确未开始

数据库（PostgreSQL/SQLite）、用户账号/登录/OAuth/微信登录、支付、Tauri/Electron、真实地图 API、itinerary solver、搜索排名重写、trust/dedupe 核心规则变更、大规模视觉改版。

## 下一任务

Phase 1 已收尾并通过验收。**不 merge `master`、不开始 Phase 2**。下一阶段建议方向：
Real Activity Store / SQLite（`docs/ROADMAP.md` Phase 2，**未获指令前不开始**）。

## 给下一个 Agent 的注意事项

1. 先跑基线再改：新前端 `cd app && npm test`（27）/ `npm run test:build`（18）/ `npm run test:e2e`（58）；管线 Python 268 / JS 125+131。
2. `master` 不可直接修改；Phase 1 代码只进 `feature/v1-frontend-build`。
3. 新前端的 API 调用只走 `app/src/lib/api.js`；任何 key 不得进前端 bundle。
4. `pipeline/` 的 trust/dedupe/review/normalize/ranker 核心算法未经明确授权禁止修改。
5. 跑 Python 测试会改动 `pipeline/data/*` 产物文件，属测试副作用，提交前用 `git checkout -- pipeline/data/` 还原。
6. 本机 npm 用系统 Node（`D:/npm.cmd`）；managed Node 22 在 esbuild postinstall 上有 EBUSY 问题。
7. E2E 依赖本机 Microsoft Edge（CDP）；沙箱存在 HTTP 代理，E2E 已剥离 `HTTP_PROXY/HTTPS_PROXY` 并显式绑定 `--host 127.0.0.1`，且 Edge 加 `--proxy-bypass-list=127.0.0.1;localhost`。

## 提交

- `test(frontend): add production build smoke + browser E2E` —— `app/tests/` 全部测试与 `.gitignore`、`.e2e-logs/` 忽略。
- `docs(frontend): document v1 frontend workflow + known issues` —— `docs/V1_FRONTEND_BUILD.md`、`docs/V1_FRONTEND_KNOWN_ISSUES.md`、更新 `docs/CURRENT_STATE.md`。
- **未 merge `master`、未开始 Phase 2。**
