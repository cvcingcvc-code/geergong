# PHASE 1 — Workbench Shell

```text
PHASE=1
NAME=WORKBENCH_SHELL
BASE_COMMIT=648d8c0
BRANCH=feature/workbench-competition
STATUS=PASS
```

## 做了什么

1. **干净 worktree**：`C:\Users\lin\Documents\Gorgon-Workbench` 独立检出
   `feature/workbench-competition`（HEAD=648d8c0），原 `Gorgon-Recovered`
   worktree 全程只读，未 reset/clean/stash，未提交其任何脏文件。
2. **Phase 0 文档迁移**：仅复制 `WORKBENCH_BASELINE.md` /
   `WORKBENCH_REUSE_MAP.md` / `WORKBENCH_TARGET_ARCHITECTURE.md` 三份到
   本 worktree `docs/workbench/`。
3. **文件级前端迁移**（非分支 merge）：`git restore --source=origin/feature/v1-frontend-build -- app AGENTS.md`。
4. **Workbench 信息架构落地**（新增 `data-workbench-nav` 导航层，详见下）：
   - 工作台首页（`WorkbenchHome`）：hero 文案 + 主任务输入框（核心视觉）+
     4 个真实快捷任务 + 最近任务（本地数据、如实标注）+ 工作台状态条
     （如实显示 `AI Engine: Not connected`）。
   - 我的任务（`TasksScreen`）：本地新建 / 状态过滤 / draft→ready→completed
     手动流转。**不是**正式 Task State Machine（Phase 2）。
   - 智能搜索：**完整复用**现有 `NaturalSearchScreen`（真实
     `POST /api/search`），未重写任何搜索引擎逻辑。
   - 审核中心（`ReviewCenterScreen`）：UI Shell，DEMO / PREVIEW 标记卡片，
     批准/修改/拒绝仅切换本地状态。未接 Python Human Review（Phase 6）。
   - 工作记录（`HistoryScreen`）：本地活动流（创建任务/用户批准等），
     无 event sourcing。
   - 模型与设置（`SettingsScreen`）：应用信息 / 版本 / API 地址 / 运行模式 /
     `AI Provider: Not configured`。**无任何模型 Key 输入**。
5. **Desktop-first 响应式**：桌面 = Workbench sidebar（240px，复用现有
   `gg-sidebar` 体系）+ 内容列；平板 = 图标 rail；移动 <768px =
   tabbar（工作台/搜索/任务/更多）+ 底部 Drawer（更多入口）。
   复用 `useResponsive()` 单一断点源，未新增任何 UI 框架。
6. **品牌零重做**：沿用现有 logo tile、design tokens、字体、圆角、`Icon`
   体系（仅向 lucide 映射表增量注册 8 个新图标名）。

## 兼容契约（为什么默认页还是发现页）

`e2e_v1_frontend.mjs` 的 58 个用例是本阶段硬约束：

- **启动页保持 `discover`**（`.gg-disc-card` 契约）。WorkbenchHome 通过
  导航进入，不抢默认位。默认首页切换留给 Phase 1 新测试稳定后再做。
- **五个 `data-gg-nav` 键全部保留**：`discover/search/smart/weekend/map`。
  桌面 sidebar 的「专业能力」分组直接展示 discover/weekend/map；
  search/smart 以隐藏兼容入口存在（`display:none` 但可被测试驱动）。
- **移动端 tabbar 的「搜索」label 保留**，点击仍进入 SearchScreen。
- 新旧概念未合并成一个枚举：Workbench 用 `data-workbench-nav` +
  `WORKBENCH_TO_LEGACY` 轻量映射（智能搜索 → legacy `smart`），legacy
  screen registry 原样保留，App.jsx 为增量修改（~60 行新增逻辑）。

## 复用了什么

- `NaturalSearchScreen` / `SearchScreen` / `DiscoverScreen` /
  `MyWeekendScreen` / `MapScreen` / `ActivityDetailScreen`：零逻辑改动。
- `AppShell.jsx` 的 `DesktopHeader`：仅增加可选 `onWorkbenchHome` prop
  （不传时渲染与原来完全一致），sidebar/tabbar 结构复用其 CSS 类。
- `store.js`（GorgonStore）：**未改动一个字节**；Workbench 本地状态在
  独立命名空间 `gorgon_workbench_*`（新文件 `workbench-store.js`）。
- `useResponsive`、`Button` 等 DS 组件、`gg-*` 全部 CSS。

## 没有做什么（按 §17 禁令）

