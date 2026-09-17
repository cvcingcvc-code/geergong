# DISTRICT FILTER REPORT

PHASE 5.1 — 上海区级地区筛选闭环。仓库 `C:\Users\lin\Documents\Gorgon-Recovered`，分支 `feature/human-review-loop`。
本次只做一件事：把地区从"静态展示"变成**真正可用的、四屏同步的上海区级筛选**。没有重做 UI、没有改 Design System、没有改搜索 provider / trust score / dedupe / review loop。

---

## IMPLEMENTED

### 1. 一个地区模块，四个入口共用

`ui_kits/app/district.js` 是整件事的唯一真源，它同时拥有三样东西：

| 职责 | 说明 |
|---|---|
| 上海区名词表 | 与 `pipeline/normalize/location.py::DISTRICTS` 同表同序 |
| 地区归一 | `"上海市徐汇区" / "徐汇区" / "上海·徐汇" / "上海徐汇"` → `徐汇` |
| 归属判定 | `matches(rec, 选择)` / `filter(list, 选择)` / `options()` / `counts()` / `emptyTitle()` |

它是 pipeline 那个 `normalize_district` 的**镜像**，不是第二套地区识别逻辑。两边靠
`pipeline/tests/fixtures/district_corpus.json`（39 条语料）钉在一起：Python 套件与 JS 套件
**各自断言同一份语料**，谁改了规则只有一边改、另一边就必然变红。实测两侧对 39 条输入结果完全一致。

现存数据里出现过的写法都已覆盖：`徐汇`、`徐汇区`、`上海市徐汇区`、`上海徐汇`、`上海·徐汇`、
`上海 - 徐汇`、`上海—徐汇`、`上海，徐汇`、`上海市徐汇区龙腾大道2600号`、`上海市杨浦区淞沪路创智天地`、
`浦东新区`、`上海市浦东新区`。
外地/未知一律**保持未知**（`北京·朝阳`、`火星`、`上海`、`上海·` → `null`），绝不猜成某个上海区。

### 2. 一个选择器，一处状态

- `ui_kits/app/district-picker.jsx` — 胶囊按钮 `上海 · 徐汇`，点开是地区浮层（`全上海` + 支持区 + 各区当前条数）。
- 状态放在 `index.html` 的 `App`（和 `weekend` 同级），作为 Discover / Search / Map / 智能 的共享 props。
  **没有另造第二套 filter store。**
- 持久化复用现有 `GorgonStore`（`store.js`），新增 key 就是要求的 `gorgon_selected_district`。
  `getDistrict()` 会**消毒**：只有 `全上海` 或真实上海区才被接受，脏值（`火星`、手改过的 storage、旧数据集里的区）
  一律退回 `全上海` —— 退化方向永远是**放宽**，不可能把数据藏在一个不存在的区后面。
- `demo-reset.js` 的"重置 Demo"一并清掉这个 key。

浮层用 `ReactDOM.createPortal` 挂到 `<body>`，这不是审美问题：手机上选择器在手机壳里，而手机壳是
`overflow: hidden`（`position: fixed` 会被直接裁掉）；地图上选择器在地图控制层里，那一层自带 `z-index`
（自成层叠上下文，浮层会被压在地图搜索框和底部卡片下面）。Portal 是唯一同时解决两者的做法。

### 3. 四屏联动

| 屏 | 做法 |
|---|---|
| 发现 Discover | 顶部（桌面 + 手机）地区胶囊；列表、`共 N 场活动`、统计卡全部来自同一个过滤数组；筛选抽屉里的区胶囊改用同一状态，两处控件零分歧 |
| 搜索 Search | 关键词与地区**AND**：先按关键词取池，再按地区取交；计数与空状态都出自同一个结果数组 |
| 地图 Map | pin、右侧地点栏、`附近/徐汇 N 场` 计数、底部卡片全部来自过滤后的数组；空集渲染空状态而**不再崩**（旧代码在 0 条时会 `_MCATS[undefined]` 抛错） |
| 智能（真实检索） | 在**已返回**的结果上做同一套客户端过滤；不改 provider、不改请求、不改 trust/ranker |

顺带把顶部 chrome 的地区胶囊也改成显示**同一份选择**。原先它写死 `上海·杨浦`（用户资料里的常驻校区），
一旦地区成了可改的真筛选，chrome 上那个永不移动的区名就成了同一屏里第二个、且互相矛盾的地区展示。

---

## SUPPORTED DISTRICTS

菜单 = `全上海` + 基线区 ∪ 当前数据集里真实出现的区（且必须是上海区）。

基线（要求里的"至少支持"）：`徐汇 浦东 静安 黄浦 长宁 杨浦 闵行 普陀 虹口 宝山`

