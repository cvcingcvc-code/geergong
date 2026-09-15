# Gorgon Data Pipeline — Architecture (MVP)

```
Sources                    data/raw/*.json（JsonSourceAdapter；未来 Web / Wechat / Manual）
  ↓
Ingest                     ingest/base.py + ingest/json_source.py
  ↓  raw activities（canonical 字段名，脏值允许）
Normalize                  normalize/activity.py（组合 text / datetime / location / price 规则）
  ↓  status="normalized"，解析不了的值置 null，绝不猜
Clean                      clean/cleaner.py
  ↓  去 HTML / 垃圾字符 / emoji / 重复标签；语义原样保留，不做 AI 改写
Dedupe                     dedupe/deduplicator.py
  ├─ Layer 1 exact：title_key + date + venue 全同 → status="rejected"，duplicateOf 指向 canonical
  └─ Layer 2 near：title 相似度 ≥0.82 且同日期且同区/同场馆 → status="needs_review"
  ↓  记录永不删除，重复者带 duplicateOf + duplicateConfidence
Trust                      trust/scorer.py
  ↓  0-100，每分对应一条 named reason（trustReasons），含跨来源冲突检测
Review                     review/queue.py
  ├─ score ≥ 80            → approved
  ├─ 50 ≤ score < 80       → needs_review（medium）
  ├─ score < 50            → needs_review（low_confidence）
  ├─ duplicate candidate   → needs_review
  └─ 跨来源冲突            → needs_review
  ↓  review/review_queue.json（人工审核队列）
Approved                   data/approved/activities.json（canonical，含 trust 元数据）
  ↓
Export                     export/gorgon_export.py
  ↓  ui_kits/app/generated-data.js  =  window.GORGON_GENERATED_DATA = [...]
Gorgon App                 ui_kits/app/data-adapter.js
     generated 有数据 → 用 generated；否则 → fallback 回 data.js 的 DEMO DATA
```

## 设计原则

1. **每个阶段单独可跑、可测**：`python pipeline/run.py --stage <name>`；阶段间通过
   `data/work/*.json` 传递，任何一步坏了不用全跑。
2. **run.py 只有编排**：业务逻辑全部在各模块里，run.py 不写规则。
3. **确定性优先**：normalize / clean / 基础 dedupe / 日期 / 价格 / 校验全部是纯规则，
   详见 `TOKEN_STRATEGY.md`。
4. **数据可追溯**：每条记录带 sourceName / collectedAt / trustReasons / duplicateOf，
   重复记录永不删除。
5. **前端安全**：pipeline 挂了不影响 Demo——generated-data.js 缺失即回退 data.js，
   data.js 永不被 pipeline 触碰。

## Canonical Activity Schema

见 `pipeline/schema.py`（PHASE 2 完整字段清单）。status 取值：
`raw → normalized → needs_review → approved / rejected`。

## 信息检索层（PHASE 4）

自然语言需求 → 检索计划 → 多来源候选 → **进入上面同一条管道** → 排序。

```
用户一句话
  ↓  SearchRequest（允许缺字段；只有 query 时自动 parse）
  ↓  plan_search()     确定性 Query Planner，3-8 条 query，不接 LLM
  ↓  SearchProvider    FixtureSearchProvider / ManualSearchProvider（不接真实网络）
  ↓  merge             同 resultId / 同 URL 先去重（检索层）
  ↓  adapter           只改名，把结果变成 canonical raw activity
  ↓  normalize → clean → dedupe → trust → review   ← 完全复用，未复制一份
  ↓  SearchCandidate   分桶：approved / needs_review / duplicate_candidate / rejected
  ↓  rank_candidates() relevance·trust·time·location·freshness·price，权重集中配置
  ↓  RankedEvent       0-100 finalScore + 中文推荐理由
```

关键约定：

1. **不重写管道**：检索层只做召回与编排，清洗/去重/可信度/人审规则仍然只有一份。
2. **排序 ≠ 可信度**：`trust` 回答"信息可不可信"，ranking 回答"适不适合这个用户"，两者分开输出。
3. **人审优先**：审核队列里的记录绝不当成正式推荐，排在 `approved` 之后并标「待核验」。
4. **可解释**：每个分数都能拆到一条 named 理由（ranking 用中文理由，trust 用 token）。
5. **溯源不丢**：每条候选带着 `provenance`（哪些来源、哪些 query 找到它）。

契约与字段定义见 `../docs/INFORMATION_RETRIEVAL_CONTRACT.md`。

## 未来扩展点

- `ingest/base.py` 已定义 `SourceAdapter`（fetch / parse / to_raw_activity）。
  `WebSourceAdapter`、`WechatSourceAdapter`、`ManualSourceAdapter` 已占位，本阶段不实现真实抓取。
- `pipeline/search/provider.py` 的 `SearchProvider` 是接真实检索后端（API / 爬虫）的唯一入口，
  换 provider 不需要动 planner / ranking / API。
- `pipeline/search/planner.py` 的 `LLMQueryPlanner` 只留接口：未来要做语义扩展时才接 LLM。
- `pipeline/route/provider.py` 的 `RouteProvider` 只留接口（默认 `NullRouteProvider` 拒绝作答），
  未来接真实地图时实现它即可；`pipeline/planning/models.py` 已预留一日路线契约。
- 审核队列 `review_queue.json` 未来可接 admin UI（已接）。
- trust 评分只改 `trust/scorer.py` 的 POINTS/PENALTIES 表即可调权；
  ranking 只改 `search/ranker.py` 的 `RANKING_WEIGHTS` / 各评分表即可调权。
