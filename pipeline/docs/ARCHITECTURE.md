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

## 未来扩展点

- `ingest/base.py` 已定义 `SourceAdapter`（fetch / parse / to_raw_activity）。
  `WebSourceAdapter`、`WechatSourceAdapter`、`ManualSourceAdapter` 已占位，本阶段不实现真实抓取。
- 审核队列 `review_queue.json` 未来可接 admin UI。
- trust 评分只改 `trust/scorer.py` 的 POINTS/PENALTIES 表即可调权。