当前构建（`generated-data.js` 生效）实际菜单：`全上海 · 徐汇 · 浦东 · 静安 · 黄浦 · 长宁 · 杨浦 · 闵行 · 普陀 · 虹口 · 宝山 · 嘉定`
—— `嘉定` 是数据里出现后**自动加入**的。切到 `data.js` 回退数据集时，`松江` 同样会自动加入。

同时**不会**出现数据里不存在的地区：词表里虽有 `金山/青浦/奉贤/崇明`，数据里没有就不进菜单；
`北京`、`火星` 这类更不可能进（单测里专门喂了外地/未知记录，断言菜单干净）。

⚠️ 基线里有 6 个区在当前数据集是 0 条（`浦东/静安/黄浦/闵行/虹口/宝山`）。这是要求里"至少支持"的直接结果，
不是 bug —— 它们能被选、会被如实告知为空（空状态 + 菜单里 `0 场`），这恰好也让"无结果组合"可复现。

---

## DISCOVER: PASS

- 默认 `全上海`，顶部显示 `上海 · 全上海`；未筛选时 17 条 = 全部。
- 选 `徐汇` → 顶部变 `上海 · 徐汇`，卡片 5 张且**每一张的 district 都属于徐汇**，`共 5 场活动`、
  统计卡 `5 个活动` 与卡片数**相等**（不是"大于 0"这种松断言）。
- 数量确实变了（5 / 17），不是只改文案。
- 筛选抽屉里的区胶囊与顶部胶囊同源，点已选中的区即清除。

## SEARCH: PASS

- 关键词与地区 AND：`全上海 + AI` = 4 条；`徐汇 + AI` = 2 条（= 4 与 5 的**交**，且严格小于两者之和 → 不是并集）。
- 切换地区**不需要重新搜索**，已返回的结果即时重算。
- 计数 `找到 N 场相关活动` 与卡片数相等，并标注 `· 范围：徐汇`。

## MAP: PASS

- `徐汇` → 5 个 pin，全部 `data-gg-pin-district="徐汇"`；右侧地点栏 5 条；`徐汇 5 场` 与 pin 数相等。
- 从 Discover / Search 进 Map，地区保留（同一份 App 状态）。
- 切回 `全上海` → 17 个 pin 恢复。
- 选 `静安`（当前 0 条）→ 0 pin，显示 `静安暂无活动`，而不是把别的区画上去。

## PERSISTENCE: PASS

- 选择写入 `localStorage["gorgon_selected_district"]`（值为 JSON 字符串 `"徐汇"`）。
- 整页 reload（`ignoreCache: true`）后仍是 `徐汇`、仍是 5 张卡。
- 单测另覆盖：脏值消毒、`全上海` 往返、`Reset Demo` 清空、以及"其它构建里的区仍作为选中行显示"。

## EMPTY STATE: PASS

- `徐汇 + 工作坊`（真实无结果）→ `徐汇暂无符合条件的活动`，**0 张卡**，没有 fallback、没有拿别的区填满。
- 只有地区筛选且该区为空 → `徐汇暂无活动`（单测覆盖两种文案分支）。
- 地图 → `静安暂无活动`；智能屏 → `徐汇暂无符合条件的活动` 并说明「本次检索找到 N 个活动，其中没有位于徐汇的」。
- 空状态都给出"恢复"入口（清除筛选 / 在整个上海范围内搜索 / 查看全上海）。

## E2E: PASS

真实浏览器（headless Edge + CDP，1920×1080 与 390×844，每次唯一 profile + 禁用缓存）：

- `pipeline/tests/e2e_district.mjs` — **45/45 通过**（**真实检索模式**，`--mode real`）。
- `pipeline/tests/e2e_phase5.mjs`（原有回归）— **35/35 通过**，其中 `REAL SEARCH` 徽标成立、26 张真实结果卡。
- 覆盖了要求里的 10 条：默认全上海 / 选择徐汇且顶部更新 / 所有卡片属于徐汇 / 数量=卡片数 /
  徐汇+AI 同时生效 / 刷新仍是徐汇 / 地图只显示徐汇 / 切回全上海恢复 / 无结果组合的空状态 / console 零 error。
- 额外：chrome 与页面显示同一地区；智能屏 25 条真实结果按区收窄（`浦东 → 6 条`，并披露"另有 19 个结果不在浦东，已隐藏"）。

## TEST RESULT

| 套件 | 结果 |
|---|---|
| Python `pipeline/tests` | **222 通过**（206 原有 + 16 新增 `test_district.py`） |
| JS `ui_view_model.test.mjs` | **125 通过** |
| JS `district.test.mjs`（新增） | **131 通过** |
| E2E `e2e_district.mjs`（新增） | **45/45** |
| E2E `e2e_phase5.mjs`（回归） | **35/35** |

新增覆盖正好是要求点名的那几项：`徐汇区 → 徐汇`、`上海市徐汇区 → 徐汇`、district filter、
keyword + district filter、localStorage 持久化、empty state、map filtered dataset、count = rendered cards。

