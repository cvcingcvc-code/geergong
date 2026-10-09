# Phase 11 — 正式交付与最终验收报告（Delivery Report）

**日期** 2026-10-10 · **仓库** `github.com/cvcingcvc-code/geergong` · **分支** `feature/workbench-competition`
**worktree** `C:\Users\lin\Documents\Gorgon-Workbench`

> 本轮定位：**完成交付**，不做功能膨胀。未新增任何产品代码、未新增测试、未引入新框架；
> 唯一写入是 `release/` 下三份文档（本文件 + `PHASE11_GUI_ACCEPTANCE.md` + `PHASE11_SUBMISSION_CHECKLIST.md`）。
> 配套细节见那两份文档，本文件只给结论、能力矩阵与停止条件。

---

## 停止条件（任务书要求的结构化输出）

```ini
PHASE=11
GIT_PUSH_STATUS=SUCCESS
REMOTE_BRANCH_URL=https://github.com/cvcingcvc-code/geergong/tree/feature/workbench-competition
LOCAL_HEAD_SHA=45b454147fb6ef66eb2e84d093949d94f55a4a5b
REMOTE_HEAD_SHA=45b454147fb6ef66eb2e84d093949d94f55a4a5b
WORKTREE_CLEAN=true
RELEASE_ZIP_STATUS=READY（18,960,747 B，已全新解压并通过真实 GUI 验收）
SHA256_STATUS=MATCH（ZIP 35f6c062…fd642 / EXE fb8edb48…2ec9，双双实测一致）
WINDOWS_GUI_STATUS=PASS（本机真实交互式 GUI 会话，核心操作链 24/24）
CLEAN_WINDOWS_STATUS=NOT_TESTED（无第二台无开发环境的干净机器）
SMARTSCREEN_STATUS=NOT_TESTED（本机文件无 MOTW，无法触发真实判定；静态事实：未签名 + VersionInfo 全空）
REAL_ENGINE_STATUS=VERIFIED（真实任务引擎在原生窗口内端到端跑通）
REAL_SEARCH_STATUS=IMPLEMENTED_NOT_TESTED（真实 provider 检索代码路径存在，本轮无 API Key 未实测）
REAL_AI_STATUS=IMPLEMENTED_NOT_TESTED（真实模型调用代码路径存在，本轮无 API Key 未实测）
COMPETITION_RULES=UNVERIFIED（仓库内外均无官方赛题/评分规则）
SUBMISSION_STATUS=READY_WITH_KNOWN_ISSUES（材料齐全可用；5 处文档级不一致待人工决定，其中 1 处为答辩风险项）
REMAINING_BLOCKERS=1) 跨重启持久化 FAIL（pywebview InPrivate，根因 desktop/main.py:318）；2) WebView2 Runtime 硬依赖零声明；3) SmartScreen 与干净机器验收需人工；4) 断言数 393/394 与 Q&A#10 持久化表述待更正；5) 官方比赛规则未获取
NEXT_HUMAN_ACTION=见文末 5 条（按优先级排序）
```

> 说明：`LOCAL_HEAD_SHA` / `REMOTE_HEAD_SHA` 记录的是**被验收的产品代码提交**（`45b4541`，
> ZIP/EXE 即由此构建），二者经 `git fetch --prune` 后逐字符比对一致。
> 本轮三份报告以一次 `docs(workbench):` 文档提交叠加在其上（**不含任何代码变更**），
> 该提交 SHA 见 `git log`，产品 blob 未变。

---

## 任务一：GitHub 正式推送 — ✅ SUCCESS

| 检查项 | 结果 |
| --- | --- |
| 分支 | `feature/workbench-competition`（未触碰 master） |
| master 保护 | `origin/master = 631cb7faaa07cd8dd1db4639331f3c5122d74022`，**推送前后未变** |
| 工作区 | `git status --porcelain` 空（推送时干净） |
| fetch --prune | 已执行，无冲突、无强推、无历史/分支/测试证据删除 |
| 推送后远端验证 | `git rev-parse origin/feature/workbench-competition` = `45b454147fb6ef66eb2e84d093949d94f55a4a5b` = 本地 HEAD → **SHA_MATCH** |
| 密钥/隐私 | 仓库 0 明文密钥（Phase 10 扫描 + build-smoke/EXE 自检双重断言）；Phase 11 证据目录含本机环境元数据，**留在仓库外未入库** |
| 远端分支地址 | https://github.com/cvcingcvc-code/geergong/tree/feature/workbench-competition |

网络：经 Clash 代理 `127.0.0.1:7890`（仓库级 `http.proxy`/`https.proxy` 配置）。

## 任务二：Windows 真实运行验收 — ✅ 完成（详见 `PHASE11_GUI_ACCEPTANCE.md`）

不再以单元测试代替实际运行。实测路径：**核对 ZIP SHA256 → 全新解压 → 运行 EXE → 检查进程/端口/窗口/渲染来源 →
UIA 驱动真实窗口完成创建任务/执行搜索/结果规划/查看处理方式/查看本地处理原因 → 两轮重启再检查**。

