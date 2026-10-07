# Gorgon Workbench — PHASE 2: Task Engine Foundation

```text
PHASE=2
NAME=TASK_ENGINE_FOUNDATION
BRANCH=feature/workbench-competition
BASE=63a6860
STATUS=PASS
```

Phase 2 建立了 Workbench 的统一任务底座：正式 Task 数据模型、状态机、
Repository、Timeline、Task Detail、本地持久化与默认首页切换。
**未实现** Task Router / Skills / LLM / Agent（见文末边界）。

---

## 1. Task Schema（§2）

文件：`app/src/workbench/task-model.js`

```js
{
  id,            // crypto.randomUUID()（含确定性 fallback，见 uuid.js）
  version: 2,

  title,         // 自动从 goal 截断生成（>24 字符加省略号）
  goal,          // 用户完整原文

  status,        // 正式状态机词汇（见下）

  createdAt, updatedAt, startedAt, completedAt,

  steps: [],     // §11
  result: null,  // §13
  sources: [],   // §12
  metadata: {},
  timeline: [],  // §9
  failureReason: null,
}
```

- `id` 禁止数组 index；`crypto.randomUUID()` 不可用时提供 RFC-4122 v4
  形状的确定性 fallback（`app/src/workbench/uuid.js`），零第三方依赖。
- `title = makeTitleFromGoal(goal)`：空白归一 + 24 字符截断。

## 2. State Machine（§3–§6）

纯函数层，不读 localStorage、不碰 DOM、不依赖 React，可单独测试。

正式状态（7 个）：

```text
created | planning | ready | running | review_required | completed | failed
```

合法流转表（`TRANSITIONS`）：

```text
created         -> planning | ready | failed
planning        -> ready | failed
ready           -> running | failed
running         -> completed | failed | review_required
review_required -> running
completed       -> (终态)
failed          -> (终态)
```

- `created -> ready` 是 Phase 2 本地任务捷径，明确允许。
- `completed -> running`、`failed -> completed`、
  `review_required -> completed` 全部禁止。
- 核心函数：
  - `canTransition(from, to)` — 纯谓词
  - `transitionTaskState(task, to, opts)` — 纯 task->task，非法流转抛
    `InvalidTransitionError`；自动写 `status_changed` 事件、
    `startedAt`（首次 running）、`completedAt`、`failureReason`。
- `cancelled` 未加入（当前 UI/行为不需要，任务书允许按需添加）。

## 3. Task Repository（§7）

文件：`app/src/store/task-repository.js`。唯一持久化 + 变更层，
React 页面一律经由它（或 workbench-store.js 门面），禁止直接读写
localStorage JSON。

API：`createTaskEntry() getTask() listTasks() updateTask()
transitionTask() tryTransitionTask() deleteTask() appendTimelineEvent()
addTaskStep() updateTaskStep() setTaskResult() addTaskSource()
getStorageHealth() resetTaskStorage()`。

- `updateTask()` 显式剥离 `status` 字段——状态只能走状态机，无法绕过。
- `tryTransitionTask()` 为 UI 提供非抛出变体（非法 -> null no-op）。

## 4. Persistence & Versioning（§8）

```text
localStorage["gorgon_workbench_tasks_v2"] = { "schemaVersion": 2, "tasks": [...] }
```

## 5. Migration（§8/§30）

`migrateV1TasksToV2()`（task-model.js）：首次读取时自动执行。

- Phase-1 状态映射：`draft -> created`、`ready -> ready`、
  `completed -> completed`（completed 直接恢复并写迁移事件）。
- 自动补齐 `id / goal / version=2 / timeline / steps / sources / metadata`。
- v1 旧 key `gorgon_workbench_tasks` **只读不写、永不删除**——旧任务
  不会因升级静默消失（有单测覆盖）。
- 已是 v2 形状的数据只做 normalize，不重复迁移。

## 6. Timeline（§9/§10）

事件结构 `{ id, type, timestamp, message, metadata }`，类型固定：

```text
task_created | status_changed | step_added | step_updated
| source_added | result_saved | task_failed
```

自动记录：创建 -> `task_created`；状态流转 -> `status_changed`；
失败额外写 `task_failed`；步骤/来源/结果操作各写对应事件。
Phase 3+ 直接复用，无需再造历史系统。

## 7. Steps / Sources / Result（§11–§13）

- Steps: `{ id, title, status(pending|running|completed|failed),
  createdAt, updatedAt, result }`，TaskDetail 可人工添加/推进。
- Sources: `{ id, type(web|local|search|user|system), title,
  url?, provider?, addedAt }`，url 可空。
- Result: `{ type(text|json|search_results|plan), content, createdAt }`，
  UI 当前使用 text/json。

## 8. UI 变更（§14–§21）

