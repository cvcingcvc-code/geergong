# Phase 11 — 比赛提交材料核查清单（Submission Checklist）

**日期** 2026-10-10 · **分支** `feature/workbench-competition` · **HEAD** `45b454147fb6ef66eb2e84d093949d94f55a4a5b`

> 核查方法：逐项确认**存在性 → 内容匹配 → 路径/数值有效性**。
> `COMPETITION_RULES=UNVERIFIED`：仓库内外均无官方赛题/评分规则文档，本清单不假设任何评分项。

---

## 1. 材料存在性与内容核查

| # | 材料 | 位置 | 存在 | 内容核查结论 |
| --- | --- | --- | --- | --- |
| 1 | 3 分钟演示脚本 | `release/COMPETITION_MATERIALS.md` §1 | ✅ | 完整（0:00–3:00 分镜 + 口播词）；口播引用的路由/处理方式面板文案与 Phase 11 实测原文一致（§4 注意 1 处需更新） |
| 2 | 90 秒精简脚本 | 同上 §2 | ✅ | 5 段分镜完整，与 3 分钟版内容一致 |
| 3 | 8 页 PPT 大纲 | 同上 §3 | ✅ | 8 页表格完整；**第 7 页「393 项断言」与 `FINAL_ACCEPTANCE_REPORT.md` 的 394 不一致**（见 §3-A） |
| 4 | 10 个答辩 Q&A | 同上 §4 | ✅ | 10 问齐全，答案与代码事实相符；**#10「localStorage 持久化」表述与 Phase 11 重启实测冲突**（见 §3-B） |
| 5 | README | `release/README.md` | ✅ | 30 秒上手/演示路径/密钥声明完整；**未声明 WebView2 Runtime 硬依赖**（见 §3-D） |
| 6 | Release ZIP | `release/Gorgon-Workbench-Windows-v1.0.0-competition.zip` | ✅ | 18,960,747 B；SHA256 实测匹配 `SHA256SUMS.md`；Phase 11 从该 ZIP 全新解压完成 GUI 验收 |
| 7 | SHA256 校验和 | `release/SHA256SUMS.md` | ✅ | ZIP `35f6c062…fd642`、EXE `fb8edb48…2ec9` 双双实测匹配；bundle hash `index-CT8rx1Rm.js` 与解压副本一致 |
| 8 | 真实场景验收报告 | `release/REAL_WORLD_EVALUATION.md` | ✅ | 5 场景（A/B/C1/C2/C3）+ 基线对照；结论与 Phase 11 能力矩阵不冲突（该报告基于引擎级执行，Phase 11 补充了 GUI 级验证） |
| 9 | 演示脚本（60–120s） | `release/DEMO_SCRIPT.md` | ✅ | 与 COMPETITION_MATERIALS §2 对应 |
| 10 | 测试矩阵报告 | `release/TEST_REPORT.md` | ✅ | 合计 393（205+18+58+93+19）；**Phase 10 增加 1 条回归后为 394**，TEST_REPORT 未同步（见 §3-A） |
| 11 | 版本说明 | `release/RELEASE_NOTES.md` | ✅ | 能力边界/已知限制声明完整；同样未提 WebView2 依赖（§3-D） |
| 12 | Phase 10 验收报告 | `release/FINAL_ACCEPTANCE_REPORT.md` | ✅ | TESTS_PASS=394；其「GITHUB_PUSH=BLOCKED 待授权」已被 Phase 11 任务一解除（推送完成并验证） |
| 13 | Windows 验收报告 | `release/WINDOWS_ACCEPTANCE.md` | ✅ | **部分结论已被 Phase 11 推翻/过时**（见 §3-C），保留作为历史记录，以 `PHASE11_GUI_ACCEPTANCE.md` 为准 |

## 2. 路径有效性抽查

- `COMPETITION_MATERIALS.md` §7 架构图引用的 `desktop/main.py`、`pipeline/api/server.py`、`app/`（React 18 + Vite 5）路径全部真实存在。
- §5 可复现 Demo 输入第 1 条与 EXE 自动种入的种子一致（Phase 11 实测窗口中确认种子任务存在）。
- `SHA256SUMS.md` 复现命令（`desktop/build.ps1` + `shutil.make_archive`）路径有效。
- README「30 秒跑起来」步骤与 Phase 11 实测启动路径一致（解压 → 双击 → 2–4 秒出窗口）。

## 3. 不一致与缺口清单（按严重度排序，只报告不修改）

### 3-A（低）断言总数 393 vs 394
- `TEST_REPORT.md` L20 与 `COMPETITION_MATERIALS.md` PPT 第 7 页写 **393**；
  `FINAL_ACCEPTANCE_REPORT.md` 写 **394**（Phase 10 修 metadata 缺陷时新增 1 条回归测试，205→206）。
