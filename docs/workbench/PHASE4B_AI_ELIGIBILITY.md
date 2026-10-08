# Phase 4B — AI Eligibility Gate + Hunyuan Provider

> 目标不是「所有任务都用 AI」，而是建立一条**默认拒绝**的模型调用通道。
> 确定性能力能解决的，本地解决；只有确定性不足、预算允许、缓存未命中的复杂步骤才允许调模型。

```text
Deterministic 能解决
        ↓
    本地处理

Deterministic 不足
        ↓
AI Eligibility Gate        ← 本阶段新增
        ↓
预算允许？                  ← 已有 budget.js，硬上限
        ↓
缓存未命中？                ← 已有 cache.js
        ↓
才调用模型
```

## 交付内容

| 文件 | 作用 |
| --- | --- |
| `app/src/workbench/ai/eligibility.js` | `shouldUseAI(context)` 纯函数闸门（新增） |
| `app/src/workbench/ai/providers/hunyuan.js` | 混元适配器，走统一 `AIProvider` 协议（新增） |
| `app/src/workbench/ai/fallback.js` | cache → deterministic → 明确失败 降级链（新增） |
| `app/src/workbench/ai/index.js` | 显式选择 provider + 宿主环境变量读取（改） |
| `app/tests/ai-eligibility.test.mjs` | 31 条单测（新增） |
| `app/tests/demo-chain.test.mjs` | 7 条比赛链路回归（新增） |

## 4B.1 闸门

`shouldUseAI(ctx)` 是**纯函数**，无网络、无 localStorage、无 React，输出
`{ eligible, reason, purpose, estimatedCost }`。判定顺序（先硬性否决，后考虑复杂度）：

1. `aiEnabled=false` → `AI_DISABLED`
2. skill 在 `AI_FORBIDDEN_SKILLS` → `SKILL_FORBIDDEN`
3. purpose 不在 `AI_ALLOWED_PURPOSES` → `SKILL_NOT_ALLOWED`
4. 输入为空 → `EMPTY_INPUT`
5. 预算耗尽 / 输入 token 超上限 → `BUDGET_EXCEEDED`
6. 上次确定性尝试已失败 → 允许（`ELIGIBLE_COMPLEX`）
7. `intent === "unknown"` → 允许（`ELIGIBLE_UNKNOWN_INTENT`）
8. 确定性置信度 ≥ 0.8 且输入不长 → 拒绝（`DETERMINISTIC_SUFFICIENT`）
9. 输入 ≥ 1200 字符 → 允许（`ELIGIBLE_LONG_INPUT`）
10. 置信度低 + 命中复杂度词 → 允许（`ELIGIBLE_COMPLEX`）
11. 输入 < 400 字符且无复杂度信号 → 拒绝（`INPUT_TOO_SHORT`）

关键常量：`LONG_INPUT_CHARS=1200`、`SHORT_INPUT_CHARS=400`、`HIGH_CONFIDENCE=0.8`。

## 4B.2 默认禁止 AI 的任务

`AI_FORBIDDEN_SKILLS = [search, trust, dedupe, validate, state, route]`

这直接保证比赛 Demo 的可信度：**「帮我找上海 AI 活动」这类任务 AI_CALLS = 0**。
日期识别、价格识别、地区解析、URL 提取、去重、Trust、Schema 校验、任务状态机
全部留在本地。

## 4B.3 允许 AI 的场景

`AI_ALLOWED_PURPOSES = [summarize, extract, plan, generate]`

对应任务书：复杂 summarize / 复杂 extract / 复杂 plan / 高质量 write / unknown intent fallback。
注意 `route` **不在**允许列表内——意图识别仍由确定性 Router 完成。

## 4B.4 Hunyuan Provider

```text
Skill
 ↓
AI Eligibility Gate
 ↓
AI Client（预算 + 缓存 + usage）
 ↓
HunyuanProvider
```

- 实现与 MockProvider **完全相同**的 `AIProvider` 协议，上游无法区分二者。
- **凭证处理**：`apiKey` 只从调用方 / 宿主环境变量（`GORGON_AI_API_KEY`）读入，
  代码内无任何硬编码 Key。`resolveProviderConfig` 读取 `process.env`——而
  `process` 在 Vite 浏览器产物中不存在，该分支在浏览器里是死代码，
  **结构上保证密钥不可能被打进前端 bundle**。
- **显式选择**：只有 `provider === "hunyuan"` **且** 处于 real 模式 **且** 有 Key 时才返回
  HunyuanProvider；其余情况（未配置 / 未知 provider 名）一律降级 MockProvider。
  绝不因为「用户请求了 real」就发起盲目的网络调用。
- 网络调用通过**注入的 transport**（`config.fetch`）完成，因此单测完全离线，
  测试套件里也不需要真实 Key。
- 环境变量：`GORGON_AI_PROVIDER` / `GORGON_AI_API_KEY` / `GORGON_AI_MODEL` / `GORGON_AI_BASE_URL`。

未配置凭证时保持 MockProvider 完整可运行，不阻塞项目。

## 4B.5 降级链

```text
cache  →  deterministic fallback  →  明确失败
```

可恢复错误码：`AI_TIMEOUT` / `AI_RATE_LIMITED` / `AI_NETWORK_ERROR` /
`AI_PROVIDER_ERROR` / `AI_NOT_CONFIGURED` / `AI_EMPTY_RESPONSE`。

- provider **抛异常**也降级（runner 不会因此崩）。
- 没有 deterministic 兜底时返回 `ok:false` + 明确 code，**不编造结果**。
- `aiAssisted` / `provider` / `model` / `cached` / `fallbackReason` 全程透传，
  UI 可诚实区分「本地处理」与「AI Assisted」。

## Gate 验证结果（本轮实测）

```text
UNIT                  = 165/165 PASS   (127 基线 + 31 新增 + 7 demo-chain)
TEST_BUILD            = 18/18 PASS     (含 secret 扫描)
VITE_BUILD            = PASS  (1731 modules, 404.85 kB)
API_KEYS_IN_REPO      = 0
NEW_REGRESSIONS       = 0

比赛 Demo 链路（真实 Runner + 真实 Skills）：
  ROUTE                    = ["search","plan"]  intent=workflow
  GATE search              = eligible=false  reason=SKILL_FORBIDDEN
  STATUS                   = completed
  AI_CALLS_DURING_RUN      = 0        ← 核心指标
  SEARCH_EXECUTED_ONCE     = 1
  SOURCES                  = 2  (demo 标记 [true,true])
  PLAN                     = 消费 search 结果，4 步定制计划
  TIMELINE_EVENTS          = 12
```

## 已知环境问题（非代码缺陷）

`npm run build` 在清理既有 `app/dist/` 时会失败，报
`[safe-delete] spawnSync ... genimark-trash ... ETIMEDOUT`。
这是运行沙箱拦截删除操作导致，**与本次代码无关**：1731 个模块全部转换成功，
换用独立 outDir 构建即 PASS（404.85 kB，与基线一致）。发布打包阶段需注意此点。
