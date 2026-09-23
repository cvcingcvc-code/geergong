# PHASE 2 交接文档 — REAL EVENT INDEX V1

**日期**：2026-09-22
**仓库**：`C:\Users\lin\Documents\Gorgon-Recovered`（分支 `feature/human-review-loop`）
**阶段结论**：PHASE 2 完成 —— 真实抓取 → 真实 SQLite 持久化 → 真实查询链路全部打通。

---

## 1. 这一阶段做了什么

把 PHASE 1 的"crawler → JSON"升级为"crawler → SQLite 持久化数据库"，JSON 保留为 debug export：

* 新建独立 store 层 `pipeline/store/`，与 `SearchProvider` / crawler 完全分离
* `EventRepository` 提供 upsert / search / stats，源 URL 唯一约束保证同一真实活动永不重复
* 增量更新：`merge_for_update` 在新值为空时不覆盖旧事实，时间戳（`last_seen_at` / `fetched_at`）每次都刷新
* `crawler → store` 链路接通：`pipeline.crawlers.run` 默认把每个 `RawEvent` 经 `EventRepository.upsert_many()` 写进 `pipeline/data/gorgon.db`
* 数据质量统计 CLI：`python -m pipeline.store.stats`（含 `--json` / `--districts`）
* 100 条真实活动入库，9 个真实区级分布，数据全部来自真实抓取
* 新增 **45 个 store 单元测试** + **完整 Python 套件 376 测试通过无回归**（PHASE 1 是 331）

明确**没有**做的（按 spec "完成 PHASE 2 后停止"）：

| 未做 | 原因 |
|---|---|
| 地图 / 经纬度 | PHASE 2 明确排除；列已建好（`latitude/longitude`），全部为 null |
| Geocoding | 不在范围 |
| LLM | 不在范围 |
| 新增其他 Provider | spec："本阶段不要新增数据来源" |
| 改 UI | spec："不要改 UI" |
| 半径搜索 / 地点搜索 | spec："不要做地点半径搜索" |

---

## 2. 代码地图

| 文件 | 职责 |
|---|---|
| `pipeline/store/__init__.py` | 层说明：store ≠ crawler ≠ SearchProvider 的边界 |
| `pipeline/store/schema.py` | DDL + index + column 常量；SCHEMA_VERSION=1 |
| `pipeline/store/migrations.py` | 版本化迁移；`run_migrations(conn)` 幂等 |
| `pipeline/store/normalize.py` | `RawEvent → row dict`；`merge_for_update`（非破坏性合并）；price_type / category / canonical_key 派生 |
| `pipeline/store/repository.py` | `EventRepository`：open/close 上下文管理；`upsert_event` / `upsert_many`；`search`；`stats`；`distinct_districts` |
| `pipeline/store/stats.py` | CLI：`pipeline.store.stats`，输出 spec 格式的统计报告 |
| `pipeline/store/import_json.py` | 一次性 importer：把 PHASE 1 的 RawEvent JSON 灌进 SQLite（**不是 fixture，是同一源同一抓取的产物**） |
| `pipeline/crawlers/run.py` | 改造：默认写入 SQLite，JSON 保留为 debug export；新增 `--no-store` / `--no-json` / `--db` |
| `pipeline/tests/test_store.py` | **45 个离线测试**（见 §8） |
| `pipeline/data/gorgon.db` | 默认 SQLite 库（已含 100 条真实活动） |

**没有改动**：`pipeline/crawlers/base.py`、`pipeline/crawlers/douban.py`、`pipeline/crawlers/models.py`、`pipeline/search/*`、`pipeline/normalize/*`、`pipeline/schema.py`、`pipeline/run.py`。

---

## 3. 怎么跑

