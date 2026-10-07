# Workbench Target Architecture — 目标架构草案

> Phase 0 输出（2026-10-07）。这只是**草案**，不是实施计划；Phase 1 开始前须由负责人确认范围。
>
> 核心原则（继承自 pipeline 的 TOKEN_STRATEGY）：
> 1. **deterministic first** — 能用确定性代码完成的，绝不调用 LLM。
> 2. **Human-in-the-loop** — 一切 LLM 输出只是「候选/建议」，最终裁决权在人工审核。
> 3. **来源可追溯** — provenance 字段（reviewedBy/humanEdited/sourceUrl/dataOrigin）从 pipeline 一路带到 Workbench 结果。
> 4. **新增 Adapter Layer，不重写 pipeline** — workbench/ 只「调用」pipeline，不复制其代码。
> 5. **Token 预算前置** — 每个 LLM 调用点必须声明触发条件、频率上限、缓存策略、失败降级。

## 1. 目标形态

用户输入一个工作目标 → 系统完成：

```
目标理解 → 信息搜索 → 内容整理 → 任务规划 → 人工审核 → 执行/保存
```

每一步要么是确定性代码（免费、可重放、可测试），要么是 LLM 候选输出 + 人工确认（可审计）。全过程每条数据带 provenance。

## 2. 目录结构（目标态）

```
app/                    # React + Vite Workbench UI（从 v1fb 迁入并扩展）
  src/screens/          #   现有 6 screens 保留 + 新增 Workbench screens
  src/lib/api.js        #   VITE_API_BASE_URL 可配（已具备）
  public/               #   PWA 资产保留（manifest/sw/icons）

workbench/              # ★ 新增：Workbench 编排层（纯 Python 标准库，与 pipeline 同风格）
  router.py             #   目标 → 任务分解（确定性规则优先；复杂语义走 ai_provider 白名单）
  task_service.py       #   任务状态机 + 持久化（SQLite，复用 store 的单写者模式）
  skills/               #   薄封装：search_skill / organize_skill / plan_skill
  ai_provider.py        #   可选 LLM 接口（仅 TOKEN_STRATEGY 白名单场景；带 llmAssisted 标记）
  token_budget.py       #   预算计量与限流
  tests/                #   workbench 单测

pipeline/               # ★ 原样复用：search/clean/dedupe/trust/review/store/export
  api/server.py         #   保持现状（可继续服务 app/ 静态 + /api/search）

desktop/                # ★ 后续：桌面打包（pywebview 壳 + PyInstaller spec）
```

## 3. 数据流（核心不变式）

```
用户目标
  ↓  workbench/router.py（规则分解；不确定 → ai_provider 出「候选计划」）
TaskPlan（steps: [search | organize | plan]，全部带 id/provenance）
  ↓  workbench/skills/search_skill.py
pipeline.search.service.search_events()     ← 确定性，零 LLM
  ↓
RawResults → normalize → dedupe → trust     ← 复用既有链
  ↓  workbench/skills/organize_skill.py
整理结果（候选卡片 + trustScore + 来源）
  ↓  workbench/skills/plan_skill.py（+ 可选 LLM 拟草）
执行计划草案 = AI_PROPOSED
  ↓  人工审核（复用 review 契约：approved/rejected/needs_edit + edits 白名单）
USER_APPROVED / USER_EDITED / USER_REJECTED
  ↓  执行/保存（store/export）
EXECUTED（带 reviewedBy/humanEdited/reviewedAt）
```

状态映射（现有 → Workbench）：

| 现有 pipeline | Workbench 语义 |
| --- | --- |
| pipeline 自动 approved（`reviewedBy: "auto"`） | AI_PROPOSED（无人工痕迹时不出现在终态） |
| 人工 approved（无 edits） | USER_APPROVED |
| 人工 approved（有 edits） | USER_EDITED |
| 人工 rejected | USER_REJECTED |
| 执行完成 | EXECUTED（新增终态，由 task_service 持久化） |
| needs_edit / pending | 队列中（沿用 review queue 机制） |

## 4. 关键设计决策（草案）

1. **workbench/ 与 pipeline/ 平级且只单向依赖** — workbench import pipeline，禁止反向；禁止 workbench 复制 pipeline 代码。
2. **task_service 用 SQLite 而非文件 JSON** — 复用 `pipeline/store/` 的单写者事务模式，但独立 DB 文件（如 `pipeline/data/workbench.db`），避免与 events 表耦合。
3. **ai_provider 是接口不是依赖** — Phase 0 不接任何大模型；未来接入时必须满足 TOKEN_STRATEGY 的四项记录义务（触发条件/频率上限/缓存/降级），且输出一律 `llmAssisted: true`。
4. **search skill 默认走 fixture/demo 模式** — 比赛演示零网络依赖；real/hybrid 模式由环境变量切换（GORGON_SEARCH_MODE），与现状一致。
5. **前端迁移策略** — 从 `origin/feature/v1-frontend-build` checkout `app/` + `AGENTS.md` 到新分支（9 commits 无重叠文件，零冲突），不 merge v1fb 分支本身，避免把 9 个 docs/test commits 的历史带进基线。
6. **UI 不重设计** — 复用 AppShell + 设计系统 token，新增 screens（目标输入 / 审核中心 / 任务进度），legacy `ui_kits/app/` 保持为 reference 不动。

## 5. 桌面打包路线评估（§11 结论）

评估矩阵（★=推荐）：

| 方案 | 开发量 | Python 复用 | 新依赖 | 包体 | Windows 难度 | 维护 | 比赛适用 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| PWA | 零 | n/a | 零 | 零 | 无需打包 | 低 | 手机端最佳，桌面无独立 exe |
| ★ pywebview + PyInstaller | 低 | 100% | pywebview, pyinstaller | ~40-60MB | 低（一行 spec） | 低-中 | 单 exe 双击即用，Python 后端原样进包 |
| Electron | 高 | 需 Node 桥 | electron, node runtime | ~150MB+ | 中 | 中 | 重，Team 规模失衡 |
| Tauri | 高 | 需 sidecar | tauri, rust toolchain | ~10-20MB | 中-高（Rust 工具链） | 高 | 包最小但引入 Rust，超出比赛时间预算 |

**推荐路线验证成立**：

```
React/Vite → vite build → app/dist/
                        ↓
Python backend（pipeline/api/server.py 或 workbench 服务）
                        ↓
pywebview（加载 app/dist/ 或 http://127.0.0.1:PORT）
                        ↓
PyInstaller --onefile
                        ↓
Gorgon Workbench.exe
```

理由：现有后端是纯 Python 标准库（零第三方依赖），pywebview 是唯一不要求改后端形态的方案；Tauri 虽在 v1fb ROADMAP 中提过，但 Rust 工具链的引入对比赛阶段是纯开销。注意点：PyInstaller 需排除 `pipeline/data/` 中的缓存/DB 或改为用户数据目录（%APPDATA%）；pywebview 在 Windows 用 WebView2，需确认目标机器有 Edge Runtime（Win10/11 默认自带）。

Phase 0 不实施任何桌面接入。

## 6. 明确不做（Phase 0 边界确认）

- 不实现 Task Router、不接大模型、不接 pywebview（STOP CONDITION）。
- 不重构 pipeline 任何模块。
- 不修改 HUMAN_REVIEW_CONTRACT 协议（状态映射只是文档草案）。
- 不动 legacy `ui_kits/`（含本地未提交的删除，保留给用户处理）。
