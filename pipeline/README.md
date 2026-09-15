# Gorgon Data Pipeline — MVP

> ⚠️ **DEMO DATA** — 本目录及所有输出当前全部为演示用途，不抓取任何真实网站。

一条命令把原始活动数据变成 Gorgon 前端可以直接读取的数据：

```bash
python pipeline/run.py
```

## 流程

```
RAW DATA → NORMALIZE → CLEAN → DEDUPE → TRUST SCORE → REVIEW QUEUE → APPROVED → GORGON DATA
```

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `python pipeline/run.py` | 全流程跑完并输出 `generated-data.js` |
| `python pipeline/run.py --stage normalize` | 只跑到 normalize（单阶段调试） |
| `python pipeline/run.py --stage dedupe` | 只跑到 dedupe |
| `python pipeline/run.py --stage trust` | 只跑到 trust |
| `python pipeline/run.py --export-gorgon` | 强制重写 `ui_kits/app/generated-data.js` |
| `python -m unittest discover -s pipeline/tests` | 跑全部测试 |

## 目录

```
pipeline/
  run.py                  CLI 入口（编排，不放业务逻辑）
  schema.py               Canonical Activity Schema（PHASE 2）
  ingest/                 SourceAdapter 接口 + JsonSourceAdapter
  normalize/              text / datetime / location / activity（确定性规则）
  clean/cleaner.py        去 HTML/垃圾字符/重复标签，不改语义
  dedupe/deduplicator.py  两层去重（exact / near，difflib，不删数据）
  trust/scorer.py         0-100 可解释评分（每分都有 reason）
  review/queue.py         按分数路由 approved / needs_review
  export/gorgon_export.py approved -> activities.json + generated-data.js
  data/
    raw/                  输入：把来源 JSON 丢进来（当前为 30 条 DEMO）
    normalized/           normalize 阶段输出
    work/                 中间产物（ingested/cleaned/deduped/scored）
    review/               review_queue.json（人工审核队列）
    approved/             activities.json（最终 canonical 数据）
  tests/                  单元测试 + E2E 测试
  docs/                   ARCHITECTURE.md / TOKEN_STRATEGY.md
```

## 输出

1. `pipeline/data/approved/activities.json` — canonical schema，含 trustScore/trustReasons/duplicateOf。
2. `ui_kits/app/generated-data.js` — `window.GORGON_GENERATED_DATA = [...]`。
   前端 adapter（`ui_kits/app/data-adapter.js`）优先使用它；文件缺失或为空时
   自动回退到原 `data.js` DEMO DATA。**data.js 永远不会被覆盖。**

## Raw 数据约定

`data/raw/*.json` 支持两种形态：

```json
[ { "id": "x1", "title": "...", "startDate": "9月20日", ... } ]
```

```json
{ "DEMO_DATA": true, "activities": [ ... ] }
```

字段允许缺失，缺失即 null；pipeline 不为填字段而编造事实。

## 测试

```bash
python -m unittest discover -s pipeline/tests -v
```

覆盖：免费价格格式、地区统一、日期格式、exact/near 去重、同标题不同日期不误判、
trust 加减分、review 路由、输出 JSON/JS 合法性。

更多：`docs/ARCHITECTURE.md`、`docs/TOKEN_STRATEGY.md`。
