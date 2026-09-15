# GORGON — 信息检索契约 (INFORMATION RETRIEVAL CONTRACT)

> 阶段：GORGON INFORMATION RETRIEVAL — PHASE 4
> 状态：已实现（fixture provider / 离线）
> 代码：`pipeline/search/`

---

## 1. 这一层要解决什么

在这之前，Gorgon 是「已有活动数据的清洗 + 审核系统」。
这一阶段让它可以接受**自然语言需求**：

```
用户一句话
  -> 结构化 SearchRequest
  -> 多个检索 Query（SearchPlan）
  -> 多来源候选结果（RawSearchResult）
  -> 进入【现有】normalize / clean / dedupe / trust / review 管道
  -> 按用户需求排序（RankedEvent）
  -> 值得参加的活动
```

**核心约束：不重写管道。**
检索层只负责「召回」，所有清洗、去重、可信度、人审规则仍然只有一份，位于既有的
`pipeline/normalize|clean|dedupe|trust|review/`。

**本阶段不包含**：真实爬虫、真实地图 API、LLM 规划器、向量检索、复杂 Agent 框架。

---

## 2. 对象链

```
SearchRequest ──plan_search()──▶ SearchPlan ──▶ SearchQuery
                                                   │  provider.search()
                                                   ▼
                                            RawSearchResult
                                                   │  adapter.to_raw_activity()
                                                   ▼
                                     canonical RAW activity（既有 schema）
                                                   │
                            normalize → clean → dedupe → trust → route
                                                   ▼
                                            SearchCandidate
                                                   │  ranker
                                                   ▼
                                              RankedEvent
```

| 对象 | 文件 | 职责 |
|---|---|---|
| `SearchRequest` | `models.py` | 用户的原始需求，结构化但**允许缺字段** |
| `SearchPlan` / `SearchQuery` | `models.py` | 只做计划，不抓取 |
| `RawSearchResult` | `models.py` | 一条候选，字段名对齐 canonical raw 名字，值可以很脏 |
| `SearchCandidate` | `models.py` | 走完既有管道后的记录 + 检索溯源 + 分桶 |
| `RankedEvent` | `models.py` | 候选 + 全部可解释分数与推荐理由 |

---

## 3. SearchRequest

```json
{
  "query": "这个周末上海有什么 AI / Agent / Vibe Coding 的活动？最好免费，徐汇附近，下午开始。",
  "city": "上海",
  "topics": ["AI", "Agent", "Vibe Coding"],
  "dateRange": { "type": "relative", "value": "this_weekend" },
  "timePreference": "afternoon",
  "locationPreference": "徐汇",
  "pricePreference": "free_preferred",
  "maxResults": 20
}
```

* **除 `query` 外全部可选**，缺失即为 `null` / `[]`。绝不强制用户填表。
* 只有 `query` 时，服务端会用 `parse_request()` 自动补齐其余字段；显式传入的字段**不会被覆盖**。
* snake_case 别名（`date_range` / `max_results` / `time_preference` …）在入参时同样接受。

| 字段 | 取值 | 说明 |
|---|---|---|
| `topics` | 字符串数组 | 顺序即优先级（第一个最重要），上限影响排序权重 |
| `dateRange.type` | `relative` \| `absolute` | `absolute` 需带 `start`（+可选 `end`） |
| `dateRange.value` | `this_weekend` `next_weekend` `this_week` `next_week` `today` `tomorrow` `weekday:六` | 解析结果写入 `SearchPlan.dateRange`（含 `start`/`end`/`label`） |
| `timePreference` | `morning` \| `afternoon` \| `evening` | 按 `startTime` 划分：`<12:00` / `12:00-17:59` / `>=18:00` |
| `locationPreference` | 区名（如 `徐汇`） | 与活动 `district` 比较 |
| `pricePreference` | `any` \| `free_preferred` \| `free_only` \| `paid_ok` | 只影响**排序**，不过滤掉收费活动 |
| `maxResults` | int，默认 20 | 只限制**返回条数**，不影响统计口径 |

