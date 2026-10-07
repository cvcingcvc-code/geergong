# Gorgon Workbench — PHASE 3: Deterministic Task Router + Skills

```text
PHASE=3
NAME=TASK_ROUTER_AND_SKILLS
BRANCH=feature/workbench-competition
BASE=63a6860
STATUS=PASS
```

Phase 3 在 Phase 2 任务引擎之上，接入**确定性**的任务路由与技能执行框架：
任务到达后由纯函数 Router 决定调用哪些 Skill，Runner 按顺序执行并把结果
写回 Task 层。全程 **零 LLM / 零模型 / 零外部依赖**，可单元测试、可在无网
环境下运行本地技能。

> 核心原则（任务书 §0）：**先让任务引擎会工作，再让 AI 变聪明。**
> 本阶段只做「确定性执行骨架」，不引入任何 AI Provider（见文末边界与 STOP）。

---

## 1. 设计约束（§5–§9 / §33 / §48–§49）

```text
ALLOWED : Task Router · Skill Registry · Skill Runner · Search Skill
          Deterministic Extract/Summarize/Plan · Template Write · Execution UI
          real task execution（真实跑，不是模拟）
FORBIDDEN: LLM / OpenAI / DeepSeek / Claude / Gemini · Prompt Engineering
           Agent Loop · Multi-Agent · Vector DB · RAG · MCP
           browser automation · 外部写入
GATES   : PIPELINE_CHANGED=false · PIPELINE_DATA_CHANGED=false
          LLM_ADDED=false · NEW_DEPENDENCIES=0
```

- Router 是**纯函数**：无 API、无 localStorage、无 React、无 LLM。相同输入
  永远得到相同输出（已在 `router.test.mjs` 锁定）。
- `MAX_SKILLS_PER_TASK = 3`；Router 每任务**只跑一次**；无循环、无递归（§48）。
- Runner 是 Skill 与 Task 层之间**唯一的写入者**（§3 架构铁律）：Skill 永远
  不能改 Task / localStorage / React state，因此未来 Phase 4 的 LLM 技能
  也无法破坏 Task 状态。

---

## 2. 架构（§3）

```text
Task (created)
   │
   ▼  runTask(taskId, options)
┌─────────────────────────── Task Runner ───────────────────────────┐
│ created ─▶ planning ─(routeTask)─▶ ready ─▶ running ─▶ completed    │
│                                          │  └▶ failed               │
│  路由结果存 metadata.router；每个 skill 建一个 step（metadata.skillId） │
│  执行期写入：routing_started/completed · skill_started/completed/    │
│             failed · task_execution_completed（§23）                 │
└───────────────────────────────────────────────────────────────────┘
   │ 单 skill → 其 result 直接作为 task.result
   │ 多 skill → workflow_result 信封（§22）
   ▼
Repository（task-repository.js）→ localStorage v2
```

Runner **依赖注入**：`repository / router / registry / search / now` 全部可经
`options` 传入，因此可在纯 Node 中用一个 in-memory MockRepository 跑完整
单测，完全不碰 localStorage / DOM / LLM。

---

## 3. Task Router（纯函数）

文件：`app/src/workbench/task-router.js`

- `MAX_SKILLS_PER_TASK = 3`
- `RULES`：5 条关键词表（search / extract / summarize / plan / write）。
- `PRIORITY = { search:0, extract:1, plan:2, summarize:3, write:4 }` —— 命中
  超过上限时按优先级截断，再恢复 RULES 顺序，保证**确定性输出顺序**。
- `routeTask({ goal })` 返回
  `{ intent, skillIds, confidence, reasons }`：
  - `skillIds` 为空 → `intent="unknown"`（**绝不猜测**，§8）；
  - 单 skill → `intent = skillId`；
  - 多 skill → `intent = "workflow"`。
- `validateSkillIds(ids)`：按 registry 过滤（供手动选择用）。

关键词示例：

| skill    | 命中关键词（节选）                       |
| -------- | ---------------------------------------- |
| search   | 找、搜索、查询、活动、机会、黑客松、附近 |
| extract  | 提取、待办、日期、截止时间、链接         |
| summarize| 总结、概括、整理重点、摘要                |
| plan     | 计划、规划、安排、拆解、步骤、路线图      |
| write    | 写、生成文案、起草、回复、邮件            |