- **核心操作链 24/24 PASS**（`ops5-ops.json`）；窗口渲染来源经 RootWebArea 证实为 EXE 自身服务
  `http://127.0.0.1:8010/?demo=1`（排除浏览器回退与开发服务器）。
- **跨重启持久化 FAIL（2/2 复现）**：交付级真实缺陷。根因 `desktop/main.py:318`
  `webview.create_window(...)` 未传 `private_mode=False`，pywebview 默认 InPrivate → WebView2 不落盘 localStorage
  → 任务重启即丢（子窗口标题实测 `... - [InPrivate]`）。**按任务书只报告、不修改。**
- 三种验收状态严格区分：本机真实 GUI = **已执行**；全新机器独立验收 = **NOT_TESTED**；SmartScreen = **NOT_TESTED**。
- 附带发现的交付级文档缺口：**WebView2 Runtime 是硬依赖但全套 release 文档零声明**，build.ps1 未打包 Bootstrapper。

## 任务三：真实能力 vs 演示能力矩阵 — ✅ 完成

| # | 能力 | 定级 | 依据（代码 / 运行时证据） |
| --- | --- | --- | --- |
| 1 | **真实任务执行引擎**（路由 / 状态机 / Runner 单一写入口 / 技能编排） | **VERIFIED** | 原生窗口内实测：`已创建 → 运行 → 已完成`，时间线 32 事件含 `task_execution_completed`；路由面板「任务类型：多步工作流 / ✓ 智能搜索 / ✓ 本地规划 / 判断依据：检测到「找、活动」→ search；检测到「计划」→ plan」（`ops5-ops.json`、`page-text-after-run.txt`） |
| 2 | **Demo 搜索数据**（打包内置样例） | **VERIFIED** | 13 条来源**每条带「DEMO 数据」徽标**，`provider: fixture:shanghai_ai_events`、`dataOrigin: demo`；`pipeline/search/service.py:222-227` demo 分支返回 `providerMode="demo"` + `code: demo_data` 警告 |
| 3 | **真实联网检索**（provider 实网抓取） | **IMPLEMENTED / NOT_TESTED** | 代码路径完整：`service.py:229` `build_real_providers(...)`、`:231-232` `mode=="real"`、`:234-241` hybrid（real 优先 + fixture 显式标注 backfill）、`:243` 无 provider 时 `real_search_not_configured` 诚实降级；配置入口 `SEARCH_PROVIDER=brave SEARCH_API_KEY=...`。本轮**无 Key，未发起真实检索**（任务书不要求购买 API） |
| 4 | **真实 AI 模型调用** | **IMPLEMENTED / NOT_TESTED** | `app/src/workbench/ai/assist.js:23` `REAL_PROVIDERS = {hunyuan, deepseek, openai, qwen, glm, moonshot}`；`:27,32` `aiAssisted` **仅当 provider ∈ REAL_PROVIDERS 才为 true**；`:34` 非真模型 → `simulated:true`（UI 永不为 Mock 输出标「AI Assisted」）。本轮无 Key，真实模型端到端**未实测**（单测以注入 fetch 离线覆盖） |
| 5 | **无 Key 降级模式** | **VERIFIED** | 实测处理方式面板：`智能搜索 本地处理 Token/API：0`、`本地规划 本地处理 Token/API：0 · ELIGIBLE_COMPLEX`、`共 2 个步骤 · 其中 AI 辅助 0 个 · 确定性本地处理 2 个`；首页 `AI Engine Not connected`。降级码链 `fallback.js:19` `AI_NOT_CONFIGURED`，`:106-119` 可恢复 → 确定性兜底并携带 `fallbackReason` |
| 6 | **搜索结果复用**（Plan 不重搜） | **VERIFIED** | `app/src/workbench/skills/plan-skill.js:55-57`「Plan NEVER re-searches: it consumes the previous step's search results」+ `buildPlan({previousResults})`；实测时间线中 `skill_started: 智能搜索` **仅出现 1 次**，规划步骤直接产出 `workflow_result` |
| 7 | **任务处理方式解释**（谁做的 / 为什么 / Token 用量） | **VERIFIED** | 「处理方式」面板在真实窗口渲染并逐步标注处理方式 + Token/API + 汇总行 + 路由「判断依据」（`page-text-after-run.txt` L1231–1239） |

**诚实边界（任务书明确要求）**：本轮搜索成功 = **Demo 数据链路成功**，
**不得**解释为真实互联网检索成功。真实检索（#3）与真实模型（#4）代码路径存在但本轮 **NOT_TESTED**；
矩阵中二者定级为 `IMPLEMENTED_NOT_TESTED`，未标 VERIFIED。

## 任务四：比赛提交材料核查 — ✅ 完成（详见 `PHASE11_SUBMISSION_CHECKLIST.md`）

