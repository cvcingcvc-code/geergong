# Phase 11 — Windows 真实运行验收报告（GUI Acceptance）

**日期** 2026-10-10 · **分支** `feature/workbench-competition` · **HEAD** `45b454147fb6ef66eb2e84d093949d94f55a4a5b`
**被测对象** `release/Gorgon-Workbench-Windows-v1.0.0-competition.zip` **全新解压副本**（非开发目录）

> 本报告替代 Phase 10 `WINDOWS_ACCEPTANCE.md` 中「sandbox 无 GUI，窗口 NOT_TESTED」的结论：
> Phase 11 在**当前机器的真实交互式 GUI 会话**中完成了 EXE 的完整操作验收。
> 所有截图、JSON、驱动脚本保存在仓库外证据目录（见 §8），**未修改任何产品代码**。

---

## 0. 三种验收状态的区分（任务书要求）

| 状态 | 含义 | 本轮结论 |
| --- | --- | --- |
| **当前机器真实 GUI 验收** | 本机交互式会话中运行解压后的 EXE，真实操作窗口 | **已执行**：核心操作链 24/24 PASS；**跨重启持久化 FAIL**（见 §6，交付级真实缺陷） |
| **全新机器独立验收** | 无 Node/Python 开发环境的干净 Windows 机器 | **NOT_TESTED**（无第二台机器；本机进程树证据见 §5 可部分替代） |
| **SmartScreen 行为验证** | 带 Mark-of-the-Web 的未签名 EXE 首次下载运行的真实提示 | **NOT_TESTED**（本机文件无 MOTW，无法触发真实 SmartScreen 判定；静态事实见 §7） |

---

## 1. 验收环境与完整性核对

| 项 | 实测值 |
| --- | --- |
| OS | Windows NT 10.0.26200（x64），交互式桌面会话（`interactive_session: true`，基线 13 个可见顶层窗口） |
| ZIP SHA256 | `35F6C0622D9886863DD28C83C615B5F3588A4948427239D953F782581F7FD642` — **与 `SHA256SUMS.md` 逐字符一致** |
| ZIP 大小 | 18,960,747 B |
| EXE SHA256 | `FB8EDB483D71B4273863C00C077CF849BD651FD8D4C0B30823D64890F9822EC9` — **与 `SHA256SUMS.md` 一致** |
| EXE 大小 | 6,139,461 B（注意：`WINDOWS_ACCEPTANCE.md` 头部记载的 5,879,579 B 为 Phase 9 旧构建，已过时） |
| 解压位置 | `phase11-evidence\extracted\Gorgon-Workbench-Windows\`（从 ZIP 全新解压，与 `release/` 下开发副本隔离） |
| WebView2 Runtime | 已安装，版本 `154.0.4258.62`（注册表 `EdgeUpdate\Clients\{F3017226-...}`） |

## 2. 启动与窗口证据

- **进程/窗口**：双击等效启动（`subprocess.Popen` 托管）后 **2.2–4.2 秒**内出现原生窗口
  `Gorgon Workbench`（class `WindowsForms10.Window.8.app.0.aec740_r25_ad1`，1360×882，visible+enabled）。
- **端口**：同一 PID 绑定 `127.0.0.1:8000`（检索 API）与 `127.0.0.1:8010`（UI），符合单进程双线程设计（`gui-run1-ports.json`）。
- **渲染来源**：UI Automation RootWebArea 的 ValuePattern = `http://127.0.0.1:8010/?demo=1`
  —— **窗口渲染的是 EXE 自身服务的页面**，不是浏览器回退、不是开发服务器。
- **子窗口结构**：`Chrome_WidgetWin_1` 标题 `Gorgon · 发现你的周末 - [InPrivate]`
  —— pywebview 以 WebView2 InPrivate 模式承载页面（此事实是 §6 缺陷的根因线索）。
- **渲染非空白**：PrintWindow 截图 167 KB、丰富色彩、TextPattern 读出整页中文 UI 文本（`window-render-analysis.json`、`page-text-after-run.txt`）。

## 3. 真实操作验收 — 24/24 PASS（`ops5-ops.json`，2026-10-10 02:08）

驱动方式：Windows UI Automation（ValuePattern.SetValue 输入 / InvokePattern 点击），
在**真实原生窗口**内执行，每步增量落盘 + PrintWindow 逐步截图。

任务书要求的操作逐项对应：