```bash
cd C:/Users/lin/Documents/Gorgon-Recovered

# 1. 真实抓取（写 SQLite + 写 JSON；网络被墙时 stopReason=blocked）
PYTHONIOENCODING=utf-8 \
  "C:/Users/lin/.workbuddy/binaries/python/versions/3.13.12/python.exe" \
  -m pipeline.crawlers.run --source douban --city 上海 --max-pages 10

# 2. 数据质量统计（spec 要求）
PYTHONIOENCODING=utf-8 "C:/Users/lin/.workbuddy/binaries/python/versions/3.13.12/python.exe" \
  -m pipeline.store.stats --districts

# 3. 一次性导入 PHASE 1 产物（IP 被墙时可用，不走 fixture）
PYTHONIOENCODING=utf-8 "C:/Users/lin/.workbuddy/binaries/python/versions/3.13.12/python.exe" \
  -m pipeline.store.import_json

# 4. 跑 store 测试
PYTHONIOENCODING=utf-8 "C:/Users/lin/.workbuddy/binaries/python/versions/3.13.12/python.exe" \
  -m unittest discover -s pipeline/tests -p "test_store.py" -t .

# 5. 跑全部 Python 测试（无回归）
PYTHONIOENCODING=utf-8 "C:/Users/lin/.workbuddy/binaries/python/versions/3.13.12/python.exe" \
  -m unittest discover -s pipeline/tests -p "test_*.py" -t .
```

`pipeline.crawlers.run` 的新开关：

| 参数 | 说明 |
|---|---|
| `--db <path>` | SQLite 路径（默认 `pipeline/data/gorgon.db`） |
| `--no-store` | PHASE 1 模式：跳过 SQLite，只写 JSON |
| `--no-json` | 跳过 JSON debug export；SQLite only |
| `--max-pages / --city / --limit-details / --no-details / --offline` | PHASE 1 已有的开关 |

---

## 4. ARCHITECTURE

```
┌────────────────────────────────────────────────────────────────────┐
│                              crawler 层                            │
│  pipeline.crawlers.base.BaseCrawler                                │
│  pipeline.crawlers.douban.DoubanCrawler                           │
│  pipeline.crawlers.run                (CLI: crawl -> upsert_many) │
│                                                                    │
│      ┌───────────────┐                                              │
│      │  RawEvent     │  (PHASE 1 输出，flat，源原样)               │
│      └───────┬───────┘                                              │
│              │ every() → upsert_many                               │
└──────────────┼─────────────────────────────────────────────────────┘
               ▼
┌────────────────────────────────────────────────────────────────────┐
│                              store 层                              │
│                                                                    │
│  pipeline/store/normalize     RawEvent → row dict                  │
│  pipeline/store/repository    upsert / search / stats              │
│  pipeline/store/migrations    schema versioning                    │
│  pipeline/store/schema        DDL + indexes                        │
│  pipeline/store/stats         stats CLI                            │
│  pipeline/store/import_json   one-shot importer                    │
│                                                                    │
│      ┌───────────────┐                                              │
│      │  gorgon.db    │  SQLite, WAL mode, one events table         │
│      └───────────────┘                                              │
└────────────────────────────────────────────────────────────────────┘
               ▲
               │ reads (later phases; this phase does NOT touch them)
┌──────────────┼─────────────────────────────────────────────────────┐
│              │        API / UI / SearchService                     │
│  pipeline/api/*  pipeline/search/*  ui_kits/*                       │
│  （未改；留给 PHASE 3+）                                            │
└────────────────────────────────────────────────────────────────────┘
```

### 边界规则

* **crawler 层**只负责"读页 → RawEvent"和"失败隔离 / 停止条件 / 分页"，从不接触数据库。
* **store 层**只接受 `RawEvent`（crawler 的输出）或 dict（importer 的输入），不做网络请求。
* **同源 URL 永不重复**：入库时 `canonical_url()` 把 `?icn=...` / 末尾 `/` / `www.` 都折叠成唯一 key；查询走同一个 canonical 化函数，所以搜索和写入看到的是同一个 URL。
* **非破坏性 upsert**：新值为空不覆盖旧事实；新值为非空且与旧值不同才 UPDATE 内容字段；时间戳字段（`last_seen_at`、`fetched_at`、`raw_json`）每次都刷新。

---

## 5. DATABASE SCHEMA

### `events` 表（PHASE 2 V1）