13 项材料全部存在、路径有效、SHA256 匹配；3 分钟/90 秒脚本的 6 处关键口播点与 Phase 11 实测原文逐条对照**全部匹配**。
发现 5 处不一致/缺口（只报告不修改）：

| 编号 | 严重度 | 内容 |
| --- | --- | --- |
| 3-A | 低 | 断言数 `TEST_REPORT.md`/PPT 第 7 页写 **393**，`FINAL_ACCEPTANCE_REPORT.md` 为 **394**（Phase 10 新增 1 条回归）→ 394 是最新事实 |
| 3-B | **高（答辩风险）** | Q&A #10 / §8 / RELEASE_NOTES / README 称「localStorage 持久化」，与 Phase 11 重启实测（任务全丢）冲突 |
| 3-C | 中 | `WINDOWS_ACCEPTANCE.md` 三处过时：EXE 大小 5,879,579→**6,139,461** B、HEAD `42f7926`→`45b4541`、§2.6「重启持久化 PASS」→**实测 FAIL** |
| 3-D | 中 | WebView2 Runtime 硬依赖在 README/RELEASE_NOTES/验收报告/build.ps1 中**零声明** |
| 3-E | 低 | SmartScreen 预期提示未写入 README（评委下载解压会带 MOTW 触发拦截） |

`COMPETITION_RULES=UNVERIFIED`：无官方规则文档，未编造任何评分项。

## 任务五：最终交付 — ✅ 完成

新增文件（仅文档）：

```text
release/PHASE11_DELIVERY_REPORT.md      ← 本文件（结论 + 能力矩阵 + ini 停止条件）
release/PHASE11_GUI_ACCEPTANCE.md       ← 任务二完整证据链（24/24、重启 FAIL、SmartScreen 事实、证据索引）
release/PHASE11_SUBMISSION_CHECKLIST.md ← 任务四 13 项材料核查 + 5 处不一致 + 提交前动作清单
```

`.gitignore` 的 `!release/*.md` 规则确保三份报告入库；ZIP/EXE/构建产物仍不入库（可复现）。

---

## 剩余阻塞项（REMAINING_BLOCKERS 展开）

1. **[P1 交付级] 跨重启持久化 FAIL** — `desktop/main.py:318` 缺 `private_mode=False`，
   InPrivate 导致任务重启即丢；与 4 份文档的持久化声明冲突。修复是一行代码，但需重建 EXE/ZIP、
   更新 `SHA256SUMS.md`、重跑桌面冒烟 → **超出本轮「只报告不修改」授权**。
2. **[P2 文档] WebView2 Runtime 依赖未声明** — 未预装 Evergreen Runtime 的干净机器会回退浏览器或启动失败。
3. **[P2 验收] 干净机器 + SmartScreen 未实测** — 需人工在第二台无 Node/Python 的 Win10/11 上下载→解压→双击。
4. **[P3 文档] 393/394 与 Q&A#10 表述待更正**（§3-A/3-B）。
5. **[外部] 官方比赛规则未获取** → `COMPETITION_RULES=UNVERIFIED`。

## NEXT_HUMAN_ACTION（按优先级）

1. **决定持久化缺陷的处置**（影响答辩口径）：
   - 方案 A：授权修 `desktop/main.py:318` 加 `private_mode=False` → 重建 → 更新 SHA256SUMS → 复跑桌面冒烟 →
     重新推送（届时 Q&A#10 表述无需改）。
   - 方案 B：本轮不修，按 `PHASE11_SUBMISSION_CHECKLIST.md` §3-B 建议**如实修改答辩口径**
     （「会话内保留、重启重置为演示种子、持久化为已识别 P1 修复项」）。
2. **干净机器验收 + SmartScreen 记录**：拷 ZIP 到无 Node/Python 的 Win10/11，经网络下载（带 MOTW）→ 解压 → 双击，
   截图 SmartScreen 提示原文、确认窗口出现、确认无 WebView2 时的行为；结果回填 `CLEAN_WINDOWS_STATUS` / `SMARTSCREEN_STATUS`。
3. **补两处 README 说明**：WebView2 Runtime 依赖（一行）+ SmartScreen「更多信息 → 仍要运行」（一行）。
4. **提供官方赛题/评分规则**（若有）→ 我据此校准演示脚本与 PPT 重点，并复核 `COMPETITION_RULES`。
5. **如需现场演示真实检索/真实 AI**：提供 `SEARCH_API_KEY`（如 brave）与 `GORGON_AI_API_KEY`，
   我做一次真机端到端验证，把矩阵 #3/#4 从 `IMPLEMENTED_NOT_TESTED` 升为 `VERIFIED`（任务书未要求购买 API，此为可选项）。

## 终止声明

推送已验证成功（SHA_MATCH）、真实运行验收已完成（含一项 FAIL 的如实记录）、
无法自动完成的三项已明确交给人工、证据完整（仓库外 154 个文件 + 三份入库报告）。
**本轮到此停止，不进入 Phase 12，不扩展功能。**