`dateRange` 解析依赖"今天"。`resolve_date_range(request, today=...)` 的 `today` 可注入，
因此 Demo 与测试可复现（默认 `date.today()`）。

---

## 4. Query Planner

`plan_search(request, today=None) -> SearchPlan`

规则（**确定性，无 LLM**）：

1. **城市优先** → 每个 query 都以城市开头（默认 `上海`）。
2. **主题优先** → 按用户提到的顺序取前 3 个 topic：
   * `i=0`：`{city} {topic} 活动 {日期词}`
   * `i=1`：`{city} {topic} {该主题的首选形式} {日期词}`（如 `上海 Agent Meetup 本周末`）
   * `i>=2`：`{city} {topic} 活动`
3. **形式扩展** → 主主题的 1-2 个形式词（`AI` → `Hackathon` / `Demo Day`），不带日期（提高召回）。
4. **地点细化** → 用户给了区名时额外一条：`{city} {primary} 活动 {区名}`。
5. 去重（按文本），**3-8 条**，超限截断；过少才补通用 query。
6. 同义词表在 `TOPIC_LEXICON` / `FORMAT_HINTS`，**只改表即可扩展**，不散落代码。

Demo 输入 `这个周末上海有什么 AI / Agent / Vibe Coding 的活动？...` 的输出：

```
上海 AI 活动 本周末
上海 Agent Meetup 本周末
上海 Vibe Coding 活动
上海 AI Hackathon
上海 AI Demo Day
上海 AI 活动 徐汇
```

`LLMQueryPlanner` 只保留接口（`plan_search` 抛 `NotImplementedError`）。
未来替换 planner 不需要改 provider / ranking / API。

---

## 5. SearchProvider

```python
class SearchProvider:
    name = "base"
    def search(self, query: SearchQuery) -> list[RawSearchResult]: ...
    def search_all(self, queries) -> list[RawSearchResult]: ...
```

本阶段实现：

| Provider | 说明 |
|---|---|
| `FixtureSearchProvider` | 读取 `pipeline/search/fixtures/shanghai_ai_events.json`（默认 provider） |
| `ManualSearchProvider` | 人工/测试显式给一组结果，支持 `match_all=True` |

`RawSearchResult` 字段（对齐既有 canonical raw 名字，便于 adapter 保持极薄）：

```json
{
  "resultId": "sr001",            "providerQuery": "上海 AI 活动 本周末",
  "provider": "fixture:...",      "source": "AI 极客社区", "sourceType": "wechat",
  "sourceTrust": "high",
  "title": "...", "snippet": "...", "url": "...", "registrationUrl": "...",
  "publishedAt": "...", "rawDate": "2026/09/19", "rawTime": "下午2点",
  "rawVenue": "...", "address": "...", "rawLocation": "上海·徐汇",
  "rawPrice": "免费", "organizer": "...", "tags": []
}
```

**Fixture 匹配规则（确定性）**：把 query 与 fixture 的 `providerQuery` 都做归一化
（去空白 + 去掉相对日期词 `本周末/本周/周末/今天/明天/下周末…`）后比较。日期词不携带召回信息，
所以 `上海 Vibe Coding 活动 本周末` 仍能命中记录里的 `上海 Vibe Coding 活动`。
**不做模糊匹配** —— fixture 是"录像"，不是搜索引擎；未录制的 query 返回空列表。

---

## 6. Adapter（进入既有管道）

`pipeline/search/adapter.py` 只做**改名**，不做任何清洗 / 校验 / 打分：

| RawSearchResult | canonical raw activity |
|---|---|
| `resultId` | `id` |
| `title` | `title` |
| `snippet` | `description` |
| `rawDate` / `rawTime` | `startDate` / `startTime` |
| `rawVenue` / `address` / `rawLocation` | `venue` / `address` / `location` |
| `rawPrice` | `price` |
| `organizer` | `organizer` |
| `url` / `registrationUrl` | `sourceUrl` / `registrationUrl` |
| `source` | `sourceName` |
| `tags` | `tags` |

