# PHASE 3 HANDOFF — REAL EVENT INDEX V1: Nearby Search

日期：2026-09-23
分支：`feature/human-review-loop`

---

## ARCHITECTURE BEFORE

```
User Query
  ↓
Parse Request（place 被丢给 district 匹配，"五角场" 无处安放）
  ↓
Plan Queries → Web/Fixture Providers（纯实时检索，Local Index 未接入检索链路）
  ↓
merge → enrich → normalize → clean → dedupe → trust → route
  ↓
ranking（location_fit 只看 district）
  ↓
results
```

问题：SQLite Event Store（PHASE 2 的 100 条真实豆瓣活动）**不参与检索**；
地点只能表达为 district；无坐标、无距离、无附近语义。

## ARCHITECTURE AFTER

```
User Query
  ↓
Parse Request（"X附近" → place；区名附近的旧契约保留）
  ↓
Place Resolver（pipeline/location/geocoder.py）
    有配置（AMAP_KEY / BAIDU_MAP_AK）→ 真实坐标（含 datum 标注）
    无配置 → placeResolutionStatus = "not_configured"，诚实返回，禁止猜坐标
  ↓
EventRepository（Local Index，主候选池）
  search_nearby(lat, lng, radius_km, date_start, date_end, keyword, limit)
  ↓
Spatial Filter（真实 Haversine ≤ radius；无坐标候选被计数排除，
                实时 Web 结果无坐标永远无法"自称在附近"）
  ↓
optional live Web Search（仅补充召回）
  ↓
merge → dedupe（local_index 行 dataOrigin=real，走既有管线）→ trust
  ↓
ranking（距离 → location_fit 分带评分；排序 = 距离 ↑ + finalScore）
  ↓
results（每条带 distanceKm / resolvedPlace / latitude / longitude）
```

## GEOCODING VALIDATION

| 数据源 | 本机连通性 | 结论 |
|---|---|---|
| 高德 restapi.amap.com | ✅ 可达（无 key 返回 INVALID_USER_KEY） | **首选**，GCJ-02 |
| 百度 api.map.baidu.com | ✅ 可达（无 key 返回 AK 有误） | 备选，BD-09 |
| Nominatim / Photon / Open-Meteo（免 key） | ❌ 代理 502 / TLS 拦截 / 超时 | 不可用 |

**决策（用户确认）：不注册 key，按 spec 走 `not_configured`。**
系统全程未生成任何猜测坐标：没有 district 中心点、没有随机值、没有伪造距离。

- `get_geocoder()`（env：`GORGON_GEOCODER` / `AMAP_KEY` / `BAIDU_MAP_AK`）无配置 → None
- `PlaceResolver.resolve()` → `not_configured`；API 冒烟验证：
  `POST /api/search {"query":"…","place":"五角场","radiusKm":3}`
  → `placeResolution.status = "not_configured"`，0 条结果，notice `geocoder_not_configured`
- 回填命令同样诚实退出：`python -m pipeline.location.backfill` → exit 2

## EVENT COORDINATE COVERAGE（真实 gorgon.db）

```
totalEvents: 100        withCoordinates: 0 (0.0%)
geocodableMissing: 100  （100 条全部有 address，key 一到即可全量回填）
bySource: []            schema_version: 2（geocode_source / geocoded_at 已迁移）
```

## NEARBY SEARCH VALIDATION

五地点验收（radius=3km，`python -m pipeline.location.validate_nearby`）：

| place | placeResolutionStatus | resolvedPlace | lat/lng | events |
|---|---|---|---|---|
| 五角场 | not_configured | — | — | 0 |
| 静安寺 | not_configured | — | — | 0 |
| 人民广场 | not_configured | — | — | 0 |
| 上海交通大学 | not_configured | — | — | 0 |
| 新天地 | not_configured | — | — | 0 |

这是**无 key 状态下唯一诚实的输出**。附近搜索的机械链路（距离数学、半径过滤、
排序、距离进 ranking、HTTP 透传）已由 62 个离线测试全链路验证，包括 spec 指定的回归：

```
Event A: distance = 2.9km, radius = 3km → 出现 ✅
Event B: distance = 3.1km, radius = 3km → 不出现 ✅
（另验证：恰好 3.0km 计入半径内）
```

防降级验证：`静安寺附近` 解析为 place=静安寺，locationPreference 保持 None
（静安寺 → 静安 区级泄漏已封死）；`徐汇附近`（区名）保留旧版软偏好契约，
`district=徐汇` 的既有查询行为不变（冒烟：ok，9 条）。

## TEST RESULT

```
Python:  438 tests, all OK（新增 62：test_location.py + test_nearby.py）
JS:      district.test.mjs 131 passed / ui_view_model.test.mjs 125 passed
新增覆盖：haversine 数学 / 三家 geocoder 响应解析（离线录样）/
         坐标持久化 + 重爬不抹坐标 / 半径过滤（含 2.9 vs 3.1 回归、3.0 边界）/
         距离排序 / keyword+date 过滤 / 未知地点 / geocoder 不可用 /
         not_configured 不降级为区级搜索 / radius 永不自动扩大 /
         dict-only query 仍能解析出 place
```

## KNOWN LIMITATIONS

1. **未配置 Geocoder → 无法产出真实坐标**：附近搜索对真实库当前返回诚实 0 条。
   这是唯一阻断验收的点，一个免费 key 即可解除。
2. **坐标系混合风险**：高德 GCJ-02 / 百度 BD-09 / Nominatim WGS-84 之间相差
   100–500m。V1 按单源部署（events 与 place 目标同源）；`geocode_source`
   已落库可审计，但**换 provider 后需重跑回填**（`--force` 语义尚未实现）。
3. **地址级精度**：豆瓣地址多为"XX地铁站X口"级别，geocode 结果置信度受限，
   距离展示一律带"约"。
4. **Web 补充召回当前不可用坐标即排除**：实时搜索结果无坐标时被计数排除
   （`excludedNoDistance`），不会以"大概在附近"的名义出现。
5. `search_nearby` 为 Python 侧距离过滤（上限 5000 行扫描），数据到万级后
   应加 SQL bounding-box 预过滤。

## NEXT STEP

1. 免费注册高德开放平台 → Web 服务类型 key → 设置环境变量 `AMAP_KEY`。
2. `python -m pipeline.location.backfill --db pipeline/data/gorgon.db`
   （自动限速，100 条约 40 秒；结果写 latitude/longitude/geocode_source/geocoded_at）。
3. `python -m pipeline.location.validate_nearby --db pipeline/data/gorgon.db`
   重跑本验收，五地点应输出真实坐标与真实活动列表。
4. （可选）`BAIDU_MAP_AK` 备选；`GORGON_GEOCODER=off` 可随时关闭。

### 新增/改动文件

- 新增：`pipeline/location/`（models / distance / geocoder / backfill / validate_nearby）
- 新增测试：`pipeline/tests/test_location.py`、`pipeline/tests/test_nearby.py`
- 改动：`pipeline/search/{models,planner,ranker,service}.py`、
  `pipeline/store/{schema,migrations,normalize,repository}.py`、
  `pipeline/api/server.py`（place/lat/lng/radiusKm 校验与透传、distanceKm、placeResolution）
- 数据库：`pipeline/data/gorgon.db` 已迁移至 schema v2