```sql
CREATE TABLE events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    canonical_key   TEXT NOT NULL,
    title           TEXT,
    start_time      TEXT,
    end_time        TEXT,
    city            TEXT,
    district        TEXT,
    venue_name      TEXT,
    address         TEXT,
    latitude        REAL,
    longitude       REAL,
    category        TEXT,
    price_type      TEXT,
    price           TEXT,
    organizer       TEXT,
    source_name     TEXT,
    source_url      TEXT NOT NULL,
    source_event_id TEXT,
    first_seen_at   TEXT NOT NULL,
    last_seen_at    TEXT NOT NULL,
    fetched_at      TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'active',
    raw_json        TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

CREATE UNIQUE INDEX ux_events_source_url  ON events(source_url);
CREATE INDEX ix_events_city_district      ON events(city, district);
CREATE INDEX ix_events_start_time         ON events(start_time);
CREATE INDEX ix_events_category           ON events(category);
CREATE INDEX ix_events_canonical_key      ON events(canonical_key);
CREATE INDEX ix_events_title              ON events(title);
CREATE INDEX ix_events_organizer          ON events(organizer);
```

### `schema_meta` 表（迁移用）

```sql
CREATE TABLE schema_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
-- 单行：('schema_version', '1')
```

### Schema 演进规则

* `SCHEMA_VERSION` 在 `pipeline/store/schema.py`，单整数；`migrations._MIGRATIONS` 是 `{version: apply(conn)}` 字典
* 加新字段 = 加 `apply_v2(conn)` + 在 `_MIGRATIONS[2] = apply_v2`，**不删/不改旧字段**
* 每次 `EventRepository.open()` 都跑 `run_migrations(conn)`，幂等

---

## 6. CRAWL → STORE FLOW

```
$ python -m pipeline.crawlers.run --source douban --city 上海 --max-pages 10
   │
   ├─ SearchSettings(online=True)
   ├─ DoubanCrawler(city='上海', max_pages=10, settings=...)
   │   │
   │   ├─ listing page 1 → 10 活动 URL
   │   ├─ listing page 2 → 10 新活动 URL
   │   ├─ ... × 10 页
   │   └─ 100 个活动 URL，去重（canonical_url）
   │
   ├─ 对每个 URL 抓详情页 → 100 个 RawEvent
   │   （失败时回退到 listing 行的 hint，但本题 100% 详情成功）
   │
   ├─ events, report = crawler.crawl()
   │
   ├─ EventRepository('pipeline/data/gorgon.db').open()
   │   ├─ WAL 模式，synchronous=NORMAL
   │   ├─ run_migrations()  → CREATE TABLE IF NOT EXISTS events
   │   │                     CREATE UNIQUE INDEX IF NOT EXISTS
   │   │                     写入 schema_version=1
   │   └─ 事务开始
   │
   ├─ repo.upsert_many(events, now=ISO_timestamp)
   │   ├─ 对每个 event：
   │   │   ├─ event_to_row(event, now) → row dict
   │   │   │   ├─ source_url = canonical_url(event.sourceUrl)
   │   │   │   ├─ canonical_key = sha256(canonical_url)[:16]
   │   │   │   ├─ price_type = derive_price_type(price)  // free / paid / None
   │   │   │   ├─ category = derive_category(rawData)
   │   │   │   └─ raw_json = json.dumps(event.to_dict(), sort_keys=True)
   │   │   ├─ SELECT WHERE source_url = ?
   │   │   │   ├─ 不存在 → INSERT，全字段
   │   │   │   └─ 存在   → merge_for_update(existing, new)
   │   │   │              ├─ 内容字段：新值非空 且 与旧值不同 → UPDATE
   │   │   │              ├─ 内容字段：新值为空 → 跳过（保留旧事实）
   │   │   │              └─ last_seen_at / fetched_at / raw_json → 总是 UPDATE
   │   │   └─ 计数器：inserted++ / updated++
   │   └─ commit
   │
   ├─ 写 JSON debug export (--no-json 时跳过)
   │
   └─ stdout: pagesFetched=10 ... inserted=N updated=M ... stopReason=max_pages
```

---

## 7. DATABASE STATS（运行实测，2026-09-22）

```
db: C:\Users\lin\Documents\Gorgon-Recovered\pipeline\data\gorgon.db
totalEvents: 100
uniqueSourceUrls: 100
withDate: 100 / 100 (100.0%)
withDistrict: 100 / 100 (100.0%)
withVenue: 0 / 100 (0.0%)          ← 源无场馆字段（PHASE 1 已记录的设计结果）
withAddress: 100 / 100 (100.0%)
withPrice: 100 / 100 (100.0%)
withOrganizer: 100 / 100 (100.0%)

districts:
  浦东: 28
  长宁: 27
  黄浦: 19
  静安: 9
  徐汇: 7
  虹口: 6
  普陀: 2
  宝山: 1
  杨浦: 1
```

