# Phase 7 — Competition Demo Stabilization

> 目标：让**比赛演示**可复现、可离线、可自证：
> 一条固定指令 → Router → Search → Sources/Trust → Plan → Result → Timeline → Completed。
> 并让界面上**每一个步骤都诚实标明**是「本地处理」还是「AI Assisted」。

## 1. 复现的演示任务（`?demo=1`）

`app/src/lib/demo-mode.js`

- `DEMO_TASK_GOAL` = 比赛指定指令（逐字）：
  `帮我找上海未来一周值得参加的 AI/创业活动，优先免费、适合认识开发者，并帮我制定参加计划。`
- `ensureDemoTask(deps)`：**幂等**种入一条任务；重复进入不会堆积重复项。
- 种入的任务带 `metadata.demo_seed_v1` 与 `metadata.isDemo`，并被显式置回 `CREATED`
  （保证它**可运行**——这正是演示需要的起点状态）。
- 三个仓储调用（`listTasks` / `createTask` / `updateTask`）**全部可注入**，
  因此可在纯 Node 单测，且不会误写到真实仓储（早期只注入两个，导致 DEMO 标记写错位置，已修正）。
- `initDemoMode()` 在 `main.jsx` 中于 `createRoot` **之前**调用，
  这样 App 首次读取仓储时任务已经存在。种入失败被吞掉，绝不白屏。

## 2. Local vs AI Assisted（处理方式面板）

`app/src/screens/TaskDetailScreen.jsx` 新增「处理方式」区，数据**全部来自真实技能 metadata**，不猜测：

| 字段 | 含义 |
| --- | --- |
| `method` | `local_extractive` / `rule_based` / `llm` … |
| `aiAssisted` | 是否**真的**由模型产出内容 |
| `simulated` | 模型输出被判为模拟（不可信）→ 内容被丢弃，仅记录 |
| `aiUsageTotal` | Token 用量 |
| `aiFallbackReason` / `aiReason` | 降级原因 / 闸门理由 |

汇总行示例（实测）：`共 2 个步骤 · 其中 AI 辅助 0 个 · 确定性本地处理 2 个`

测试锚点：`workbench-detail-processing-view`、`-item`、`-label`、`-simulated`、`-reason`、`-summary`。

## 3. 诚实的 AI 边界（回归守护）

比赛链路必须 **AI_CALLS = 0**：`search` 被闸门硬拒；`plan` 为规则式。
唯一的例外是**真实** provider（`hunyuan` 等）才允许替换技能内容；
`MockProvider` 的输出一律记 `simulated: true` 并**丢弃内容**，
因为一次「模拟替换」曾把定制的 4 步计划污染成模型腔的模板文本。
`app/tests/demo-chain.test.mjs` 永久守护这一点。

## 4. E2E 失败根因与修复（真实 bug，非环境）

比赛链路 E2E 曾 7 条失败（§71/§72）。定位过程与结论：

1. **点击目标错误（主因）**：`[data-testid="workbench-task-item"]` 是**整行外壳**，
   本身没有 `onClick`；可点击目标是行内「详情」按钮 `workbench-task-open`。
   点外壳**静默无效果** → 详情不打开 → 运行/面板断言全部失败。
2. **`waitFor` 不抛错**：CDP `waitFor` 超时返回 `false`（不抛），
   于是链路继续往下跑，在空列表上 `.find(...)` 取到 `undefined` 才崩。
   故改为**把 waitFor 的结果当断言**，并显式等待目标行出现。
3. **重载后的竞态**：`location.reload()` 会重启应用，
   必须重新等待 shell 再驱动导航，否则点击可能落在尚未挂载的 DOM 上（真实 flake）。
4. **404 过滤失效**：资源类错误挂在 `Log.entryAdded` 上，
   其**文本**是通用文案，真正的 URL 在 `entry.url` 字段里——
   原来的 favicon 过滤永远匹配不到。已在 `pipeline/tests/cdp_session.mjs` 中把
   `[url]` 追加进文本，使 404 立刻可诊断（并消除了那条级联 404）。

诊断方法：先用一次性脚本 dump 出种子状态 → 逐个断言 DOM 真实内容 →
定位到「详情未打开」→ 再回头修选择器与等待逻辑（而非猜测）。

## 5. 验收（实测）

```text
UNIT            = 205/205 PASS
TEST_BUILD      = 18/18 PASS (含 secret 扫描)
VITE_BUILD      = PASS (1737 modules)
WORKBENCH_E2E   = 93/93 PASS
LEGACY_E2E      = 58/58 PASS
NEW_REGRESSIONS = 0
API_KEYS_IN_REPO= 0
```

关键通过项（真实运行，非模拟）：

```text
PASS §70: ?demo=1 seeds exactly one demo task — count=1
PASS §70: reload does not duplicate the demo task (idempotent) — count=1
PASS §71: demo task runs to 已完成 through the real engine
PASS §71: router panel — 多步工作流 / ✓ 智能搜索 / ✓ 本地规划
PASS §72: every step is labelled 本地处理 or AI Assisted — ["本地处理","本地处理"]
PASS §72: summary distinguishes local vs AI-assisted counts
```

## 6. 环境注意（非代码缺陷）

`npm run build` 在本沙箱清理 `app/dist` 时被删除拦截（`ETIMEDOUT` / `genie-trash`）。
改用 `vite build --emptyOutDir=false` 即 PASS，产物一致（420.30 kB / gzip 123.84 kB）。
Phase 8 打包脚本已能在 `app/dist` 已存在时直接复用，规避该问题。

另：沙箱中曾出现**外部进程占用 4173 端口**，导致遗留 E2E 连到陌生服务而假失败。
清理端口后 58/58 全绿——纯环境问题，与代码无关。