检索溯源写入 `_extra.search`（`resultId` / `providerQuery` / `provider` / `sourceType` / `sourceTrust`），
**只用于溯源与展示，不参与任何规则**。

> `location` 必须保留在顶层：`normalize/location.split_location()` 直接读它，
> 才能得到 `city` / `district`。

---

## 7. 合并（merge）

`merge_raw_results()` 在**检索层**做两级去重，让管道的 dedupe 不会看到同一页两次：

1. `resultId` 相同 → 同一条记录；
2. URL 相同（大小写/末尾斜杠归一化后）→ 同一张列表页被两个渠道收录。

先到先得；丢弃数量写入 `summary.mergedDuplicates`。

"同一活动、不同来源"**不在这里合并** —— 那属于既有 dedupe 的工作（见下）。

---

## 8. 与既有人审闭环的关系（硬规则）

* 检索结果**必须**经过 `normalize → clean → dedupe → trust → route`，与 ingest 路径完全同一套代码。
* **审核队列里的记录不能被当作最终可信推荐。** 分桶：

| bucket | 来源 | 展示规则 |
|---|---|---|
| `approved` | `status == "approved"` | 正式推荐 |
| `needs_review` | 冲突 / 中等可信 / 低可信 | 标「待核验」，**不得混入推荐** |
| `duplicate_candidate` | 有 `duplicateOf` 的记录（含精确重复） | 标「疑似重复」，待人工确认 |
| `rejected` | 被拒且非重复 | 不计入 `results`，仅计数 |

* 排序恒为：`approved` 全部在前，其后才是待核验项（`rank_candidates(..., respect_buckets=True)`）。
* `summary.reviewQueue` 直接复用既有 `route()` 的输出，不另算一套。

---

## 9. Ranking

排序回答的是「**这个活动适不适合当前用户**」，不是「这条信息可不可信」。两者分开展示。

```python
RANKING_WEIGHTS = {          # 全部权重集中在这里，代码里没有魔法数字
    "relevance": 0.35, "trust": 0.25, "time_fit": 0.15,
    "location_fit": 0.10, "freshness": 0.10, "price_fit": 0.05,
}
```

| 分数 | 定义 |
|---|---|
| `relevance` | 主题覆盖度。按 `TOPIC_WEIGHTS = [0.5, 0.3, 0.2]` 归一化（用户先说的主题更重要）；无主题时中性 60 |
| `trust` | 直接取管道 `trustScore`（0-100），不重算 |
| `time_fit` | 时段匹配分（100/45/25）× 日期系数（在范围内 1.0 / 不在 0.35 / 日期未知 0.8） |
| `location_fit` | 命中偏好区 100；同城其它区 60；区域未知 40；其它城市 15；无偏好 90 |
| `price_fit` | 按 `pricePreference` 查表（`free_preferred`：免费 100 / 收费 45 / 未知 60） |
| `freshness` | 按 `publishedAt` 距今：≤7 天 100，≤30 天 80，≤90 天 60，更早 40，未知 50 |

`finalScore = Σ(weight × score)`，四舍五入，钳制 0-100。
排序：`finalScore` 降序 → `trustScore` 降序 → `id`（完全确定，可复现）。

**每个分数都可解释**：每个候选返回最多 6 条中文理由，例如

```json
{
  "finalScore": 89,
  "scores": { "relevance": 80, "trust": 85, "timeFit": 100,
              "locationFit": 100, "priceFit": 100, "freshness": 100 },
  "reasons": ["AI 主题高度匹配", "Agent 主题匹配", "2 个来源信息一致",
              "活动时间符合下午偏好", "位于徐汇", "免费"],
  "weights": { "...": "见 RANKING_WEIGHTS" }
}
```

负面理由同样输出：「活动在晚上开始，与下午偏好不符」「不在本周末范围内」「与 AI / Agent 主题不符」。
「N 个来源信息一致」来自**检索层溯源**（该活动有几个来源描述过它），不覆盖管道的
`confirmed_by_multiple_sources`。

---

## 10. Search Service