- 无 LLM / Agent / Task Router / Multi-Agent / LLMProvider / Token Budget
- 无 OpenAI / DeepSeek / Claude / Gemini / 任何模型 Key 输入
- 无 RAG / 向量库 / MCP / 浏览器 Agent
- 无 pywebview / PyInstaller / Electron / Tauri / 云同步 / 用户登录
- 无 pipeline/ Python 修改；无 `pipeline/data/` 触碰（E2E 为 demo 模式只读）
- 无 UI 框架新增（无 AntD/MUI/Tailwind/shadcn）
- 无 Logo 重设计 / 设计系统重构

## 测试结果

| 套件 | 结果 |
| --- | --- |
| OLD unit (`npm test` 原 27) | 27/27 PASS |
| NEW unit (`tests/workbench-shell.test.mjs`) | 16/16 PASS |
| TOTAL unit | **43/43 PASS** |
| BUILD_SMOKE (`test:build`) | 18/18 PASS |
| OLD E2E (`test:e2e`) | **58/58 PASS**（shell 改造后复跑稳定） |
| NEW E2E (`test:e2e:workbench`) | **32/32 PASS** |
| VITE_BUILD | PASS（329→357 KB，gzip 96→103 KB） |
| NEW_REGRESSIONS | **0** |

- BASELINE_E2E_FLAKE=1（迁移基线首跑 57/58，同一 case 复跑即过，未改业务代码）
- 新 E2E 选择器策略：`data-testid` / `data-workbench-nav` / `data-gg-nav` /
  aria-label，不依赖中文文案精确匹配、DOM 位置或 CSS class。
- Workbench E2E 覆盖：契约键存在、首页渲染、本地建任务、导航切换、
  智能搜索真实出结果、任务流转与过滤、审核卡片本地批准、历史记录、
  设置无密钥输入、移动端无横向溢出、双端 console errors = 0。

## 页面清单

| 路由（tab） | 文件 | 说明 |
| --- | --- | --- |
| `home` | `app/src/screens/WorkbenchHome.jsx` | 新增 |
| `tasks` | `app/src/screens/TasksScreen.jsx` | 新增 |
| `search` | `app/src/screens/NaturalSearchScreen.jsx` | 复用（经映射） |
| `review` | `app/src/screens/ReviewCenterScreen.jsx` | 新增 |
| `history` | `app/src/screens/HistoryScreen.jsx` | 新增 |
| `settings` | `app/src/screens/SettingsScreen.jsx` | 新增 |
| legacy 五屏 | 原 6 个 screen 文件 | 未改逻辑 |

其余新增：`app/src/workbench/navigation.js`（导航配置+映射层）、
`app/src/store/workbench-store.js`（本地存储）、`tests/workbench-shell.test.mjs`、
`tests/e2e_workbench_shell.mjs`。

修改：`App.jsx`（增量 ~120 行）、`AppShell.jsx`（DesktopHeader 可选 prop）、
`Icon.jsx`（8 个图标名）、`package.json`（+1 script）。

## 已知问题

1. **BASELINE_E2E_FLAKE=1**：旧 E2E 在基线首跑出现过 1 例时序失败
   （复跑即过），与本阶段改动无关，按 §6 规则记录不处理。
2. 移动端「我的周末」badge 数字在 drawer 中为静态同步计数（与旧
   tabbar 行为一致），不影响契约。
3. `showOnMap` 从 Workbench 页触发时会先退回 legacy tab 高亮，视觉上
   侧栏高亮跳到「地图」——行为正确（地图页确实打开了），Phase 2 统一
   导航状态机时再收敛。
4. Workbench 侧栏的 search/smart 两个兼容入口为 `display:none`（不可见
   但可测试驱动）；若未来 E2E 改用可见入口断言，需要把「智能搜索」与
   「搜索」的关系再显性化。

## Phase 2 输入

- 本地任务模型（title/status/source/createdAt）已是 Phase 2 正式 Task
  Model 的形状起点；`workbench-store.js` 的 API 边界刻意收窄。
- 「开始任务」当前只落本地 + 明示「任务引擎将在下一阶段接入」，Phase 2
  在此挂 Task Router 即可，无需改 UI 合同。
- 默认首页切到 WorkbenchHome 的前置条件已满足（新 E2E 32 例覆盖
  Workbench 路径），建议 Phase 2 开头执行。
- 兼容契约清单见上文「兼容契约」节，Phase 2 重建导航时必须继续满足。