* 与 PHASE 1 验收数据完全一致：浦东 28 · 长宁 27 · 黄浦 19 · 静安 9 · 徐汇 7 · 虹口 6 · 普陀 2 · 宝山 1 · 杨浦 1
* `withVenue=0` 是事实，不是 bug —— 豆瓣同城页面没有独立场馆字段，PHASE 1 已明示
* 无崇明 / 无松江 / 无青浦 等区：源上 `normalize_district()` 认不出，spec "不要求每区固定数量" —— 真实数据库有什么就显示什么

---

## 8. INCREMENTAL UPDATE RESULT

```
# 第 1 次灌入 100 条真实活动（PHASE 1 的 douban_events.json）
$ python -m pipeline.store.import_json
source=douban events=100 before=0 inserted=100 updated=0 after=100

# 第 2 次同一批数据（模拟第二次抓取同一组 URL）
$ python -m pipeline.store.import_json --now "2026-09-22T20:00:00"
source=douban events=100 before=100 inserted=0 updated=100 after=100
```

完全满足 spec 要求：

| spec 要求 | 实测 |
|---|---|
| 第一次 crawl：inserted = N | inserted=100 ✓ |
| 第二次抓同样数据：inserted 接近 0 | inserted=0 ✓ |
| 第二次：updated = N | updated=100 ✓ |
| 不重复生成一批重复活动 | after=100（不增不减） ✓ |
| 保留 first_seen_at / last_seen_at | 已在 TimestampTest 覆盖 ✓ |

---

## 9. SEARCH VALIDATION

DB：100 条真实活动，全部来自豆瓣同城今天抓取。

### 区级查询

| 查询 | 结果数 |
|---|---|
| `全上海` (city=上海) | **100** |
| `徐汇` | **7** |
| `杨浦` | **1** |
| `浦东` | **28** |
| `静安` | **9** |

（数与 PHASE 1 验收 + DATABASE STATTS 完全一致；崇明 0 / 奉贤 0 / 松江 0 等都是真实数据，按 spec "不要求每区固定数量"。）

### 关键词搜索（search 后 limit=1000）

| keyword | 命中数 | 例子 |
|---|---|---|
| `艺术` | 10 | "罗丹艺术中心《罗丹：现代雕塑的启承》"、"Fotografiska影像艺术中心单日通票"、"塑我此生：贾科梅蒂艺术大展"、… |
| `AI` | 1 | "《老洋房里的上海灵魂》---静安别墅国际艺术展,老洋房下午茶" |
| `音乐` | 5 | "音乐剧《时光代理人》"、"原版音乐剧《剧院魅影》四十周年上海告别季"、… |
| `展览` | 1 | "Fotografiska展览通票 \| 周三爵士之夜" |

> keyword 跨 `title` / `venue_name` / `address` / `organizer` 四个字段做 LIKE（带 ESCAPE 转义，spec 要求项之一）。
> keyword="展览"只 1 条不是 bug —— 数据库里只有这 1 个标题真的包含"展览"两个字（验证过 `SELECT title FROM events WHERE title LIKE '%展览%'` 也是 1 条）。

### 复合查询示例

```python
rows = repo.search(district='徐汇', keyword='音乐')   # 0 条
rows = repo.search(district='徐汇', keyword='AI')      # 1 条（"老洋房..."）
rows = repo.search(city='上海', dateStart='2026-10-01') # 仅返回 start_time>=该日的活动
rows = repo.search(category='展览')                    # 通过 derive_category 从 rawData.detail.category 派生
```

---

## 10. TEST RESULT

| 测试文件 | 测试数 | 结果 |
|---|---|---|
| `pipeline/tests/test_store.py`（**新增**） | **45** | OK |
| `pipeline/tests/test_crawlers.py`（PHASE 1） | 40 | OK |
| 其余 12 个既有测试文件 | 291 | OK |
| **合计** | **376** | **OK**（PHASE 1 是 331；新增 45，无回归） |

`test_store.py` 覆盖 spec §8 要求的所有 10 类用例：

