# Phase 5 — AI-assisted Skills

> 现有 5 个 Skills 获得 AI 增强，**结构不变**：`Search / Extract / Summarize / Plan / Write`。
> 不创建几十个 Agent，不做插件市场，不重写 pipeline（§14）。

## 核心设计：AI 是「可选升级」，不是「默认路径」

新增单一桥接层 `app/src/workbench/ai/assist.js` 的 `withAiAssist()`，四个 AI-capable
Skill 全部经由它调用模型，从而让**闸门 + 客户端 + 降级链**在四处行为完全一致。

```text
Skill.execute(ctx, deps)
        ↓
   withAiAssist({ skill, purpose, input, confidence, deterministic })
        ↓
   shouldUseAI(...)          ← 复用 Phase 4B 闸门，零重复逻辑
        ↓
   deps.aiClient 存在？       ← opt-in！
   ├─ 否 → 纯本地，同步返回
   └─ 是 → runWithFallback → 真实 provider？
            ├─ 是 → 结果标注 AI Assisted
            └─ 否 → 保留本地结果 + 标注 fallback 原因
```

### 两条不可妥协的诚实性规则

1. **没有 client 就没有 AI。** `deps.aiClient` 由 Runner 透传，**默认为空**。
   App 目前不注入 client，因此整个比赛 demo 保持 100% 确定性（AI_CALLS = 0）。
2. **只有真实模型才能替换结果内容。** `MockProvider` 的 canned 文本**永远不会**
   覆盖本地结果——否则一个未配置模型的任务会静默降级。
   Mock 调用只记录 `simulated: true`，内容丢弃。

> 这条规则是被测试**真实抓出来的**：初版允许 mock 覆盖内容，导致定制 4 步计划被
> 替换成 40 步 mock 填充文本。已修复，并由
> `demo-chain.test.mjs` 的 "even WITH a client injected, the demo plan keeps its real content" 守护。

## 同步 / 异步契约

`withAiAssist` **不走 AI 时返回普通对象**（保持 Skill 同步可调用），
只有真正发生模型调用才返回 Promise。Runner 侧 `await skill.execute(...)`
两种都兼容，因此既有同步单测零改动通过。

## 各 Skill 策略

| Skill | AI 策略 | 置信度 | 备注 |
| --- | --- | --- | --- |
| `search` | **永不 AI** | — | 结构性未接入桥接层；闸门亦硬拒绝 |
| `extract` | 本地规则优先，识别不到才考虑 AI | 命中 0.9 / 未命中 0.1 | 正则已解决 ⇒ 零模型调用 |
| `summarize` | 短文本 `local_extractive`，长文本 AI | 长 0.3 / 短 0.85 | 阈值 1200 字符 |
| `plan` | 简单 `rule_based`，复杂 AI | 有检索结果 0.6 / 通用 0.9 | **优先消费 previousResults** |
| `write` | 简单 `template`，复杂 AI | 0.75 | **只生成文字，无外部写入** |

`plan` 始终消费上一步 `search_results`（`metadata.source="search_results"`），
**禁止重新 Search**；`write` 的 `metadata.externalWrite` 恒为 `false`。

## AI 标识（metadata）

```js
{
  method,          // 保持旧字段：local_extractive / regex / rule_based / template
  aiAssisted,      // 仅真实 provider 为 true
  simulated,       // 走了 mock/占位 provider，但内容被丢弃
  aiProvider,      // "hunyuan" 或 null
  aiModel,
  aiCached,
  aiUsage: { inputTokens, outputTokens },
  aiUsageTotal,
  aiReason,        // 为什么保持本地（UI 徽标依据）
  aiFallbackReason,// 降级原因（AI_RATE_LIMITED 等）
}
```

UI 依据 `aiAssisted` 显示「AI Assisted」或「本地处理」，依据 `aiReason` /
`aiFallbackReason` 解释原因——两者不会混淆。

## Gate 验证结果（本轮实测）

```text
UNIT=184/184 PASS   (127 基线 + 31 eligibility + 7 demo-chain + 18 ai-assisted + 1 回归守护)
TEST_BUILD=18/18 PASS
VITE_BUILD=PASS (410.71 kB，基线 404.85 kB)

Case A  找上海 AI 活动                 → search，AI 调用 0 ✅
Case B  找上海 AI 活动并制定参加计划      → search×1 → plan，消费检索结果 ✅
Case C  长文本摘要                      → eligibility/budget/usage/cache 全覆盖 ✅
Case D  Provider unavailable           → 回落本地结果，不崩，标注原因 ✅

NEW_REGRESSIONS=0
```
