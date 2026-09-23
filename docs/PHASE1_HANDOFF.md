# PHASE 1 交接文档 — REAL EVENT INDEX V1

**日期**：2026-09-22
**仓库**：`C:\Users\lin\Documents\Gorgon-Recovered`（分支 `feature/human-review-loop`）
**阶段结论**：PHASE 1 完成 —— 真实网页 → 真实结构化活动，链路已跑通并留下证据。

---

## 1. 这一阶段做了什么

只做一件事：**验证并跑通一个真实活动来源（豆瓣上海同城），把真实上海活动稳定抓取出来。**

完成的部分：

* 实测验证豆瓣同城公开活动页的可访问性、分页结构、字段可得性（写进 `docs/REAL_SOURCE_Douban.md`）
* 新建独立 crawler 层 `pipeline/crawlers/`，复用已有 `PageFetcher`，与 `SearchProvider` 完全分离
* 实现 `DoubanCrawler`：listing → 发现 URL → 去重 → detail → `RawEvent`
* 真实分页（不是只抓第一页），`--max-pages` 可控
* 结果落盘 JSON（`pipeline/data/crawl/`），**没有引入数据库**
* 40 个单元测试（全离线），完整套件 331 个测试通过无回归

明确**没有**做的（下一阶段才开）：

| 未做 | 原因 |
|---|---|
| 数据库 / SQLite | PHASE 1 只要求先证明链路可靠 |
| 改 `SearchService` | 召回路径与采集路径分离 |
| 新增其他 Provider | 本阶段只接豆瓣一个源 |
| LLM | 不在范围内 |
| 地图 / 经纬度 | 页面里有 `latitude/longitude`，但 PHASE 1 明确排除，未采集 |
| UI | 不在范围内 |

---

## 2. 代码地图

| 文件 | 职责 |
|---|---|
| `pipeline/crawlers/__init__.py` | 层说明：crawler ≠ SearchProvider 的边界约定 |
| `pipeline/crawlers/base.py` | `BaseCrawler`：分页循环、URL 去重、停止条件、详情页批次、失败隔离。子类只实现 `listing_url` / `parse_listing` / `parse_detail` |
| `pipeline/crawlers/models.py` | `RawEvent` / `ListingEntry` / `ListingPage` / `CrawlReport` |
| `pipeline/crawlers/douban.py` | `DoubanCrawler`：URL 构造 + 两个 parser + `split_location` |
| `pipeline/crawlers/run.py` | CLI 入口，写两个 JSON |
| `pipeline/tests/test_crawlers.py` | 40 个离线测试 |
| `pipeline/tests/fixtures/crawlers/*.html` | 4 个**真实**页面快照（仅单测用） |
| `docs/REAL_SOURCE_Douban.md` | 真实源验证报告（CONFIRMED / UNKNOWN / UNAVAILABLE） |
| `pipeline/data/crawl/douban_events.json` | 100 条真实活动 |
| `pipeline/data/crawl/douban_crawl_report.json` | 抓取统计 |

**没有改动**：`pipeline/search/webproviders.py`、`pipeline/search/service.py`、`pipeline/schema.py`、`pipeline/normalize/*`、`pipeline/search/fetcher.py`。

---

## 3. 怎么跑

```bash
cd C:/Users/lin/Documents/Gorgon-Recovered

# 生产运行（走真实网络，约 110 次请求 / 60 秒）
PYTHONIOENCODING=utf-8 \
  "C:/Users/lin/.workbuddy/binaries/python/versions/3.13.12/python.exe" \
  -m pipeline.crawlers.run --source douban --city 上海 --max-pages 10
```

常用开关：

| 参数 | 说明 |
|---|---|
| `--max-pages N` | 最多抓 N 个 listing 页（默认 10；豆瓣 10 条/页） |
| `--city 上海` | 城市 → `https://<slug>.douban.com/events/future-all` |
| `--limit-details N` | 只抓前 N 个详情页（调试用） |
| `--no-details` | 只用 listing 行，不抓详情页 |
| `--out-dir <dir>` | 改输出目录（**调试时务必用**，否则会覆盖正式产物） |
| `--offline` | 禁网，让"没网"变成显式失败而不是超时 |

