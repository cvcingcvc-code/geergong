# CURRENT_STATE.md — Gorgon 当前状态快照

> 更新于 2026-10-02。只记录**已验证事实**；任何与此处不一致的说法以本文件与代码为准。
> 下一个 Agent 接手时先读本文件，再读 `AGENTS.md` 与 `docs/ROADMAP.md`。

```yaml
BRANCH: feature/v1-frontend-build
HEAD_COMMIT: 4d93569        # refactor(frontend): migrate existing screens（本文档随后单独提交）
PHASE: Phase 1 — Frontend Engineering · PARTIAL（进行中）
```

## 能力状态

| 模块 | 状态 | 说明 |
|---|---|---|
| Frontend (legacy) | DONE | `ui_kits/app/` 六个界面，Babel 运行时，稳定，保留为 reference |
| Frontend (V1 `app/`) | PARTIAL | 六屏已迁移为 ES 模块，`vite build` 通过；单测/E2E/文档收尾中 |
| Backend (API server) | DONE | `pipeline/api/server.py`：静态白名单 + `POST /api/search`，限流/校验/无 CORS |
| Database | NOT STARTED | 无数据库；活动数据为演示 JSON + 检索时抓取 |
| Real Search | DONE | 免密钥 provider 真实检索，缺失来源如实降级；通用网页搜索需 `SEARCH_API_KEY`（未配置则声明 `web_search_not_configured`） |
| Discover Feed | DONE | 演示数据集 + 分类/免费/区域筛选，计数实时一致 |
| Review | PARTIAL | review queue + 本地审核后台（localStorage）；单来源记录全进人工审核（设计如此），「通过」层长期近乎为空 |
| User Account | NOT STARTED | 无注册/登录/OAuth |
| Favorites | PARTIAL | localStorage 持久化 + 收藏页可移除；**详情页没有「添加收藏」按钮（既有缺口，见下）** |
| My Weekend | DONE | 快照持久化、刷新不丢、周六/周日时间线、时间冲突标记 |
| Routing | NOT STARTED | 只有 `MockRouteProvider`；UI 明示「交通时间尚未计算」 |
| Planning | NOT STARTED | 只有 `planning/models.py` 契约，无求解器 |
| Desktop App | NOT STARTED | 无 Tauri/Electron |
| Deployment | DONE | 公网只读部署：<https://shanghai-activity-search.app.workbuddy.host/>（托管平台，见 `docs/PUBLIC_DEPLOYMENT.md`） |
| Tests | DONE | Python 268 / JS view-model 125 / JS district 131 全绿（2026-10-02 基线）+ Edge CDP 浏览器 E2E |

## 本轮（Phase 1）已完成

- `feature/v1-frontend-build` 分支，`master` 未动（master HEAD = `631cb7f`）。
- `app/`：Vite 5 + React 18.3.1（生产版）+ lucide-react；`npm install` 与 `vite build` 通过，`dist/` 可生成（JS ~329 kB / gzip ~96 kB）。
- 六屏 + AppShell + atoms + DistrictPicker 全部迁移为 ES 模块；`window.React` / Babel Standalone / `window.lucide` / `_ds_bundle.js` 在新前端中已不存在。
- 统一 API 层 `app/src/lib/api.js`；dev/preview 经 Vite 代理 `/api → 127.0.0.1:8000`（API 服务端按设计不发 CORS 头）；`VITE_API_BASE_URL` 预留给跨域生产/Tauri 构建。
- 设计系统组件源（`components/core/`）原样直接 import；`SearchField`/`ActivityCard` 因含 `<i data-lucide>` 各 vendor 了一份仅换图标的副本（`app/src/components/ds/`，原因写在文件头）。
- 占位图复制到 `app/public/assets/placeholders/`，dist 自包含。

## 未完成（Phase 1 收尾项）

- `app/tests/` 单测补全（district 已写；activity-view / store 待写）与共享语料对齐验证
- 构建冒烟测试（`npm run test:build`）与浏览器 E2E（`npm run test:e2e`）
- 四档 viewport（390 / 768 / 1440 / 1920）与 console errors = 0 的最终核验
- `docs/V1_FRONTEND_BUILD.md`、`docs/V1_FRONTEND_KNOWN_ISSUES.md` 与 FRONTEND_V1_PHASE1 验收清单

## 当前问题（已确认）

- 收藏功能：详情页无添加收藏入口，只能从收藏页移除 —— legacy 既有缺口，与本次迁移无关，待产品决策。
- 新前端 dev 下跨域直连 API 会被浏览器拦（服务端无 CORS 头）——已通过 Vite 代理规避；Tauri 阶段需在服务端按来源放开。

## 技术债

- `_ds_bundle.js` 为重建版（原版不可考），legacy 前端仍依赖 Babel Standalone 运行时；legacy 退役前不动。
- 桌面详情页描述在 header 与「活动介绍」重复渲染（PHASE 5 已知限制 #6）。
- 疑似重复记录借用「存在冲突」状态展示（PHASE 5 已知限制 #5）。
- 字体仍走 Google Fonts CDN（取不到退化为系统字体，有意取舍）。

## 明确未开始

数据库（PostgreSQL/SQLite）、用户账号/登录/OAuth/微信登录、支付、Tauri/Electron、真实地图 API、itinerary solver、搜索排名重写、trust/dedupe 核心规则变更、大规模视觉改版。

## 下一任务

完成 Phase 1 收尾（测试 + 四档 viewport + console 0 错误 + 验收文档），输出 FRONTEND_V1_PHASE1 验收清单。Phase 2 建议方向：Real Activity Store / SQLite（**未获指令前不开始**）。

## 给下一个 Agent 的注意事项

1. 先跑基线再改：Python 268 / JS 125+131；`cd app && npm run build` 必须过。
2. `master` 不可直接修改；Phase 1 代码只进 `feature/v1-frontend-build`。
3. 新前端的 API 调用只走 `app/src/lib/api.js`；任何 key 不得进前端 bundle。
4. `pipeline/` 的 trust/dedupe/review/normalize/ranker 核心算法未经明确授权禁止修改。
5. 跑 Python 测试会改动 `pipeline/data/*` 产物文件，属测试副作用，提交前用 `git checkout -- pipeline/data/` 还原。
6. 本机 npm 用系统 Node（`D:/npm.cmd`）；managed Node 22 在 esbuild postinstall 上有 EBUSY 问题。