| 文件 | 变更 |
| --- | --- |
| `TaskDetailScreen.jsx`（新增） | 标题/目标/状态/时间、步骤、来源、结果、时间线；模拟按钮只渲染**合法**流转（非法流转按钮不出现，终态无按钮） |
| `TasksScreen.jsx` | 正式状态模型；筛选 全部/进行中(created+planning+ready+running)/待审核/已完成/失败；点击行/详情按钮进 TaskDetail |
| `WorkbenchHome.jsx` | 输入框真正 `createTask()`：goal=原文、title 自动截断、status=created，然后跳转 TaskDetail，如实显示「等待任务引擎」 |
| `HistoryScreen.jsx` | 默认「最近活动」= 聚合所有 Task.timeline 按 timestamp 倒序；Phase-1 平面 log 保留为次要区块；零 mock |
| `ReviewCenterScreen.jsx` | 读取真实 `review_required` 任务，展示 title/goal/等待确认；「继续任务」走 `review_required -> running`；未引入 AI_PROPOSED/USER_APPROVED（Phase 6） |
| `SettingsScreen.jsx` | 如实显示 Task Engine: Local / Ready、持久化 LocalStorage(v2 key)、Schema Version 2、AI Provider: Not configured |
| `App.jsx` | 默认首页切到 workbench（`?legacy=1` 进 discover）；任务状态变更全部经状态机 |

## 9. 默认首页与 Legacy 兼容（§17/§18）

- 正常启动 -> Workbench home。
- `/?legacy=1` -> 与 Phase 1 完全一致的 discover 启动（真实 Discover
  页面，没有为测试埋假卡片）。
- `data-gg-nav` / `.gg-disc-card` / 移动端「搜索」tab 契约原样保留。

## 10. 测试（§25–§27）

- 新增 `tests/task-engine.test.mjs`（28 测试）：schema、合法/非法流转、
  纯度、timeline 自动记录、500 上限、持久化 round-trip、migration、
  steps/sources/result、损坏 JSON 隔离、未知 schemaVersion、缺 id 容错、
  §34 Phase-3 接口链。
- `tests/workbench-shell.test.mjs` 更新到 v2 词汇（断言意图 1:1 保留）。
- Workbench E2E：54 项（新增默认首页、真实创建->详情、状态机按钮、
  非法按钮不渲染、timeline、刷新恢复、review_required 流、legacy=1 等）。
- 旧 E2E：入口改为 `/?legacy=1`，**58/58 全部保留、断言零删减**，
  discover/search/smart/weekend/map 五套能力原样验证。

## 11. 错误恢复与数据边界（§31/§32）

- 损坏 JSON / 未知 schemaVersion / 缺 id：安全降级空运行态 + console
  警告；坏 payload 归档到 `<key>.corrupt-N`，**永不自动 clear**。
- Timeline 上限 500 事件/任务，超限保留最新（`MAX_TIMELINE_EVENTS`）。
- 私有模式/配额错误降级内存态，与 Phase 1 策略一致。

## 12. Build Gate 结果（§28）

```text
LEGACY_UNIT=        56/56（store/district/activity-view 既有 + 更新后 shell 16）
NEW_TASK_TESTS=     28/28（task-engine.test.mjs）
TOTAL_UNIT_TESTS=   72/72
LEGACY_E2E=         58/58（入口 ?legacy=1，能力零减少）
WORKBENCH_E2E=      54/54
BUILD_SMOKE=        18/18
VITE_BUILD=         PASS（vite 5.4.21，bundle 382.52 kB / gzip 109.46 kB）
NEW_REGRESSIONS=    0
```

## 13. 边界确认（§22/§23/§24/§29）

```text
PIPELINE_CHANGED=false        （git status pipeline/ 干净）
PIPELINE_DATA_CHANGED=false
LLM_ADDED=false               （git grep openai/deepseek/anthropic 空）
ROUTER_ADDED=false
NEW_DEPENDENCIES=0            （package.json / lock 零变更）
```

## 14. Known Issues

- `planning` 状态当前只有状态能力，无真实规划者（Phase 3 Router 接入）。
- Timeline 事件 metadata 为宽松对象，Phase 3 可再收紧 schema。
- 旧 E2E 截图文件（docs/screenshots/*.png）随运行刷新，属预期产物。

## 15. Phase 3 Interface（§34）

Phase 3 可直接使用（已被 §34 链路单测锁定）：

```js
import * as Repo from "./store/task-repository.js";
Repo.createTaskEntry(goal);            // 或经 workbench-store.addTask
Repo.transitionTask(id, "planning");
Repo.addTaskStep(id, { title });
Repo.addTaskSource(id, { type: "search", title, url });
Repo.setTaskResult(id, { type: "text", content });
Repo.transitionTask(id, "completed");
```

Phase 3 接 Skill 不需要再重构 Task Engine。