| 任务书要求 | 执行结果 | 证据步骤 |
| --- | --- | --- |
| 创建任务 | 输入目标「帮我寻找本周 AI 活动并制定参与计划」→「开始任务」按钮变可用 → 点击 → 任务详情页打开、目标原文回显 | OP1–OP2（7 步 PASS） |
| 执行搜索 | 点击「运行任务」→ 路由 `确定工具：search` → `开始执行：智能搜索` → `完成：智能搜索` → `search_results` 产出 | OP3–OP4（6 步 PASS） |
| 根据结果规划 | `开始执行：本地规划` → `完成：本地规划` → `workflow_result` 信封；Plan 消费上一步检索结果（时间线中 search 仅执行 1 次） | OP5（3 步 PASS） |
| 查看步骤处理方式 | 「处理方式」面板真实渲染，原文见 §4 | OP6（4 步 PASS） |
| 查看 AI 辅助或本地处理原因 | 面板显示「本地处理 ×2、Token/API：0、AI 辅助 0 个」+ 路由「判断依据」+ `ELIGIBLE_COMPLEX` 降级原因 | OP4_ROUTER_SEARCH、OP6_* |
| 重启程序并再次检查 | 两轮完整重启周期，**任务全部丢失** → FAIL（§6） | `restart-confirm.json` |

辅助旁证：验收窗口内另有**用户本人手动创建**的任务「去找黑客松」（真人可交互的直接证明），
以及此前 run2/run3/run4 三轮 harness 的完整 timeline JSON（各 46–67 KB）。

## 4. 「处理方式」面板实测原文（`page-text-after-run.txt` L1231–1239）

```text
处理方式
智能搜索    本地处理    Token/API：0
本地规划    本地处理    Token/API：0    · ELIGIBLE_COMPLEX
共 2 个步骤 · 其中 AI 辅助 0 个 · 确定性本地处理 2 个
```

同页其他关键实测文本：

- 路由面板：`任务路由（确定性规则）`、`任务类型：多步工作流`、`✓ 智能搜索 ✓ 本地规划`、
  `判断依据：检测到「找、活动」→ search；检测到「计划」→ plan`
- 来源列表：**13 条来源，每条带「DEMO 数据」徽标**（`dataOrigin: demo`，provider `fixture:shanghai_ai_events`）
- 首页状态条：`任务引擎 Ready`、`任务路由 Deterministic`、`AI Engine Not connected`
- 时间线 32 条事件，终态 `task_execution_completed`、`状态：running → completed`

## 5. 不依赖开发环境的证据（部分替代「干净机器」验收）

- 进程树核查（`process-tree.txt`、`childcheck.json`）：EXE 运行期间**唯一子进程是系统 WebView2**
  （`C:\Program Files (x86)\Microsoft\EdgeWebView\...\msedgewebview2.exe`）；
  **无 node.exe、无 python.exe 子进程**。
- 发行目录内 `npm run` 字样仅存在于测试夹具（`_internal` 打包残留的测试文件），运行时不触达。
- 结论：EXE 运行不依赖本机 Node/Python 开发环境。**但「全新干净机器双击验收」本身仍为 NOT_TESTED**——
  本机装有开发工具与 WebView2，无法排除「干净机器缺 WebView2 Runtime」场景（见 §7 缺口 B）。

## 6. 跨重启持久化验收 — **FAIL（交付级真实缺陷，只报告不修改）**

两轮独立重启周期（`restart-confirm.json`，02:15–02:17），每轮：
启动 → 创建带唯一时间戳的任务 → 确认任务详情页打开 → WM_CLOSE 正常退出（进程确认退出）→ 重新启动 → 读取任务列表。

| 轮次 | 创建的任务 | 重启后 | WebView2 子窗口标题 |
| --- | --- | --- | --- |
| 1 | `重启持久化验证 P11-1-1791569707` | **丢失**（`survived_restart: false`） | `... - [InPrivate]` |
| 2 | `重启持久化验证 P11-2-1791569789` | **丢失**（`survived_restart: false`） | `... - [InPrivate]` |

判定：`tasks_lost_on_restart: 2/2`、`state_persists_across_restart: false`、`webview_inprivate_observed: true`。

**根因（代码级，只读审查确认）**：`desktop/main.py:318`

```python
webview.create_window(APP_TITLE, url, width=1360, height=900, min_size=(960, 640))
```

pywebview `private_mode` 默认为 `True` → WebView2 以 InPrivate 运行 → **localStorage 不落盘**，
重启即回到出厂 demo 种子状态。修复方向为 `private_mode=False`（一行），但按任务书
「不修改代码、不引入新变更」原则，本轮**只报告**。