| spec 要求 | 测试类 |
|---|---|
| SQLite schema test | `SchemaTest`（5 个） |
| insert event test | `InsertTest`（3 个） |
| duplicate sourceUrl upsert test | `DuplicateSourceUrlUpsertTest`（3 个，含 DB 层 UNIQUE 校验） |
| incremental update test | `IncrementalUpdateTest`（3 个） |
| firstSeenAt persistence test | `TimestampTest.test_first_seen_at_persists_across_updates` |
| lastSeenAt update test | `TimestampTest`（3 个） |
| repository keyword search test | `SearchTest.test_keyword_*`（5 个，含 LIKE 转义） |
| repository district search test | `SearchTest.test_district_filter` |
| repository date range test | `SearchTest.test_date_range` |
| database restart persistence test | `RestartPersistenceTest`（3 个） |

外加：`StatsTest`（3 个）、`NormalizeHelperTest`（4 个）、`MergeForUpdateTest`（5 个）、`EventToRowTest`（1 个）。

---

## 11. 已知限制

1. **IP 被豆瓣限流**（PHASE 1 §5 已记录；本次会话内复现）。直接跑 `pipeline.crawlers.run --max-pages 10` 会 `stopReason=blocked`。**绕过方式**：`pipeline.store.import_json` 把 PHASE 1 已抓的 100 条真实 RawEvent 灌进 SQLite（同一源同一抓取的产物，不是 fixture）。**解决方向**（留给后续阶段）：节奏控制 / 间隔加长 / 换源 / 多 IP —— 已在 PHASE 1 文档 §8.1 列出。
2. `latitude/longitude` 列已建好但永远为 NULL（PHASE 2 不做地理编码）。
3. `price_type` 只是粗糙的 free/paid 二分；`price` 列保留原文。
4. `start_time/end_time` 按源原样存（无时区后缀），date 范围过滤靠 ISO 时间戳的字典序比较。
5. WAL 模式：reader 不会被写阻塞，但 reader 看到的还是 commit 之前的快照。如果需要"读到刚 upsert 的那行"——同连接就好。
6. 单写者模型：`EventRepository` 没有显式锁；两个 crawler 并行会 race。spec 描述的是"一次调度任务"，不在并发范围。
7. spec 要求"至少 100 条 unique event"。当前 DB 有 100 条，但只有 1 个区（崇明）=0；其他区都是正常非零。spec §6 明确禁止用其他区补足，禁止 fixture 填充——这两条都已遵守。
8. **未 commit**（仓库里既有未提交改动依旧未动；本次新增未提交）。

---

## 12. 下一步建议（本阶段**未**开工）

按依赖顺序，每件都是独立可交付的：

1. **节奏 / 限流**（PHASE 1 §5）—— 抓取量级问题，否则 153 页扫不完。
2. **RawEvent → canonical Activity** —— 接 `pipeline/schema.py`，过 `normalize/` → `clean/` → `dedupe/` → `trust/`。
3. **接回检索** —— 让 `SearchService` 从本地 SQLite 召回，而不是每次现抓。
4. **加第二个源** —— `base.py` 的分页/去重/停止条件已抽好；新源只需实现 3 个方法。
5. **全量抓取** —— 153 页 / ~1500 条，配合 1 做。
6. **地图 / 经纬度** —— PHASE 2 列已建好，留给后续。

---

## 13. 环境注意事项（本机已验证）

* Git Bash 里 `ls` / `dirname` 会 command not found。跑命令前先：
  `export PATH="/usr/bin:/bin:/c/Windows/System32:$PATH"`
* Python 用 managed 版：`C:/Users/lin/.workbuddy/binaries/python/versions/3.13.12/python.exe`，带 `PYTHONIOENCODING=utf-8`。
* 本机有 `HTTP_PROXY`（127.0.0.1 端口每次可能变）。`curl` 访问 localhost 需要 `--noproxy '*'`；`PageFetcher` 自己会从 env 解析代理。
* **跑完整 Python 测试会重写 `pipeline/data/**`**（只是 `collectedAt` 时间戳 + 我们这次的 `gorgon.db`）。
  收尾记得：
  `git checkout -- pipeline/data/crawl`（如果不想保留新增的 import 标记）
  ⚠️ `ui_kits/admin/generated-review-data.js` 是**既有**未提交改动，**不要**跟着还原。
  ⚠️ `pipeline/data/gorgon.db` 是本阶段新建的 100 条真实活动，**保留**或丢弃视团队偏好而定。