# ROADMAP.md — Gorgon 从原型到 V1.0 桌面产品

> 只描述阶段划分与状态事实。各 Phase 的精确现状以 `docs/CURRENT_STATE.md` 为准。

## Phase 0 — Web Prototype · DONE

恢复的设计系统 + 可点击 Demo MVP：Discover / Search / 智能检索 / Activity Detail / My Weekend / Map 六个界面，数据管线（normalize → clean → dedupe → trust → review），真实网页检索（`POST /api/search`），公网只读部署。

证据：`docs/PHASE5_FINAL_REPORT.md`、`docs/DISTRICT_FILTER_REPORT.md`、`docs/PUBLIC_DEPLOYMENT.md`；线上 <https://shanghai-activity-search.app.workbuddy.host/>；268 Python + 256 JS 测试基线。

## Phase 1 — Frontend Engineering · PARTIAL（进行中）

把浏览器运行时（React development build + Babel Standalone + window 全局）迁移为 **React 18 + Vite 5 生产构建**，为数据库、用户系统与 Tauri 打前端地基。

范围：新 `app/` 目录（`npm install / dev / build / preview`，产物 `dist/`）；统一 API 配置层（`src/lib/api.js`）；UI / 交互 / 响应式 / 数据结构全部保持不变；legacy `ui_kits/app/` 保留。

分支：`feature/v1-frontend-build`。已完成：脚手架、六个屏幕迁移、`vite build` 通过。进行中：迁移单测、构建冒烟、浏览器 E2E、验收文档。见 `docs/CURRENT_STATE.md`。

## Phase 2 — Real Activity Store / SQLite · NOT STARTED

活动数据从「演示 JSON + 检索时抓取」迁移到真实存储（SQLite 起步）：schema、导入/更新路径、pipeline 写入、API 读取。前置：Phase 1 完成。禁止提前开始。

## Phase 3 — Real Data Sources · NOT STARTED

在真实存储之上扩充真实来源：更多活动平台、抓取调度、来源健康监控。依赖 Phase 2 的存储层。（注：检索链路本身在 Phase 0 已是 real；本阶段解决的是**持续、可累积**的真实数据。）

## Phase 4 — Routing Engine · NOT STARTED

真实路线能力替代 `MockRouteProvider`：路线 provider 接入、通勤时间计算、My Weekend 的交通感知冲突检测。坐标系差异（GCJ-02 / BD-09 / WGS-84）必须处理，见 `readme.md` §7。

## Phase 5 — Itinerary Solver · NOT STARTED

实现 `pipeline/planning/models.py` 已定义契约的求解器：时间窗、路线、偏好约束下的周末行程规划。依赖 Phase 4。

## Phase 6 — User Accounts · NOT STARTED

用户系统：注册/登录、会话、云端持久化 My Weekend 与收藏（替代 localStorage 单机状态）。涉及认证方案与数据模型决策，届时单独评审。禁止在 Phase 1–5 中提前掺入。

## Phase 7 — Desktop App · NOT STARTED

Tauri Windows 桌面软件 + 安装包 + 自动更新。直接消费 Phase 1 的 `app/dist/` 前端与 Phase 2+ 的后端能力；届时通过 `VITE_API_BASE_URL` 指向生产 HTTPS 服务（需要服务端按来源放开 CORS，属该阶段工作）。

---

规则：每个 Phase 在独立 `feature/*` 分支完成并验收后再进入下一个；不并行提前开发后续阶段。