- 394 是最新事实。提交前建议把两处 393 更新为 394（或注明「393 + 1 回归」）。

### 3-B（高）Q&A #10 与「已知限制」的持久化表述与实测冲突
- `COMPETITION_MATERIALS.md` Q&A #10：「单机单人（**localStorage 持久化**，不跨设备同步）」；
  §8 与 `RELEASE_NOTES.md`、README 同口径。
- Phase 11 实测：交付形态（EXE + pywebview 默认 InPrivate）下 **localStorage 不落盘，任务重启即丢**（2/2 复现）。
- 「localStorage 持久化」在浏览器直接访问 `:8010` 的形态下成立，在**双击 EXE 的交付形态下不成立**。
- 若评委现场问「重启后数据还在吗」，按当前文档回答会出错。建议改为如实表述：
  「当前 EXE 以 WebView2 InPrivate 承载，会话内数据保留、重启后重置为演示种子；持久化为已识别的 P1 修复项（一行 `private_mode=False`）」。

### 3-C（中）`WINDOWS_ACCEPTANCE.md` 三处过时
1. 头部 EXE 大小 5,879,579 B → 实际 **6,139,461 B**（Phase 10 重建含 metadata 修复）。
2. 头部 HEAD `42f7926` → 分支实际 HEAD `45b4541`。
3. §2.6「重新启动 — 持久化任务仍可读 → PASS（schema round-trip 单测覆盖）」→ **实测 FAIL**；
   单测只验证 schema 函数，未验证宿主持久化。§3 的「双击 EXE 真正出现可见桌面窗口 NOT_TESTED」已被 Phase 11 PASS 取代。
- 处置建议：不改写历史文档，在提交包中以 `PHASE11_GUI_ACCEPTANCE.md` 为最新事实来源（本清单 §1-13 已注明）。

### 3-D（中）WebView2 Runtime 硬依赖零声明
- 窗口由系统 `msedgewebview2.exe`（本机 154.0.4258.62）承载；未预装 Evergreen Runtime 的干净机器将回退浏览器或启动失败。
- README / RELEASE_NOTES / WINDOWS_ACCEPTANCE / build.ps1 均未提及，ZIP 内也未附 Bootstrapper。
- 建议：README「30 秒跑起来」加一行「需要 Windows 10/11 自带的 WebView2 Runtime（绝大多数机器已预装）」。

### 3-E（低）SmartScreen 预期提示未写入 README
- EXE 未签名 + VersionInfo 全空（实测）。`WINDOWS_ACCEPTANCE.md` §4 有提及「可能触发 SmartScreen」，README 没有。
- 评委若从网盘下载 ZIP 解压运行，会带 MOTW 触发拦截。建议 README 增加一句「首次运行若出现 SmartScreen，选择『更多信息 → 仍要运行』」。

## 4. 演示脚本与实测的匹配确认

3 分钟脚本的关键口播点逐条对照 Phase 11 实测（`page-text-after-run.txt`）：

| 脚本声明 | 实测 | 匹配 |
| --- | --- | --- |
| 首页状态条 `AI Engine: Not connected` | 同文案在页 | ✅ |
| 路由面板「任务类型：多步工作流 / ✓ 智能搜索 / ✓ 本地规划 / 判断依据」 | 同文案在页 | ✅ |
| 来源每条带 DEMO 徽标 | 13 条全部「DEMO 数据」 | ✅ |
| 处理方式面板「本地处理 / Token/API：0 / AI 辅助 0 个」 | 同文案在页（L1231–1239） | ✅ |
| 「检索这一步永远禁止交给模型」 | `ai/assist.js` 闸门 + `plan-skill.js:55` 注释佐证 | ✅ |
| 双击 EXE 预置演示任务（幂等） | 每次启动种子任务在列（重启后重播，见 3-B） | ✅ |

## 5. 提交前动作清单（人工决定项）

- [ ] 修正 393→394（§3-A，两处，5 分钟文档改动）
- [ ] 修正 Q&A #10 / §8 / RELEASE_NOTES 的持久化表述（§3-B，**强烈建议**，否则答辩现场可能被问穿）
- [ ] README 补 WebView2 依赖 + SmartScreen 提示（§3-D/E，各一行）
- [ ] 决定是否在提交前修复 `desktop/main.py:318` 加 `private_mode=False`（一行代码 + 重建 EXE/ZIP + 更新 SHA256SUMS + 重跑桌面冒烟）——修复则 §3-B 文档无需改口径
- [ ] 获取官方赛题/评分规则后复核本清单（当前 `COMPETITION_RULES=UNVERIFIED`）

```ini
SUBMISSION_STATUS=READY_WITH_KNOWN_ISSUES（材料齐全、路径有效、SHA256 匹配；5 处文档级不一致待人工决定，其中 §3-B 为答辩风险项）
COMPETITION_RULES=UNVERIFIED
```