```python
from pipeline.search import search_events

result = search_events(request,                 # str | dict | SearchRequest
                       provider=None,           # 或 providers=[...]
                       today=None,              # 可注入，便于复现
                       debug=False)
```

执行顺序（`service.py`）：

```
parse request → plan queries → provider search → merge
→ normalize_all → clean_all → dedupe_all → score_all → route
→ 组装 candidate（每条的溯源 = 自己 + 指向它的重复记录）
→ rank_candidates → 截断 maxResults
```

返回：

```json
{
  "request": { ... },
  "plan":    { "queries": [ ... ], "strategy": "deterministic_rules_v1", "dateRange": { ... } },
  "summary": {
    "rawResults": 26, "mergedRawResults": 25, "mergedDuplicates": 1,
    "normalized": 25, "duplicates": 2, "duplicatesExact": 1, "duplicatesNear": 1,
    "canonical": 23, "approved": 16, "needsReview": 7,
    "duplicateCandidates": 2, "rejected": 0,
    "ranked": 25, "returned": 20,
    "reviewQueue": { "approved": 16, "needs_review": 5, "low_confidence": 2 }
  },
  "results": [ { "id", "bucket", "finalScore", "scores", "reasons",
                 "provenance", "queries", "activity" } ],
  "debug": { ... }        // 仅 debug=True
}
```

统计口径：`summary.*` 一律是**管道全量**，`returned` 才是被 `maxResults` 截断后的条数。

---

## 11. HTTP API

```bash
python pipeline/api/server.py --port 8000 [--debug] [--today 2026-09-15]
```

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/api/search` | body `{"query": "..."}`，也接受完整 SearchRequest |
| `GET` | `/api/search?q=...&topics=AI,Agent&city=上海&debug=1` | 便于调试 |
| `GET` | `/api/health` | provider / 基准日期 |
| `GET` | `/*` | 静态文件（可替代 `python -m http.server`，Demo 只需一个进程） |

* 默认**只暴露必要字段**：`activity` 白名单化，`_extra` / `conflicts` 等内部字段不外泄。
* `debug: true`（或 `--debug`）才附带 `debug` 段与完整记录。
* 响应头 `Access-Control-Allow-Origin: *`，便于本地联调。

---

## 12. 预留接口（本阶段只定义）

**RouteProvider**（`pipeline/route/provider.py`）——不接任何真实地图：

```python
class RouteProvider:
    def get_route(self, origin, destination, departure_time=None, travel_mode="transit"): ...
```

* `NullRouteProvider`：默认实现，直接 `NotImplementedError`（宁可拒绝，也不编造通勤时间）。
* `MockRouteProvider`：确定性假路线，返回值带 `"mock": true`，仅用于测试与演示。
* 禁止：高德 / 百度 / Google Maps / Apple Maps（本阶段）。

**Planning Schema**（`pipeline/planning/models.py`）——只定义 contract：

`ItineraryRequest` / `ItineraryCandidate` / `RouteLeg` / `ItineraryPlan`；
`plan_itinerary()` 显式抛 `NotImplementedError`（尚未有求解器，也不该假装有）。

---

## 13. 已知边界

1. **只有 fixture provider**：未录制的 query 返回 0 条（UI 会明确提示，而不是假装搜到了）。
2. **基准日期是快照**：fixture 事件集中在 2026-09-19/20。CLI/API 可用 `--today 2026-09-15`
   固定基准日期以复现 Demo；用真实当天日期时，`time_fit` 会如实下降（事件不在"本周末"）。
3. 检索结果**尚未接入详情页 / 我的周末**（这两者基于 `GORGON_DATA`，检索结果是管道记录）
   —— 属下一阶段。
4. 管道 `trust` 的 `confirmed_by_multiple_sources` 在当前 dedupe + 冲突规则下几乎不可达
   （同标题同日期同场地会被判精确重复，场地不同又会判冲突）。本阶段**不改动**该规则，
   「多来源一致」改由检索层溯源如实表达。
5. 地图、路线、真实爬虫、LLM planner 均未实现（按阶段要求）。