> **生产运行没有 fixture 模式，这是故意的。** fixture 只允许出现在单元测试里；
> 生产读 fixture 就等于制造数据。

测试：

```bash
PYTHONIOENCODING=utf-8 "C:/Users/lin/.workbuddy/binaries/python/versions/3.13.12/python.exe" \
  -m unittest discover -s pipeline/tests -p "test_crawlers.py" -t .     # 40 个，离线

PYTHONIOENCODING=utf-8 "C:/Users/lin/.workbuddy/binaries/python/versions/3.13.12/python.exe" \
  -m unittest discover -s pipeline/tests -p "test_*.py" -t .            # 331 个
```

---

## 4. 数据契约

### `RawEvent`

| 字段 | 豆瓣来源 | 备注 |
|---|---|---|
| `title` | 详情 `<h1 itemprop="summary">` | |
| `startTime` / `endTime` | `<time itemprop="startDate/endDate" datetime>` | 原文存储，无时区后缀，**未做时区偏移** |
| `city` | `itemprop="region"` | 经 `normalize_city()` |
| `district` | `itemprop="locality"` | 经 `normalize_district()`；认不出就是 null |
| `venueName` | **无** | 豆瓣没有独立场馆字段，恒为 `null` |
| `address` | `itemprop="street-address"` | |
| `price` | `itemprop="ticketAggregate"` | 原文，如 `免费` / `178元(活动费)` / `80.0元起` |
| `organizer` | `主办方 <a itemprop="name">` | |
| `sourceName` | `豆瓣同城` | |
| `sourceUrl` | `https://www.douban.com/event/<id>/` | 由数字 id 重建，天然去掉 tracking 参数 |
| `sourceEventId` | 数字 id | |
| `rawData` | listing 行 + 详情原始字段 + `fieldSources` + `detailFetched` | 每个值都能追溯到"来自详情页还是 listing 行" |

### `CrawlReport`

`pagesFetched` / `activitiesDiscovered` / `uniqueActivityUrls` / `detailsFetched` /
`success` / `failed` / `missingDate` / `missingVenue` / `missingAddress` /
`stopReason` / `listingUrls` / `failures`。

`success` = 真正从**详情页**读出来的条数；回退到 listing 行的不算成功（已在 `failed` 里），
所以完整跑完时 `success + failed == detailsFetched`。

---

## 5. 真实源关键事实（接手必读）

详细分级见 `docs/REAL_SOURCE_Douban.md`，这里只列**会影响改代码的坑**：

1. **分页是 `?start=<offset>`**（page N → `start=(N-1)*10`），10 条/页，`data-total-page="153"`。
2. **越界 offset 会骗人**：`start=1530` 仍返回 200，且**仍然渲染 `后页>`**。只信 next 控件 = 死循环。
   停止条件优先级：无行 → `data-total-page` 到底 → 无新增 URL → listing URL 重复 → `--max-pages`。
3. **侧栏污染**：每页有 15 个 `class="list-entry"`，只有 10 个带 `itemscope itemtype=.../Event`。
   另外 5 个是侧栏票务推荐，**每页重复**，URL 带 `?icn=list-shopitem`。
   → 只匹配带 `itemscope` 的行；URL 用数字 id 重建，重复自然消失。
4. **不要猜 district**：只在 `normalize_district()` 认得出时才提升为 district，认不出就留在 address。
5. **不要猜 venue**：源没有场馆字段，`missingVenue=100` 是设计结果，不是 bug。**不要为了填表把 address 拆成 venue。**
6. **`canonical_url()` 会丢 query**：只能用于活动 URL 去重。
   **listing URL 的去重必须用原始字符串**，否则 `?start=10/20` 会被判成同一页，第 1 页后就停（这个 bug 已经踩过一次）。
7. **`textnorm.strip_markup()` 只清 Markdown，不清 HTML 标签**。要先 `re.sub(r"<[^>]+>")` 再走 textnorm，
   否则 `price` 会变成 `<span class="hidden-xs">费用：</span> <strong>79元…`。

