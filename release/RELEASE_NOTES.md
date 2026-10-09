# Release Notes — Gorgon Workbench `1.0.0-competition`

**发布日期** 2026-10-09 · **目标交付日** 2026-10-10 · **平台** Windows x64 · **分支** `feature/workbench-competition`

---

## 一句话

把「用自然语言提需求」变成一条**可复现、可审计、可解释**的任务链路：
`任务 → 确定性路由 → 真实检索 → 来源 → 计划 → 结果 → 时间线 → 完成`，
并且**每一步都标明是本地处理还是 AI 辅助**。

---

## 本版交付了什么

### 1. 桌面程序（免安装）

`Gorgon-Workbench-Windows/Gorgon Workbench.exe` —— 双击即用。
PyInstaller **onedir** 打包（5.87 MB 可执行文件 + `_internal/` 运行时），
内嵌 pywebview 原生窗口（Windows 用 winforms 后端）。

选 onedir 而非 onefile：onefile 每次启动都要解压到临时目录，带 webview 时更慢更脆。
**稳定 > 文件数。**

### 2. 确定性任务引擎

- **状态机**：`已创建 → 规划中 → 就绪 → 执行中 → 已完成 / 失败`，转移走显式白名单。
- **路由**：纯函数，规则命中决定用哪些工具，最多 3 个；**未知意图返回空且不猜**。
- **执行**：Runner 是 Task 层**唯一写入口**；技能不能直接改任务状态。
- **可测试性**：所有协作者（仓储 / 路由 / 注册表 / 检索 / 时钟）都可注入，
  因此核心逻辑能在纯 Node 下测试，零 DOM、零 localStorage、零模型。

### 3. 五个技能（全部确定性可用）

`智能搜索`（网络读，永不交给模型）· `本地提取`（正则）· `本地摘要`（抽取式）
· `本地规划`（规则式）· `模板写作`。

### 4. AI 按需接入（Phase 4A/4B/5）

- **闸门** `shouldUseAI(ctx)` 是纯函数：先**硬拒绝**（检索/去重/校验等技能永久禁用），
  再按复杂度判定；输出 `{eligible, reason, purpose, estimatedCost}`。
- **Provider 契约**：MockProvider（离线默认）与 HunyuanProvider（注入式 `fetch`，
  因而离线可测）。启用真实模型必须**显式**指定 provider + mode + key。
- **降级链**：缓存 → 确定性 → 明确失败。任何可恢复错误都会降级回本地，
  并把原因写进步骤 metadata，**绝不编造结果**。
- **诚实的模拟标记**：Mock 的输出一律记 `simulated: true` 且**内容被丢弃** ——
  因为一次「模拟替换」曾把定制的 4 步计划污染成模板腔，现在有永久回归测试守着。

### 5. 人工审核（Phase 6）

提议状态机 `提议 → 批准/编辑/驳回 → 执行/失败`，带审计历史。
护栏：只能从合法状态批准/执行；外部动作未接入时如实标 `FAILED`。
批准会**真的**创建一个后续任务。

### 6. 比赛演示链路（Phase 7）

- `?demo=1` **幂等**预置比赛指令任务，可离线完整跑通。
- Task Detail 新增「处理方式」面板：逐步显示 `本地处理` / `AI Assisted`、
  `模拟输出` 徽标、Token 用量、降级原因，以及本地 vs AI 的汇总计数。
- 演示链路 **AI_CALLS = 0**（检索被闸门硬拒，规划为规则式）。

---

## 关键数字（全部实测）

| 项目 | 结果 |
| --- | --- |
| 单元测试 | **205 / 205** |
| 构建冒烟（含密钥扫描） | **18 / 18** |
| 遗留前端 E2E | **58 / 58** |
| Workbench E2E | **93 / 93** |
| 桌面冒烟（含打包 EXE 自检） | **19 / 19** |
| 打包 EXE 无头自检 | **8 / 8**（`frozen=true`, Python 3.14.2） |
| 前端 bundle | 420.30 kB（gzip 123.84 kB），1737 modules |
| 仓库内明文密钥 | **0** |

---

## 已修复的重要缺陷（本版）

1. **点击目标错误**：任务列表的整行外壳没有 `onClick`，可点击的是行内「详情」按钮。
   演示链路因此静默失败 —— 这是 Phase 7 七条 E2E 失败的主因。
2. **CDP `waitFor` 超时返回 `false` 而非抛错**，导致测试在空列表上继续并崩在 `.find()`。
   已改为「把等待结果当断言」并显式等待目标出现，同时修掉刷新后的导航竞态。
3. **404 不可诊断**：资源类错误的 URL 在 `entry.url` 而非 `entry.text`，
   原来的过滤永远匹配不到。已把 URL 计入错误文本。
4. **Mock 污染真实输出**：只有**真实** provider 才允许替换技能内容。
5. **提议状态机缺口**：`edited → approved`（编辑后仍需一次明确的人工「是」）。

---

## 已知限制（诚实声明）

- **演示数据是内置样例**，不是实时结果；每条来源都标 `DEMO`。真实检索需宿主配置。
- **未做**（且刻意不做）：多智能体、自动执行外部动作、向量库、
  账号体系、云同步、团队协作、支付、复杂权限、插件市场。
- **未做**（时间/优先级原因）：安装器、自动更新、代码签名。
  因此 Windows SmartScreen 可能对未签名 EXE 给出提示 —— 选「仍要运行」即可。
- **单机单人**：数据存本地（localStorage），不跨设备同步。
- `release/Gorgon-Workbench-Windows/` 是**构建产物**（已 gitignore），
  用 `desktop/build.ps1` 可完整复现。

---

## 构建环境（复现用）

| 组件 | 版本 |
| --- | --- |
| Windows | x64 |
| Node（构建前端） | 22.22.2 |
| Python（打包） | 3.14.2 |
| PyInstaller | 6.22.3 |
| pywebview | 6.2.1 |
| pythonnet | 3.2.1 |

```powershell
# 1) 构建前端
cd app; npm install; npm run build

# 2) 打包桌面程序（必须是装有 pyinstaller+pywebview 的解释器）
$env:GORGON_PYTHON = "C:\path\to\python.exe"
powershell -ExecutionPolicy Bypass -File desktop/build.ps1
```

> 注意：`python` 在部分环境指向的并非装有打包依赖的解释器；
> `build.ps1` 会**主动校验**并给出明确报错，而不是产出一个坏包。

---

## 升级 / 回滚

无安装器：直接替换 `Gorgon-Workbench-Windows/` 整个目录即可。
回滚 = 换回旧目录。用户数据在 `localStorage`，不随程序目录变动。
