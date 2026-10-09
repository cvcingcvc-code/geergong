# Delivery State

> Gorgon Workbench — 连续交付主状态文件（每阶段覆盖更新）。
> 下一轮**只读这个文件**即可恢复上下文，不要重新扫描整个 repo。

```text
CURRENT_PHASE=PHASE 10 DONE (COMPETITION FINAL ACCEPTANCE) — COMPETITION_CANDIDATE_READY
CURRENT_HEAD=9e1e3b6 (PHASE 10)

LAST_COMPLETED=
  PHASE 0/1/2/3/3B/4A/4B/5/6/7/8  (Gate 全绿)
  PHASE 9 TASK-9.1 全量测试矩阵 5 套件全绿 (205+18+58+93+19 = 393 断言)
  PHASE 9 TASK-9.2 交付物文档 release/{README,DEMO_SCRIPT,TEST_REPORT,RELEASE_NOTES}.md
  PHASE 9 TASK-9.3 安全核查：仓库内明文密钥 0、bundle 内密钥 0
  PHASE 9 TASK-9.4 打包件端到端实测：原生窗口（msedge 增量 0）+ 服务可用
  PHASE 10 (本轮)
    TASK-10.1 冻结：审核 HEAD/工作树，无新功能；仅修 1 处数据准确性缺陷
      fix(workbench): runner 持久化 step.metadata（method/aiAssisted/aiReason/
      aiUsageTotal/isDemo），修复「处理方式」面板读不到原因的链路断裂
      → 回归测试 +1，单元 205→206/206，NEW_REGRESSIONS=0
    TASK-10.2 Windows 实机验收 → release/WINDOWS_ACCEPTANCE.md
      EXE 8/8 + desktop 19/19 全绿；独立 Win GUI 会话/SmartScreen=NOT_TESTED（诚实）
    TASK-10.3 真实场景验证 → release/REAL_WORLD_EVALUATION.md（5/5 场景通过）
    TASK-10.4 比赛材料 → release/COMPETITION_MATERIALS.md（脚本/PPT大纲/10 Q&A/录屏）
      COMPETITION_RULES=UNVERIFIED（仓库无官方赛题，不编造）
    TASK-10.5 GitHub 交付：README 更新、SHA256SUMS、本地 ZIP；push 待用户授权
    TASK-10.6 停止条件：全部可自主验收项完成，见本文件顶部 CURRENT_PHASE

CURRENT_TASK=(完成) 待用户授权 push + 独立 Win 机器人工验收 GUI
NEXT_TASK=(停) 不进入 Phase 11，不扩展功能

TEST_STATUS=
  UNIT            = 206/206 PASS  (205 基线 + 1 回归)
  TEST_BUILD      = 18/18 PASS (含 secret 扫描)
  VITE_BUILD      = PASS (1737 modules, 420.36 kB / gzip 123.85 kB, hash CT8rx1Rm)
  WORKBENCH_E2E   = 93/93 PASS
  LEGACY_E2E      = 58/58 PASS
  DESKTOP_SMOKE   = 19/19 PASS (含打包 EXE 自检 8/8)
  EXE_PACKAGED    = PASS (6.14 MB, frozen=true, python=3.14.2, 原生窗口)
  NEW_REGRESSIONS = 0
  API_KEYS_IN_REPO= 0
  EXE_SHA256      = fb8edb483d71b4273863c00c077cf849bd651fd8d4c0b30823d64890f9822ec9
  ZIP_SHA256      = 35f6c0622d9886863dd28c83c615b5f3588a4948427239d953f782581f7fd642

KNOWN_ISSUES=
  - npm run build 清理既有 app/dist/ 时被沙箱删除拦截 (ETIMEDOUT / genie-trash)，
    非代码缺陷：改用 `vite build --emptyOutDir=false` 即 PASS，产物一致。
    build.ps1 在 app/dist 已存在时直接复用，已规避。
  - 沙箱可能被外部进程占用 4173/4175/8000 端口，造成 E2E 假失败。
    跑 E2E 前先确认端口空闲（netstat -ano | grep LISTENING）。
  - PATH 上的 `python` 是托管 3.13（无 pyinstaller/pywebview）。
    打包必须用系统 3.14：build.ps1 支持 GORGON_PYTHON 并会主动校验。
  - 未做（P2，不影响交付）：安装器 / 代码签名 / 自动更新。
    未签名 EXE 可能触发 SmartScreen 提示，选「仍要运行」即可。

BLOCKERS=none

DELIVERY_READINESS=COMPETITION_CANDIDATE_READY

LAST_UPDATE=2026-10-10 00:30 GMT+8
```

## 交付物清单（已就位）

```text
release/
  README.md               # 是什么 / 30 秒跑起来 / 怎么验证
  DEMO_SCRIPT.md          # 比赛演示脚本 60–120 秒（含讲解词与答疑）
  TEST_REPORT.md          # 完整测试矩阵、EXE 自检原文、安全核查、复现步骤
  RELEASE_NOTES.md        # 版本说明、关键数字、已修缺陷、已知限制
  Gorgon-Workbench-Windows/
    Gorgon Workbench.exe  # 双击即用（5.87 MB，含图标）
    selftest.json         # 8/8 自检报告（frozen=true, python=3.14.2）
    _internal/            # 冻结运行时：app/dist + pipeline + webview/pythonnet
docs/workbench/COMPETITION_DEMO_SCRIPT.md   # 演示脚本（仓库内版本）
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
