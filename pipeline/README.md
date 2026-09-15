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
| `python pipeline/run.py --search-demo` | 跑信息检索 Demo（PHASE 4），产出 `generated-search-demo.js` |
| `python pipeline/run.py --search "…" [--today YYYY-MM-DD]` | 用自然语言跑一遍检索链路 |
| `python pipeline/api/server.py --port 8000` | 静态服务 + `POST /api/search`（一个进程顶两个） |
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
  search/                 信息检索层（PHASE 4）
    models.py             SearchRequest / SearchPlan / RawSearchResult / …
    planner.py            确定性 Query Planner（+ LLMQueryPlanner 预留接口）
    provider.py           SearchProvider / Fixture / Manual（不接真实网络）
    adapter.py            RawSearchResult -> canonical raw（只改名，不清洗）
    ranker.py             可解释排序（权重集中配置）
    service.py            search_events()：全链路编排
    demo.py               固定的 Demo 场景
    fixtures/             录制的检索结果（26 条）
  route/provider.py       RouteProvider 接口 + MockRouteProvider（不接真实地图）
  planning/models.py      Itinerary 契约（只定义，不实现求解器）
  api/server.py           静态服务 + /api/search（stdlib，无依赖）
  export/gorgon_export.py approved -> activities.json + generated-data.js
  data/
    raw/                  输入：把来源 JSON 丢进来（当前为 30 条 DEMO）
    normalized/           normalize 阶段输出
    work/                 中间产物（ingested/cleaned/deduped/scored）
    review/               review_queue.json（人工审核队列）
    approved/             activities.json（最终 canonical 数据）
    search/               检索 Demo 结果（demo_search.json）
  tests/                  单元测试 + E2E 测试
  docs/                   ARCHITECTURE.md / TOKEN_STRATEGY.md
```

## 输出

1. `pipeline/data/approved/activities.json` — canonical schema，含 trustScore/trustReasons/duplicateOf。
2. `ui_kits/app/generated-data.js` — `window.GORGON_GENERATED_DATA = [...]`。
   前端 adapter（`ui_kits/app/data-adapter.js`）优先使用它；文件缺失或为空时
   自动回退到原 `data.js` DEMO DATA。**data.js 永远不会被覆盖。**
3. `ui_kits/app/generated-search-demo.js` — `window.GORGON_SEARCH_DEMO = {...}`。
   「智能搜索」页在 `/api/search` 不可用时使用它离线回退，并会如实提示。

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

信息检索层（PHASE 4）另有：Query Planner（单/多主题、城市、本周末、免费偏好、地区偏好、query 去重）、
多 provider 合并、同 URL 去重、同一活动不同来源进入既有 dedupe、溯源保留、
排序（主题/地区/时间/价格/可信度各自的方向性）、API 边界、Demo 导出与全链路 E2E。

更多：`docs/ARCHITECTURE.md`、`docs/TOKEN_STRATEGY.md`、`../docs/INFORMATION_RETRIEVAL_CONTRACT.md`。
