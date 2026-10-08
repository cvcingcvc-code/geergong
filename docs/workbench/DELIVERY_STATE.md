# Delivery State

> Gorgon Workbench — 连续交付主状态文件（每阶段覆盖更新）。
> 下一轮**只读这个文件**即可恢复上下文，不要重新扫描整个 repo。

```text
CURRENT_PHASE=PHASE 4B (AI_ELIGIBILITY_GATE + HUNYUAN_PROVIDER) — GATE GREEN, 等待 commit
CURRENT_HEAD=52f9434 (未提交，4B 变更在工作区)

LAST_COMPLETED=
  PHASE 0/1/2/3/3B/4A  (见 NIGHT_SHIFT_STATE.md，Gate 全绿)
  TASK-4B.1 AI Eligibility Gate (shouldUseAI 纯函数, 11 步判定)
  TASK-4B.2 HunyuanProvider (注入 transport, 显式选择, 无 Key 降级 mock)
  TASK-4B.3 Fallback 链 (cache → deterministic → 明确失败)
  TASK-4B.4 31 条单测 + 7 条比赛链路回归测试
  验证 127→165 单测全绿, 0 回归

CURRENT_TASK=Phase 4B commit + 更新 DELIVERY_STATE
NEXT_TASK=PHASE 5 — AI-assisted Skills (extract/summarize/plan/write 接闸门+降级链)

TEST_STATUS=
  UNIT            = 165/165 PASS
  TEST_BUILD      = 18/18 PASS (含 secret 扫描)
  VITE_BUILD      = PASS (1731 modules, 404.85 kB)
  WORKBENCH_E2E   = 运行中
  LEGACY_E2E      = 待跑
  NEW_REGRESSIONS = 0
  API_KEYS_IN_REPO= 0

KNOWN_ISSUES=
  - npm run build 清理既有 app/dist/ 时被沙箱删除拦截
    (ETIMEDOUT / genie-trash)，非代码缺陷：换独立 outDir 构建即 PASS。
    Phase 8 打包时需处理。

BLOCKERS=none

DELIVERY_READINESS=NOT_READY

LAST_UPDATE=2026-10-08 13:45 GMT+8
```

## Phase 4B 核心结论（实测，非推断）

- 比赛 Demo 真实链路（真实 Runner + 真实 Skills）：**AI_CALLS_DURING_RUN = 0**。
- `search` 被 `AI_FORBIDDEN_SKILLS` 硬拒绝，reason=`SKILL_FORBIDDEN`。
- Router 对 Demo 目标输出 `["search","plan"]`，search 恰好执行 1 次，plan 消费检索结果。
- 混元凭证只走宿主 `process.env`（浏览器中 `process` 不存在 → 该分支为死代码，
  结构上保证 Key 不会进前端 bundle）。

## 已确认事实（无需重扫）

- 仓库路径 `/c/Users/lin/Documents/Gorgon-Workbench`，分支 `feature/workbench-competition`。
- AI 模块（Phase 4A）已就绪且**保持 dormant**：未被 App/store/skills/router import，
  因此 Settings 的 "Not configured" 与 E2E `workbench-status-ai` 断言天然不受影响。
- Skills 五件套全部 deterministic：`search`(network read) / `extract`(regex) /
  `summarize`(local_extractive) / `plan`(rule_based) / `write`(template)。
- Router 为纯函数，MAX_SKILLS_PER_TASK=3，unknown 时返回空 skillIds（不猜）。
- Runner 是 Skills 与 Task 层之间**唯一写入口**，全部依赖可注入 → 可在纯 Node 单测。
- plan-skill 已优先消费 `previousResults`（`metadata.source="search_results"`），
  且 E2E Scenario B 已守护「search 恰好执行一次」。
- 运行时：Node v22.22.2、Python 3.13.14（Phase 8 打包可用）。

## 交付优先级（时间不足时按此砍）

```text
P0 软件能启动 / Task 能执行 / Search+Plan Demo 稳 / EXE 能打开
P1 AI Assisted / Review Center / UI polish
P2 高级功能
```