### 反爬行为（重要）

跑完约 110 次请求（约 1 分钟）后，豆瓣开始对整个域名返回 **403 → `https://sec.douban.com/b?r=...`**，
listing 页也一样。第二次跑实测输出：

```
stopReason   = blocked
pagesFetched = 0
failures     = [{"stage":"listing","url":".../events/future-all","reason":"blocked","detail":"HTTP 403"}]
```

crawler **不重试、不换 UA、不解验证码、不解析墙**，直接停并记录。
→ **做全量索引前必须先解决节奏问题**（放慢 / 加长间隔 / 换源 / 多 IP），否则 153 页扫不完。

---

## 6. 验收结果（真实运行，2026-09-22）

| 指标 | 值 |
|---|---|
| pagesFetched | 10 |
| activitiesDiscovered | 100 |
| uniqueActivityUrls | 100 |
| detailsFetched | 100 |
| success | 100 |
| failed | 0 |
| missingDate | 0 |
| missingVenue | 100（源无场馆字段） |
| missingAddress | 0 |
| stopReason | `max_pages` |
| 耗时 | 63 秒 |

* 100 条全部有唯一 `sourceUrl`
* 100% 字段来自详情页（`fieldSources` 全为 `detail`）
* 区级分布：浦东 28 · 长宁 27 · 黄浦 19 · 静安 9 · 徐汇 7 · 虹口 6 · 普陀 2 · 宝山 1 · 杨浦 1

---

## 7. 已知限制

1. **IP 被限流**（见 §5）——这是规模化的头号障碍。
2. 只抓了 10 页（100 条），153 页全量没扫；深分页是否被额外限制 UNKNOWN。
3. `startTime/endTime` 无时区后缀，按源文存储，未做规范化到 `startDate`/`startTime`（schema 里那套还没接）。
4. `future-all` 的品类覆盖面 UNKNOWN；部分条目是长期票务（如 2026-10-01 → 12-24），不是单日活动。
5. `RawEvent` 还没接进 `pipeline/schema.py` 的 canonical Activity（`fill_defaults` / `validate` / trust / dedupe 都没过）。
6. 未 commit（仓库里还有大量**既有**未提交改动，混在一起提交不合适）。

---

## 8. 下一步建议（本阶段**未**开工）

按依赖顺序，每件都是独立可交付的：

1. **节奏 / 限流**：先解决 §5，否则后面所有批量工作都做不动。
2. **RawEvent → canonical Activity**：接 `pipeline/schema.py`，然后过已有的 `normalize/` → `clean/` → `dedupe/` → `trust/`。
   注意本阶段刻意没改这些模块。
3. **持久化**：schema 打通后再引入存储（PHASE 1 明确排除）。
4. **全量抓取**：153 页 / 约 1530 条，配合 1 做。
5. **接回检索**：让 `SearchService` 能从本地索引召回，而不是每次现抓。
6. **加第二个源**：`base.py` 的分页/去重/停止条件已经抽出来，新源只需实现 3 个方法。

---

## 9. 环境注意事项（本机已验证）

* Git Bash 里 `ls` / `dirname` 会 command not found。跑命令前先：
  `export PATH="/usr/bin:/bin:/c/Windows/System32:$PATH"`
* Python 用 managed 版：`C:/Users/lin/.workbuddy/binaries/python/versions/3.13.12/python.exe`，带 `PYTHONIOENCODING=utf-8`。
* 本机有 `HTTP_PROXY`（127.0.0.1 端口每次可能变）。`curl` 访问 localhost 需要 `--noproxy '*'`；
  `PageFetcher` 自己会从 env 解析代理，实测豆瓣可正常访问。
* **跑完整 Python 测试会重写 `pipeline/data/**`**（只是 `collectedAt` 时间戳）。收尾记得：
  `git checkout -- pipeline/data`。
  ⚠️ `ui_kits/admin/generated-review-data.js` 是**既有**未提交改动，**不要**跟着还原。