---

## 4. Skill 契约（§2 / §11）

文件：`app/src/workbench/skills/skill-base.js`

```js
// 成功
{ ok: true, skillId, summary, steps?, sources, result, metadata }
// 失败（诚实，绝不编造，§12）
{ ok: false, skillId, error: { code, message } }
```

- `createSkillResult(skillId, {...})` / `createSkillError(skillId, code, message)`
- 能力声明常量：`CAP_LOCAL`（本地正则/模板）、`CAP_NETWORK_READ`（只读检索）。
- 失败**只报契约错误**，不抛不崩；Runner 捕获 `SKILL_THREW` 并标记 task 失败。

### Registry（§3）

文件：`app/src/workbench/skills/registry.js`

静态注册表，构建期 `import` 全部 5 个 skill（**无 eval / 无插件 / 无动态下载**）。
导出 `getSkill(id) / listSkills() / listSkillIds() / hasSkill(id) / SKILL_IDS /
SKILL_COUNT`，重复 id 抛错。

---

## 5. 五个 Skill

| Skill        | 文件                | 能力        | 方式                       | 网络 |
| ------------ | ------------------- | ----------- | -------------------------- | ---- |
| 智能搜索     | `search-skill.js`   | CAP_NETWORK_READ | 复用 `api.js#searchActivities`（与 NaturalSearchScreen 同一客户端，无第二套） | 只读 |
| 本地提取     | `extract-skill.js`  | CAP_LOCAL   | 正则抽取 dates/times/urls/amounts/emails/phones/todos | 无   |
| 本地总结     | `summarize-skill.js`| CAP_LOCAL   | 抽取式摘要（local_extractive），保序、确定性 | 无   |
| 本地规划     | `plan-skill.js`     | CAP_LOCAL   | 规则模板 5 步；有 search 结果时生成贴合计划 | 无   |
| 模板写作     | `write-skill.js`    | CAP_LOCAL   | 模板工作日志/周报，`externalWrite:false` | 无   |

- **Search 诚实性（§12）**：`unavailable → SEARCH_OFFLINE`、`error →
  SEARCH_API_ERROR`、provider 抛错 → `SEARCH_PROVIDER_ERROR`、后端未配置
  （`deps.search` 显式为 null）→ `SEARCH_NOT_CONFIGURED`、空目标 →
  `SEARCH_EMPTY_GOAL`。后端返回 demo 数据时 `detectDemo()` 置 `sources[].demo=true`，
  UI 显示 **DEMO 数据** 徽标。
- **本地技能零网络**：extract/summarize/plan/write 仅做本地计算，E2E §42 已
  验证不出现 DEMO 徽标、不依赖后端。

---

## 6. Task Runner（§18–§22 / §48–§49）

文件：`app/src/workbench/task-runner.js`

`runTask(taskId, options)` 流程：

1. 校验任务存在、非 `running`（并发守卫：已 running 直接拒绝 `TASK_ALREADY_RUNNING`）、
   仅 `created` / `ready` 可运行。
2. **created → planning**：写 `routing_started`；路由（或手动 `skillIds`）；
   把路由结果写入 `metadata.router`；写 `routing_completed`；按 skillIds 建 step。
3. **→ ready → running**：逐个执行 skill（按 `skillIds` 顺序，各自最多一次）。
   每个 skill：写 `skill_started`、置 step `running`、执行、写
   `skill_completed`/`skill_failed`、汇聚 sources/result。
4. 结果汇聚（§22）：单 skill → 其 result 直接作为 task.result；
   多 skill → `{ type:"workflow_result", content:[...] }` 信封。
5. 全成功 → `completed` + `task_execution_completed`；任一失败 → `failed` +
   `failureReason`，后续 skill 不再执行。

`metadata.step` 通过 `metadata.skillId` 与 skill 一一对应（§20），保证结果
可追溯到具体 skill。

---

## 7. UI 变更（§18/§24/§25/§27）

