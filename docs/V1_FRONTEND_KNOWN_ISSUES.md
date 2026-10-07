# V1_FRONTEND_KNOWN_ISSUES.md — 前端已知问题（与迁移无关）

> 本文件只记录**与 Phase 1 迁移无关**的既有缺陷或取舍。迁移引入的问题（若有）走正常修复流程，
> 不记在这里。
> 最近更新：2026-10-07。

判定标准：**该问题在 legacy（`ui_kits/app/`）中已存在，本次 React+Vite 迁移没有改变其行为**。

---

## KI-1 详情页没有「添加收藏」入口

- **现象：** 活动详情页只有「加入我的周末」按钮，没有把活动加入「收藏」的入口；
  收藏只能在「我的周末 → 收藏」标签里**移除**，无法从此处新增。
- **位置：** `app/src/screens/ActivityDetailScreen.jsx`（`.gg-detail-bar-actions` 仅含 TrustChip + 加入周末按钮）。
- **影响：** 收藏功能可用但不对称（可删不可加）。
- **来源：** legacy 既有缺口，与迁移无关。
- **处置：** 待产品决策是否要在详情页加收藏按钮；优先级低。

---

## KI-2 桌面详情页描述重复渲染

- **现象：** 桌面详情页的活动描述在 header 区与下方「活动介绍」区各渲染一次，用户看到两遍。
- **来源：** `docs/PHASE5_FINAL_REPORT.md` 已知限制 #6，legacy 既有。
- **处置：** 视觉/信息架构优化，Phase 1 不改。

---

## KI-3 疑似重复记录借用「存在冲突」状态展示

- **现象：** 疑似重复（near-duplicate）的活动在 UI 上借用了「存在冲突 / 状态异常」的红色样式展示，
  语义上不完全准确。
- **来源：** `docs/PHASE5_FINAL_REPORT.md` 已知限制 #5，legacy 既有。
- **处置：** 需要 dedup 与 UI 状态语汇对齐，属核心算法/展示协同问题，Phase 1 不动核心算法。

---

## KI-4 字体走 Google Fonts CDN

- **现象：** 设计系统字体经 `tokens/fonts.css` 的 Google Fonts CDN 加载；离线 / 沙箱无外网时
  退化为系统字体，视觉与线上略有差异。
- **来源：** legacy 既有取舍。
- **处置：** 有意取舍（避免把字体打进 bundle）；若需离线一致，可将字体自托管到 `app/public/` 并改 `@font-face`。
- **备注：** 浏览器 E2E 在沙箱无外网下运行，`fonts.googleapis/gstatic` 的加载失败被 E2E 噪声过滤，
  不计入 console errors。

---

## KI-5 Natural Search 在 API 不在时降级到 demo 数据

- **现象：** 未连接检索 API（`/api/search` 不可达）时，Natural Search 回退到内置录屏的
  `GORGON_SEARCH_DEMO` 数据，并明确标注「DEMO DATA」徽标。
- **来源：** 设计如此（诚实降级），非缺陷。
- **处置：** 联调时按 `docs/V1_FRONTEND_BUILD.md` §2 启动 `pipeline/api/server.py` 即可走真实检索。

---

## 不在本文件范围

以下**不属于已知问题**，是 Phase 1 刻意未做（受任务范围约束），请勿当作缺陷：

- 不接数据库（PostgreSQL/SQLite）—— 活动数据仍为演示 JSON。
- 不做账号/登录/OAuth/微信登录、支付、Tauri/Electron、真实地图 API、itinerary solver、搜索排名重写。
- 不修改 trust / dedupe / review / normalize / ranker 核心算法。
- 不大规模改视觉设计、不删除 Demo 模式。
- 不清理 legacy `ui_kits/app/`（保留为 reference）。
