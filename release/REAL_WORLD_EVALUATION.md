# Real-World Evaluation — Gorgon Workbench `1.0.0-competition`

**日期** 2026-10-09/10 · **HEAD** `42f7926`（+ 1 处 Phase-10 数据准确性修复，见 §6）

> 任务四的执行结果。**全部场景都通过真实 `runTask` + 真实确定性 Skills 执行**，
> 用一次性 harness（`build/qa/scenario_harness.mjs`，不提交进 release）产出机器可读证据。
> 没有模拟输出被描述成真实联网搜索成果；没有虚构 AI 调用。

---

## 1. 执行方式说明（先讲清楚，避免误读）

| 项 | 事实 |
| --- | --- |
| 引擎 | 真实 `task-runner.js`（`runTask`）+ 真实 `task-router.js` + 真实 5 个 Skill |
| 检索后端 | 注入 `demoSearch()`（`providerMode:"demo"`，返回 2 条内置样例）——与桌面程序默认 `demo` 模式一致 |
| AI 调用 | **0**。桌面程序默认不注入 `aiClient`；harness 里除 C3 外均不注入，C3 注入的是 `MockProvider`（离线占位，内容被丢弃） |
| 基线对照 | 真实执行了一次 `WebSearch`（联网搜索上海 AI 活动）作为"普通工具"基线 |
| 模拟输出 | 无。所有结果要么来自确定性算法，要么来自真实 WebSearch，均有据可查 |

---

## 2. 场景 A —— 寻找信息并生成行动计划

**用户原始需求**：
`帮我找上海未来一周值得参加的 AI/创业活动，优先免费、适合认识开发者，并帮我制定参加计划。`

**输入**：上述整句（即比赛演示指令，逐字）。

**数据来源**：内置 demo 数据（`demoSearch()`，`providerMode:"demo"`）。非真实联网结果。

**实际结果**（真实引擎执行，machine-verified）：

```text
路由    : workflow → ["search", "plan"]
          理由: 检测到「找、活动」→ search；检测到「计划」→ plan
状态    : completed
search  : method="api", isDemo=true, 调用 1 次, 返回 2 条来源（均标 DEMO）
plan    : method="rule_based", source="search_results", aiAssisted=false
          产出 4 步: 查看排名靠前的 2 个候选 / 核对活动时间与报名要求 /
                    结合偏好选择 / 完成报名并记录
AI 调用 : 0（search 被闸门硬拒 SKILL_FORBIDDEN；plan 规则式）
```

**是否调用真实 AI**：否（0 次模型调用）。
**是否使用 Mock 数据**：是（demo 数据，UI 标 DEMO，不冒充真实结果）。
**是否触发人工审核**：否（search/plan 均非外部动作，不需要 Proposal）。
**失败及恢复**：无失败。

**结论**：链路完整跑通，且每一步都诚实标注"本地处理"与 DEMO 来源。

---

## 3. 场景 B —— 先搜索再规划，规划引用已有结果、不重新搜索

**用户原始需求**：同上（search + plan 组合）。

**关键断言（全部真实执行验证）**：

```text
searchCalls = 1            ← 全任务只调用了 1 次搜索
plan.metadata.source = "search_results"   ← 规划明确声明"基于检索结果"
plan 第 1 步 = "查看排名靠前的 2 个候选"   ← 数字 2 来自检索结果的条数，而非硬编码
```

**为什么这个断言可信**（源码级 + 实测双重）：
- `plan-skill.js` 的 `buildPlan()` 先找 `previousResults` 里 `type==="search_results"`
  的步骤，找到则生成 `planFromSearch(count)`；`plan` 从不自己调 `deps.search`。
- 单测 `demo-chain.test.mjs` "search executes exactly once" 与
  "plan consumes the search result instead of re-searching" 永久守护。
- harness 实测 `searchCalls=1`，plan 内容引用候选数 2。

**是否调用真实 AI**：否。
**是否使用 Mock 数据**：是（demo 2 条）。
**是否触发人工审核**：否。
**失败及恢复**：无。

**结论**：规划**不重新搜索**，消费的是上一步的检索结果。这是 Workbench 区别于
"每次提问都重新生成"的普通聊天工具的关键行为。

---

## 4. 场景 C —— 信息不足 / 能力外 / 模型不可用时的安全降级

分三个子场景，全部真实执行：

### C1. 能力外（未知意图）—— 不猜、安全停下

**输入**：`帮我炒一盘宫保鸡丁`（超出 5 个技能的领域）。

```text
路由    : intent="unknown", skillIds=[]  (空)
状态    : ready（不进入 running，不产生步骤）
search  : 0 次调用
结果    : 无结果，无失败，任务停在「就绪」等待用户下一步
```

**结论**：Router 返回空且不猜（§8）。系统明确"这不在我能做的范围"，而不是硬凑一个回答。

### C2. 检索后端离线 —— 诚实失败，不编造

**输入**：`帮我找上海周末的活动`，但注入 `offlineSearch()`（`kind:"unavailable"`）。

```text
路由    : ["search"]
状态    : failed
failureReason = "检索服务不可用（未连接 / 离线）"
时间线  : skill_started → skill_failed → to_failed
结果    : 无结果（不填充任何假数据）
```

**结论**：离线时明确报错并进入 `failed` 状态，绝不伪造"找到 N 条"。

### C3. 复杂任务但模型未配置 Key —— 本地兜底 + 丢弃模拟输出

**输入**：`请深度总结分析这份长材料的优缺点，并帮我写一份完整的行动方案与详细步骤。`

注入 `createAIClient({ provider: "mock" })`（离线占位 provider，无真实 Key）。