**与既有文档的冲突**（详见 `PHASE11_SUBMISSION_CHECKLIST.md` §3）：
`WINDOWS_ACCEPTANCE.md` §2.6 声称「重新启动 — 持久化任务仍可读：通过 schema round-trip 单测覆盖 → PASS」——
单测验证的是 **schema 读写函数**，从未验证**宿主窗口是否真的持久化**；实测证明该声明在交付形态下不成立。

脚本自缺陷（如实记录）：`restart_confirm.py` 的 `demo_seed_present_after=False` 为误报——
UI 截断标题「…优…」导致前缀匹配失败，实际重启后 demo 种子**存在**（创建时间为重启时刻），
这恰恰证明存储被清空后重播种子。该误报不影响 `survived_restart=false` 主判定（其依据是带唯一时间戳的任务不可见 + 页面文本仅 201 字符）。

## 7. SmartScreen 静态事实（`smartscreen-facts.json`）与文档缺口

| 判定要素 | 实测 |
| --- | --- |
| Authenticode 签名 | **NotSigned**（无签名者证书、无时间戳） |
| VersionInfo（ProductName/CompanyName/FileVersion...） | **全部为空** |
| Mark-of-the-Web | EXE 与 ZIP 均**无** Zone.Identifier（本地产物，未经网络下载） |
| 本机 Defender 检出记录 | 0 |

结论：真实 SmartScreen 首次运行提示**只能在一台全新机器上以下载→双击方式验证**，本轮 **NOT_TESTED**。
静态事实预示：无签名 + 无版本信息 + 携带 MOTW 时，SmartScreen 大概率显示「Windows 已保护你的电脑」蓝色拦截，
需「更多信息 → 仍要运行」。此路径与 `WINDOWS_ACCEPTANCE.md` §4 的预判一致，但提示文字未实测。

**文档缺口 B（交付级）**：WebView2 Runtime 是**硬依赖**（窗口由系统 `msedgewebview2.exe` 承载），
但 `release/README.md`、`RELEASE_NOTES.md`、`WINDOWS_ACCEPTANCE.md` 均**未声明**该依赖，
`desktop/build.ps1` 也未打包 Evergreen Bootstrapper。未预装 WebView2 的干净 Windows（部分 LTSC/旧 Win10）
将走浏览器回退或启动失败。提交比赛前应在 README 补一段依赖说明。

## 8. 证据索引（仓库外：`C:\Users\lin\WorkBuddy\2026-10-10-00-30-27\phase11-evidence\`，154 个文件）

> 证据目录含本机桌面环境元数据（窗口标题等），涉及隐私，**不入 git**；报告只引用数值。

| 类别 | 关键文件 |
| --- | --- |
| 完整性 | `smartscreen-facts.json`（ZIP/EXE SHA256、签名、MOTW、WebView2 注册表） |
| 启动/端口/进程 | `gorgon-run.json`、`gui-run1-ports.json`、`process-tree.txt`、`childcheck.json` |
| 最终操作验收 | `ops5-ops.json`（24/24）、`ops5-00..06-*.png`（PrintWindow 逐步截图，哈希各异）、`page-text-after-run.txt`（43 KB 整页文本） |
| 中间轮次 | `run2/run3/run4-timeline.json`、`gui-run1-*`、`ops4-ops.json` |
| 重启验收 | `restart-confirm.json`（2 轮）、`restart-confirm-c*-*.png`、`restart*-before/after.txt` |
| 驱动脚本 | `uia_drive3.py`（最终版）、`restart_confirm.py`、`capture_window.py`、`smartscreen_facts.ps1` |

## 9. 结论

```ini
WINDOWS_GUI_STATUS=PASS（本机真实 GUI 会话：启动/窗口/渲染来源/创建/路由/搜索/规划/处理方式 24/24）
PERSISTENCE_ACROSS_RESTART=FAIL（InPrivate 致任务丢失，2/2 复现，根因 desktop/main.py:318）
CLEAN_WINDOWS_STATUS=NOT_TESTED（无第二台干净机器；进程树证据部分替代）
SMARTSCREEN_STATUS=NOT_TESTED（无 MOTW 无法本机触发；静态事实：未签名+VersionInfo 全空）
```

**本轮 GUI 验收推翻了 Phase 10 的「窗口 NOT_TESTED」，同时发现一个此前所有测试层都未覆盖的
交付级缺陷（跨重启持久化）**。按任务书要求：只报告、不修改、不进入 Phase 12；
是否修复 `private_mode` 由负责人决定（见 `PHASE11_DELIVERY_REPORT.md` 的 NEXT_HUMAN_ACTION）。