本次真实检索实况：90 条原始信息 → 25 个活动（0 已确认 / 23 待核验）。

截图（`docs/screenshots/`）：`desktop-district-1-default`、`-2-xuhui`、`-3-search-and`、`-4-search-empty`、
`-5-map-xuhui`、`-6-map-empty`、`-7-smart-filtered`、`mobile-district-8-picker`。

---

## FILES CHANGED

**新增**

| 文件 | 作用 |
|---|---|
| `ui_kits/app/district.js` | 区名词表 + 归一器（镜像 `pipeline/normalize/location.py`）+ 过滤/选项/计数/空状态文案 |
| `ui_kits/app/district-picker.jsx` | 共享地区选择器（胶囊 + portal 浮层），四屏共用 |
| `pipeline/tests/fixtures/district_corpus.json` | 39 条共享语料，Python 与 JS 双侧同时断言 |
| `pipeline/tests/test_district.py` | 16 个 Python 测试（语料对齐 / 真实记录可筛 / 数据已归一 / 过滤严格性） |
| `pipeline/tests/district.test.mjs` | 131 个 JS 测试（含真实数据集与假 localStorage） |
| `pipeline/tests/e2e_district.mjs` | 45 项浏览器 E2E |
| `docs/DISTRICT_FILTER_REPORT.md` | 本报告 |
| `docs/screenshots/*-district-*.png` | 8 张证据截图 |

**修改**

| 文件 | 改动 |
|---|---|
| `ui_kits/app/store.js` | 新增 `gorgon_selected_district` 的读/写/消毒，并纳入 `reset()` |
| `ui_kits/app/index.html` | 加载两个新文件；`App` 持有 district 状态并下发四屏 |
| `ui_kits/app/DiscoverScreen.jsx` | 顶部地区胶囊（桌面+手机）、共享状态、数量与空状态更正、抽屉区胶囊同源 |
| `ui_kits/app/SearchScreen.jsx` | 地区胶囊 + keyword AND district + 两种空状态 |
| `ui_kits/app/MapScreen.jsx` | 地区胶囊、过滤后的 pin/地点栏/计数、空状态、空集不再抛错 |
| `ui_kits/app/NaturalSearchScreen.jsx` | 地区胶囊 + 对已返回结果做同一套过滤 + 隐藏条数披露 + 汇总面板说明 |
| `ui_kits/app/AppShell.jsx` | 顶部 chrome 的地区胶囊改为显示同一份选择 |
| `ui_kits/app/activity-view.js` | 视图模型的 `district` 改走同一个归一器（旧快照就地归一，幂等） |
| `ui_kits/app/demo-reset.js` | 回退分支一并清掉地区 key |
| `docs/screenshots/desktop-1..4, mobile-5..6` | 由回归跑更新（顶部 chrome 变了，旧图已过期） |

---

## KNOWN LIMITATIONS

1. **没做的（按要求）**：城市切换、全国地区、定位权限、GPS、真实地图 SDK、搜索 provider 改动、
   trust score 改动、dedupe 改动、review loop 改动、页面视觉重做。只完成上海区级筛选闭环。
2. **数据是本位上海**：pipeline 的 demo MVP 就是上海范围。一条 `北京·朝阳` 的记录不会被任何可选地区命中，
   只在 `全上海` 下出现 —— 不隐藏、也不猜成某个上海区。
3. **基线里 6 个区当前为 0 条**（浦东/静安/黄浦/闵行/虹口/宝山）。这是"至少支持"的必然结果，
   用空状态如实呈现，不作为缺漏处理。
4. **智能屏是在已返回结果上做客户端过滤**：自然语言请求里的 `locationPreference` 完全没碰。
   代价是选了区之后仍然按全城检索再收窄（多取了些数据），且汇总面板的数字描述的是**全城检索** ——
   面板里已显式标注"合计 N 个活动来自整个上海"，避免与列表自相矛盾。
5. **地区不参与排序**：过滤发生在排序之后，只做删减，不会因为某个区结果太少就把别的区往上顶。
6. **provider 失败的真实复现**：本次两轮真实检索中没有任何来源报 `available === false`，
   所以"来源降级不取消地区筛选"是靠**结构**保证的（过滤是结果列表的纯函数，不读 provider 状态；
   `provider_degraded` 提示独立渲染），并非靠复现一次真实故障验证。S6 断言是"若无降级则跳过"的形式。
7. **选择器不在全局 chrome 上可点**：chrome 那片只做镜像显示，改地区在页面内的胶囊里（一台设备只有一个选择器，
   避免两个控件同屏）。
8. **智能屏搜索前不显示各区条数**：菜单显示 `0 场` 会是假陈述（那时还没有结果集），所以搜索前刻意不显示计数。
9. 本次真实检索跑会重写 `pipeline/data/*` 等运行产物；这些与本次改动无关的检索内容churn已还原，
   不混进这次提交。
