# Delivery State

> Gorgon Workbench — 连续交付主状态文件（每阶段覆盖更新）。
> 下一轮**只读这个文件**即可恢复上下文，不要重新扫描整个 repo。

```text
CURRENT_PHASE=PHASE 7 DONE (COMPETITION_DEMO_STABILIZATION) — GATE GREEN, 待 commit
CURRENT_HEAD=2f84e13 (PHASE 6)，7 号变更在工作区

LAST_COMPLETED=
  PHASE 0/1/2/3/3B/4A/4B/5/6  (Gate 全绿)
  PHASE 7 TASK-7.1 可复现离线演示种子 (?demo=1, 幂等, 精确比赛指令)
  PHASE 7 TASK-7.2 Task Detail「处理方式」面板 (本地处理 / AI Assisted / 模拟输出 / Token)
  PHASE 7 TASK-7.3 演示链路 E2E 7 条失败根因定位与修复（真实 bug）
  PHASE 7 TASK-7.4 全量回归 205 + 18 + 93 + 58 全绿, 0 回归

CURRENT_TASK=Phase 7 commit + 更新 DELIVERY_STATE
NEXT_TASK=PHASE 8 — Windows Desktop Packaging (PyInstaller onedir + pywebview)

TEST_STATUS=
  UNIT            = 205/205 PASS
  TEST_BUILD      = 18/18 PASS (含 secret 扫描)
  VITE_BUILD      = PASS (1737 modules, 420.30 kB / gzip 123.84 kB)
  WORKBENCH_E2E   = 93/93 PASS
  LEGACY_E2E      = 58/58 PASS
  DESKTOP_SMOKE   = 待跑 (需先 PyInstaller 打包)
  NEW_REGRESSIONS = 0
  API_KEYS_IN_REPO= 0

KNOWN_ISSUES=
  - npm run build 清理既有 app/dist/ 时被沙箱删除拦截 (ETIMEDOUT / genie-trash)，
    非代码缺陷：改用 `vite build --emptyOutDir=false` 即 PASS，产物一致。
    build.ps1 在 app/dist 已存在时直接复用，已规避。
  - 沙箱可能被外部进程占用 4173/4175/8000 端口，造成 E2E 假失败。
    跑 E2E 前先确认端口空闲（netstat -ano | grep LISTENING）。

BLOCKERS=none

DELIVERY_READINESS=NOT_READY  (缺 EXE 打包 + 交付物文档)

LAST_UPDATE=2026-10-09 12:48 GMT+8
```

## Phase 7 核心结论（实测，非推断）

- 比赛演示链路**真实执行**：`?demo=1` 种入 1 条任务（幂等），
  经真实 Runner + 真实 Skills 跑至 `completed`，
  Router 输出 `["search","plan"]`，13 条来源，2 个步骤均 `completed`。
- 处理方式面板逐步骤显示 `本地处理` / `Token/API：0`，
  汇总 `共 2 个步骤 · 其中 AI 辅助 0 个 · 确定性本地处理 2 个`。
- 演示链路 **AI_CALLS = 0**；`search` 被闸门硬拒绝；`plan` 为规则式。

## Phase 7 修复的两个真实缺陷（非环境）

1. **点击目标错误**：`workbench-task-item` 是整行外壳，无 `onClick`；
   可点击目标是行内 `workbench-task-open` 按钮。点外壳静默无效 → 详情不打开 →
   §71/§72 全灭。这是 7 条失败的**主因**。
2. **CDP `waitFor` 不抛错**（超时返回 `false`），链路因此在空列表上继续，
   于 `.find(...)` 取 `undefined` 才崩。已改为「把 waitFor 结果当断言」+ 显式等待目标行。
   另修 `location.reload()` 后的导航竞态，并把 `Log.entryAdded` 的 `url` 计入错误文本，
   使资源 404 可诊断（原 favicon 过滤因只看 `text` 而失效）。

## 已确认事实（无需重扫）

- 仓库 `/c/Users/lin/Documents/Gorgon-Workbench`，分支 `feature/workbench-competition`。
- 运行时：Node v22.22.2（托管）、Python 3.14.2（系统，含 pandas）。
  跑 E2E 需 `GORGON_PYTHON` 指向系统 Python。
- 托管 node：`C:/Users/lin/.workbuddy/binaries/node/versions/22.22.2-6/node.exe`
- Runner 是 Skills 与 Task 层**唯一写入口**；`aiClient` 为**可选注入**，缺省即纯确定性。
- 只有**真实** provider 可替换技能内容；Mock 输出记 `simulated:true` 且丢弃内容。
- 任务行：外壳 `workbench-task-item`（无 onClick）/ 详情入口 `workbench-task-open`（有 onClick）。
- Phase 5/6 的变更已含在 179d039 / c7c7f94 / 2f84e13。

## 交付优先级（时间不足时按此砍）

```text
P0 软件能启动 / Task 能执行 / Search+Plan Demo 稳 / EXE 能打开
P1 AI Assisted / Review Center / UI polish
P2 高级功能
```