```text
路由    : ["summarize", "plan", "write"]
状态    : completed（3 步全部本地完成）
summarize: method="local_extractive", aiReason="DETERMINISTIC_SUFFICIENT"
plan     : method="rule_based", aiReason="DETERMINISTIC_SUFFICIENT"
write    : method="template", aiReason="ELIGIBLE_COMPLEX"
AI 调用 : 0 次真实模型调用
关键诚实点: MockProvider 的输出 aiAssisted=false + simulated（内容被丢弃），
           保留的是确定性本地结果，绝不把"没调模型"说成"AI 辅助"
```

**结论**：没有模型 API 时，系统仍能用确定性能力完成任务，并在每一步说明
"为什么没有用 AI"（`aiReason`）。这正是任务书问的"没有模型 API 时还能完成哪些任务"的答案。

---

## 5. 基线对照（不使用 Workbench）

用一次真实的联网搜索（`WebSearch`）执行同一需求，作为"普通工具"基线。

| 维度 | 普通工具（一次 WebSearch） | Gorgon Workbench（场景 A） |
| --- | --- | --- |
| 任务完成 | 返回 4 个网页摘要，需人工逐个点开 | 自动拆成 2 步：搜索 + 计划 |
| 是否生成行动计划 | **否**（只有链接 + 摘要，需人自己规划） | **是**（自动生成 4 步行动清单） |
| 步骤可追溯 | 无（模型黑盒生成摘要） | 有（timeline 记录每一步 + 来源） |
| 来源可核验 | 部分（有 URL，但未结构化） | 有（结构化 sources，带 DEMO 徽标） |
| 是否标明"本地/AI" | 无此概念 | 每步标 `本地处理` / `AI Assisted` + 原因 |
| 能力外时 | 会硬编一个菜谱（模型自由发挥） | 明确"未知意图"停下不猜 |
| 离线可用 | 否（需联网） | 是（demo 模式 + 确定性引擎） |
| 耗时（人工） | 需人工阅读 4 页 + 自行规划 | 引擎自动完成（秒级） |

**基线对照结论（BASELINE_COMPARISON = PASS，方向性）**：

- Workbench 的**增量价值**不是"搜索更快"，而是：把搜索**和**规划接成一条
  可审计的链路，且强制区分"本地确定性处理"与"AI 辅助"，能力外时诚实停下。
- **未能量化的部分**：任务完成耗时、错误数量的精确对比需要真实多轮用户测试，
  本次仅完成 1 轮基线对照，**未做统计显著性**。因此"效率提升"这一点
  标记为**待验证假设**，不写成已证明结论。

---

## 6. 执行中发现并修复的真实缺陷（任务一规则 4 授权）

**缺陷**：`task-runner.js` 成功分支只把 step 的 `status` + `result`（内容）写入
repository，**丢弃了 Skill 返回的 `metadata`**（`method` / `aiAssisted` /
`aiReason` / `aiUsageTotal` / `simulated` / `isDemo`）。

**影响**：`TaskDetailScreen` 的「处理方式」面板读取 `step.metadata.aiAssisted` 等
字段，但数据从未被持久化——比赛核心卖点"每步标明本地/AI + 原因"实际显示不出原因。

**证据**：修复前 harness 实测 search step 的 `method` 应为 `"api"` 却得到 `null`；
plan step 的 `aiReason` 应为字符串却得到 `null`。

**修复**：runner 成功分支增加 `metadata: Object.assign({}, step.metadata, result.metadata)`，
保留 skillId 的同时合并 skill 返回的 metadata。**最小 diff（1 处）**。

**回归测试**：`task-runner.test.mjs` 新增 1 条
"skill metadata (method / aiReason) is persisted onto the step"。
**结果**：单元测试 205 → **206/206 PASS**，新增回归 **0**。

---

## 7. 场景验收汇总

| 场景 | 结果 | 真实 AI | Mock 数据 | 人工审核 | 失败/恢复 |
| --- | --- | --- | --- | --- | --- |
| A 找信息 + 计划 | ✅ PASS | 0 调用 | demo | 否 | 无 |
| B 搜索→规划引用结果 | ✅ PASS | 0 调用 | demo | 否 | 无 |
| C1 未知意图 | ✅ PASS（停下） | 0 调用 | — | 否 | 无 |
| C2 离线 | ✅ PASS（诚实失败） | 0 调用 | — | 否 | 无 |
| C3 无 Key 兜底 | ✅ PASS（本地+丢弃模拟） | 0 真实调用 | mock（内容丢弃） | 否 | 无 |

**REAL_SCENARIOS = 5/5 通过**（3 个主场景，C 拆为 3 个子场景）。

---

## 8. 诚实边界（未验证项，不冒充 PASS）

1. **真实联网检索**（segmentfault/豆瓣/活动行/Meetup 等 provider）**未在本轮实测**——
   需要 `SEARCH_API_KEY` 或可达网络，桌面程序默认 `demo` 模式。真实 provider 的
   可用性、延迟、字段完整性是**待验证项**（代码路径存在，测试用的是 mock）。
2. **真实混元模型调用**未实测（无 `GORGON_AI_API_KEY`）。AI 辅助路径有完整单测覆盖
   （`ai-assisted-skills.test.mjs` 18 条，用注入式 fetch 离线测），但**真实付费模型的
   端到端调用**是待验证项。
3. **多人真实用户测试**未做——效率提升、易用性是**假设**，非已证明结论。
4. **跨设备同步**不是当前产品能力（RELEASE_NOTES 已声明单机单人）。

---

## 9. 复现

```bash
cd app
node ../build/qa/scenario_harness.mjs        # 输出 5 场景结构化 JSON
node --test "tests/task-runner.test.mjs"     # 含新增 metadata 持久化回归测试
```