| 文件 | 变更 |
| --- | --- |
| `TaskDetailScreen.jsx` | 新增「运行任务」按钮（`workbench-detail-run`）；运行后展示**任务路由（确定性规则）**面板（`workbench-detail-router`：任务类型/使用工具/判断依据）；手动选择工具区（`workbench-detail-manual-{sid}`，5 个确定性本地技能，无需模型）；来源上的 **DEMO 数据** 徽标（`workbench-detail-demo-badge`）；执行期时间线渲染 §23 六类事件 |
| `App.jsx` | `runTaskEngine` 异步包装：`WBStore.runTask` → 刷新 `wbTasks`/`wbLog`；`onRun` 注入 TaskDetail |
| `workbench-store.js` | 新增 `runTask(id,{skillIds})`，经 `runTaskEngine`（注入 `searchActivities`） |
| `task-model.js` | 新增 `EXECUTION_EVENT_TYPES`；`makeResult` 增加 `workflow_result` 类型；`makeSource` 增加 `demo` 标记 |
| `lib/api.js` | 守卫 `import.meta.env`（Node 安全），浏览器行为不变 |
| `SettingsScreen.jsx`/`WorkbenchHome.jsx` | 如实显示「任务路由 Deterministic / 技能 5 个 / 搜索后端 已接入 / AI Provider: Not configured」 |
| `components/Icon.jsx` | 补齐 `play/compass/flag/check-circle/alert-triangle/link/list-plus/map/git-branch` 等图标白名单（避免 E2E 零错误失败） |

> 模拟按钮（Phase 2 的状态机流转）保留用于手动状态演练；真实执行走「运行任务」。
> `workbench-status-ai` 仍显示 `Not connected`、Settings 仍显示 `Not configured`——
> 既有的 E2E 契约零破坏。

---

## 8. 测试（§37–§43）

- `tests/router.test.mjs`（13）：纯函数路由、上限截断、unknown、workflow intent。
- `tests/skills.test.mjs`（17）：search（mock 成功/空结果/unavailable/error/thrown/
  null 后端/空目标）、extract、summarize、plan、write 全部确定性。
- `tests/task-runner.test.mjs`（8）：MockRepository 注入式跑通 created→…→completed、
  多 skill 信封、并发守卫、失败链、手动选择、unknown_intent。
- `tests/build-smoke.mjs`（18）：生产构建冒烟。
- **Workbench E2E 新增 §40/§41/§42（13 项）**：真实驱动 Router+Skills 在浏览器执行——
  - §40 真实搜索（demo 后端）路由到 search，跑完 已完成，router 面板显示智能搜索，
    DEMO 徽标出现，时间线记录路由+技能+完成事件；
  - §41 搜索+规划工作流，两 step，结果包 `workflow_result` 信封，时间线记录两次
    skill_started；
  - §42 本地提取（无网络），router 显示本地提取，无 DEMO 徽标，结果含结构化日期。

---

## 9. Build Gate 结果（§54）

```text
UNIT_TESTS=       110/110（Phase 2 的 72 + Phase 3 新增 38）
  router=13  skills=17  runner=8   既有 72
BUILD_SMOKE=      18/18
VITE_BUILD=       PASS（vite 5.4.21）
WORKBENCH_E2E=    69/69（Phase 2 基线 56 + §40/§41/§42 新增 13 项 Phase 3 场景）
LEGACY_E2E=       58/58（入口 ?legacy=1，能力零减少）
NEW_REGRESSIONS=  0
```

## 10. 边界确认（§5 / §48 / §54）

```text
PIPELINE_CHANGED=false        （git status pipeline/ 干净）
PIPELINE_DATA_CHANGED=false
LLM_ADDED=false               （无任何 AI Provider / openai / deepseek / anthropic）
AGENT_LOOP_ADDED=false
NEW_DEPENDENCIES=0            （package.json / lock 零变更，无 xstate/redux/... ）
```

## 11. Known Issues / 后续

- Search 的「lazy import api.js」仅用于脱离 Runner 的独立调用；浏览器内始终由
  Runner 注入 `searchActivities`，不会触发第二套客户端。
- 本地技能结果质量受正则/模板限制，属于确定性基线；AI 增强留给 Phase 4+。
- Timeline 执行事件 schema 已固定（§23），Phase 6 人工审阅可复用。

## 12. STOP（任务书硬性约束）

**Phase 3 完成即停止。** 不自动进入 Phase 4，不实现任何 LLM / AI Provider /
Agent Loop。下一步若需智能，应在新分支显式开启，并复用本阶段的 Router + Runner
骨架（Skill 契约不变，仅新增 AI 类 skill 并经注册表注册）。
