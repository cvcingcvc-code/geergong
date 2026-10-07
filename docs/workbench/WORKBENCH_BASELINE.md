# Workbench Baseline — Phase 0 最终报告

> PHASE=0 NAME=WORKBENCH_BASELINE_AUDIT DATE=2026-10-07
> 审计人：WorkBuddy。本文件只记录已验证事实，不包含未实施的计划性声明。
> 禁止事项遵守情况：未开发新功能、未修改业务逻辑、未重构、未 merge、未安装依赖、未 checkout/stash/reset、未提交任何修改。

## 1. 仓库真实状态

```text
REPO_ROOT=C:/Users/lin/Documents/Gorgon-Recovered
REMOTE=https://github.com/cvcingcvc-code/geergong.git (origin)
CURRENT_BRANCH=feature/human-review-loop
HEAD_SHA=648d8c0e38f74550140c6fcbe9a4d894eb943d3d
WORKTREE_STATUS=DIRTY（未提交修改，原样保留，未做任何处理）
```

未提交修改清单（tracked，18 files，+76/-290）：

- 修改：`docs/screenshots/`×7、`pipeline/search/service.py`（+4 行：nearby 调用加 `include_past=False, today=today` 注释与参数，属 PHASE 5 语义）、`ui_kits/admin/generated-review-data.js`、`ui_kits/app/NaturalSearchScreen.jsx`（+62/-15）
- 删除：`assets/logo-*.svg`×3、`ui_kits/admin/README.md`、`ui_kits/admin/queue.js`、`ui_kits/dashboard/README.md`、`ui_kits/dashboard/Sidebar.jsx`
- Untracked：`_loc2.json`、`_pub2.json`、`_pub_e2e_*.log`×3、`docs/screenshots/desktop-district-topk-xuhui.png`、`pipeline/data/{crawl,probe}/`、`pipeline/data/gorgon.db`、`geocode_cache.json`、`nearby_validation.json`

第二个 worktree：`C:/Users/lin/Documents/Gorgon-Travel-Agent-V1`（branch `feature/travel-agent-v1 @ 067256c`，工作区干净）。Phase 0 未触碰。

## 2. 当前分支关系

merge-base 全部为 `631cb7f`（= master HEAD）：

```text
master                     631cb7f  fix: rate-limit the real visitor behind the proxy
├── feature/demo-mvp       3eeea70  （落后 master 15，祖先关系，无独有提交）
├── feature/data-pipeline-mvp d54d37a（落后 master 14，祖先关系，无独有提交）
├── feature/human-review-loop 648d8c0（领先 master 3：PHASE 3/4/5 后端+搜索+地理）
└── feature/v1-frontend-build 5d412d9（领先 master 9：Vite+React+PWA+测试，仅 origin 存在）
    └── feature/travel-agent-v1 067256c（= merge(5d412d9, 648d8c0)，1 个 merge commit，实存 worktree）
```

human-review-loop vs v1-frontend-build：**已 diverged**（3 ahead / 9 behind），但**文件集零重叠**——hrl 只改 `pipeline/**` 与 `docs/PHASE*_HANDOFF.md`、`docs/REAL_SOURCE_Douban.md`；v1fb 只新增 `app/**`、`AGENTS.md`、`docs/{ROADMAP,CURRENT_STATE,V1_FRONTEND*}.md`。合并可行性已被 `067256c` 实证（见 §14）。

各分支定位：

```text
BRANCH=feature/human-review-loop
HEAD_SHA=648d8c0
PURPOSE=后端数据管线 + 真实检索 + 地理 + SQLite（PHASE 3/4/5）
KEY_FEATURES=crawlers/douban, store/SQLite, location/geocoder, search real providers, nearby search
UNIQUE_FILES=pipeline/{crawlers,location,store}/**, pipeline/search 更新版, api/server.py PHASE 5 版
RELATION_TO_WORKBENCH=推荐后端基线

BRANCH=feature/v1-frontend-build
HEAD_SHA=5d412d9
PURPOSE=V1 前端生产构建（Phase 1 产品化路线）
KEY_FEATURES=React18+Vite5, 6 screens, PWA(manifest+sw+icons), 27 unit/18 smoke/58 E2E 测试
UNIQUE_FILES=app/**, AGENTS.md, docs/{ROADMAP,CURRENT_STATE,V1_FRONTEND*}.md
RELATION_TO_WORKBENCH=前端迁移来源
```

## 3. 当前架构（以代码为准）

```text
ui_kits/app/        legacy 前端（Babel Standalone 运行时，稳定 reference，勿动）
ui_kits/admin/      人工审核 Admin（localStorage + decisions 导出契约）
ui_kits/dashboard/  仪表盘（本地未提交删除中）
components/         设计系统组件源（30+ 组件 + .d.ts + prompt.md）+ tokens/ + styles.css
pipeline/           纯 Python 标准库后端（零第三方依赖）
  run.py            CLI 编排：ingest→normalize→clean→dedupe→trust→review→export
  schema.py         Canonical Activity Schema
  api/server.py     静态白名单服务 + POST /api/search + /api/providers + /api/health
  search/           检索层：planner→provider→fetcher→extract→adapter→ranker→service
  crawlers/         douban 等真实站点爬虫（RawEvent 契约）
  store/            SQLite EventRepository（单写者、canonical_key upsert、search_nearby）
  location/         地理编码（GCJ-02 provenance、缓存）、距离计算、nearby 校验
  normalize/clean/dedupe/trust/review/export   确定性数据主干
  route/planning/   RouteProvider Mock + Itinerary 契约（仅契约，无求解器）
  data/             raw→normalized→work→review→approved 产物 + gorgon.db(129 events, untracked)
  tests/            453 个 Python 测试
docs/               各 Phase 报告 + HUMAN_REVIEW_CONTRACT + INFORMATION_RETRIEVAL_CONTRACT
app/                （仅在 v1fb/travel 分支）React18+Vite5 前端 + PWA
```

## 4. 前端状态（v1fb @ 5d412d9）

```text
FRONTEND_FRAMEWORK=React 18.3.1 + Vite 5.4.x（@vitejs/plugin-react 4.3.x）
REACT_VERSION=18.3.1
VITE_VERSION=^5.4.19
ENTRYPOINT=app/index.html → src/main.jsx → App.jsx
SCREENS=Discover / Search / NaturalSearch / ActivityDetail / Map / MyWeekend
STATE_STORAGE=src/store/store.js（localStorage：gorgon_my_weekend_items / gorgon_favorites / gorgon_selected_district 等，兼容 legacy key）
API_LAYER=src/lib/api.js（VITE_API_BASE_URL 可配；空值=同源 /api 由 Vite proxy 转 127.0.0.1:8000；bundle 无任何 key）
BUILD_COMMAND=npm run build（vite build → app/dist/）
TEST_COMMAND=npm test / npm run test:build / npm run test:e2e
PWA_STATUS=已具备（见 §8）
```

npm install 可行（travel worktree 已有 node_modules 且全部测试实跑通过）。无 e2e 以外的额外依赖问题。

## 5. Pipeline 状态

真实处理链（`pipeline/run.py` STAGES）：`ingest → normalize → clean → dedupe → trust → review → export`，检索链复用同一套模块。每个模块：

```text
MODULE=ingest        INPUT=data/raw/*.json        OUTPUT=data/work/ingested.json     ENTRY=ingest/json_source.py        DEPS=stdlib   WORKBENCH_REUSE=YES
MODULE=normalize     INPUT=ingested               OUTPUT=data/normalized/            ENTRY=normalize/activity.py        DEPS=stdlib   WORKBENCH_REUSE=YES（文本/日期/价格/地区全规则）
MODULE=clean         INPUT=normalized             OUTPUT=data/work/cleaned.json      ENTRY=clean/cleaner.py             DEPS=stdlib   WORKBENCH_REUSE=YES
MODULE=dedupe        INPUT=cleaned                OUTPUT=data/work/deduped.json      ENTRY=dedupe/deduplicator.py       DEPS=difflib  WORKBENCH_REUSE=YES（exact+near，不删数据）
MODULE=trust         INPUT=deduped                OUTPUT=data/work/scored.json       ENTRY=trust/scorer.py              DEPS=stdlib   WORKBENCH_REUSE=YES（0-100+named reasons）
MODULE=review        INPUT=scored                 OUTPUT=data/review/ + approved/    ENTRY=review/queue.py + apply.py   DEPS=stdlib   WORKBENCH_REUSE=YES（阈值路由+决策回放）
MODULE=export        INPUT=approved               OUTPUT=generated-data.js 等        ENTRY=export/*.py                  DEPS=stdlib   WORKBENCH_REUSE=YES
MODULE=search        INPUT=natural query          OUTPUT=ranked results              ENTRY=search/service.py            DEPS=stdlib   WORKBENCH_REUSE=YES（确定性 planner）
MODULE=store         INPUT=RawEvent               OUTPUT=SQLite events 表            ENTRY=store/repository.py          DEPS=sqlite3  WORKBENCH_REUSE=YES
MODULE=location      INPUT=place name             OUTPUT=经纬度(GCJ-02)              ENTRY=location/geocoder.py         DEPS=stdlib   WORKBENCH_REUSE=YES
MODULE=crawlers      INPUT=city config            OUTPUT=RawEvent→store              ENTRY=crawlers/run.py + douban.py  DEPS=stdlib   WORKBENCH_REUSE=YES
MODULE=api           INPUT=HTTP                   OUTPUT=JSON                        ENTRY=api/server.py                DEPS=stdlib   WORKBENCH_REUSE=YES
```

**Workbench 无需 LLM 即可直接复用的能力**：文本清洗、日期解析（`2026/09/20`/`9月20日`/`晚上7点`…）、价格解析（`免费`/`¥29`…）、地区解析、去重、Trust Score、Schema 校验、Review 路由、自然语言查询的确定性解析（城市/主题/本周末/免费/地区偏好）、多 provider 检索与合并、nearby 半径检索、排序、SQLite 存储、限流 API。

## 6. Human Review 状态

`docs/HUMAN_REVIEW_CONTRACT.md`（PHASE 3 落地）+ `pipeline/review/apply.py` + `ui_kits/admin/`：

- pipeline→Admin：`window.GORGON_REVIEW_QUEUE`（含 id/title/score/suggestion/reviewReason/trustReasons/conflicts/duplicateCandidates/status）
- Admin→pipeline：`human_decisions.json`：`{version, exportedAt, decisions: {id: {decision: approved|rejected|needs_edit, reviewedAt, edits}}}`
- edits 白名单：title/startDate/startTime/venue/district/category/price/organizer/registrationUrl；未知 id 整文件拒绝；原始 pipeline 数据永不修改
- provenance：`reviewedBy(auto|human)`、`reviewedAt`、`reviewDecision`、`humanEdited`

**Workbench 状态映射建议**（仅建议，Phase 0 未改协议）：

| 现有 | Workbench |
| --- | --- |
| pipeline 自动 approved (`reviewedBy:"auto"`) | AI_PROPOSED |
| 人工 approved（无 edits） | USER_APPROVED |
| 人工 approved（有 edits） | USER_EDITED |
| 人工 rejected | USER_REJECTED |
| （新增终态） | EXECUTED（由 workbench/task_service 持久化） |

## 7. Search 状态（REAL / DEMO / FIXTURE / FALLBACK 明确区分）

```text
REAL_PROVIDER（真实网络检索，需配置或缺 key 时如实 unavailable）:
  - 需要 SEARCH_API_KEY：brave / bing / serper / tavily / searxng（WebSearchProvider）
  - 免 key 平台直连：douban / meetup / segmentfault / eventxing（EventSiteProvider，抓平台自己的公开列表页）
  - 免 key 通用兜底：bing_html（public SERP，默认 OFF，须显式选择）
DEMO：
  - data.js（demo:true，UI 有角标）与 --mode demo 的固定场景（search/demo.py）
FIXTURE：
  - FixtureSearchProvider：26 条录制结果（search/fixtures/shanghai_ai_events.json），dataOrigin="demo"
FALLBACK：
  - 缺 key → provider 报 not_configured，绝不静默替换为 demo 数据
  - 离线（GORGON_ONLINE=off）→ 全部 outbound 禁用，如实 notice
  - /api/search 不可用时前端回退 generated-search-demo.js 并如实提示
  - 单个 provider 失败 → 空结果 + recorded reason，不拖垮整次搜索
```

Phase 0 实测：`--mode demo` smoke test 通过（/api/health ok、自然语言「周末 AI」解析出 topics=["AI"]、dateRange=this_weekend）。**真实 provider 未在 Phase 0 做实网调用验证**（无 key、避免外呼）——不能声称「已具备稳定全网实时搜索」；真实能力的证据是代码结构（providerMode 如实上报）+ douban 爬虫 100% 成功的本地抓取记录（2026-09-22，100 条）。

**比赛 Demo 依赖程度**：可完全离线跑（demo/fixture 模式，零外呼、可重复、断网可用）；有网环境可开平台直连 provider（免 key）增强真实性；带 key 的通用 web 搜索按需启用。

## 8. PWA 状态（v1fb）

```text
MANIFEST=app/public/manifest.webmanifest（name/short_name/start_url/display:standalone/icons 256+512 maskable）
SERVICE_WORKER=app/public/sw.js（手写无 Workbox：app shell 预缓存、navigation network-first、静态 cache-first、/api GET network-first+cache 兜底、跨源直通）
ICONS=icons/icon-256.png + icon-512.png
OFFLINE=SW 设计支持；pwa_offline_check.mjs 存在（Phase 0 未实跑该专项）
INSTALL_CHECK=pwa_install_check.mjs 存在（Phase 0 未实跑该专项）
```

结论：**「可安装 Web App」的基础已具备**（manifest+SW+icons+安装检查测试齐全）；两项 PWA 专项测试未在 Phase 0 实跑，不算已验证。

## 9. 当前测试结果（最后一次完整运行，2026-10-07）

Python（managed 3.13.12，`python -m unittest discover -s pipeline/tests`）：

```text
PYTHON_TESTS=Ran 453 tests — FAILED (failures=13, errors=1)
BASELINE_EXISTING_FAILURE=13（12 确定性 + 见下）
  test_nearby: 7（boundary/date_filter/keyword_filter/ordering/regression_2_9km/geocoder_unavailable/not_configured_never_degrades）
  test_store: 6（combined_filters/date_range/district_filter/keyword_matches_organizer/limit/search_returns_dicts）
  原因：fixture 日期（2026-09-26 等）已早于真实今天（2026-10-07），而 repository.search()/search_nearby() 默认 include_past=False（HEAD 提交行为，非本地修改）→ 时间性 fixture 腐化。Phase 0 不修。
ENVIRONMENT_PLATFORM_FLAKE=1
  test_public_server.test_oversized_body_is_refused：ConnectionAbortedError [WinError 10053]（服务器拒绝超大 body 主动断连，Windows 下客户端偶发报连接中止）。单独复跑该用例=OK；整组复跑多数无此 error，不能稳定复现。
NEW_REGRESSIONS=0
```

前端（travel worktree，v1fb 代码）：

```text
FRONTEND_UNIT_TESTS=27/27 PASS
BUILD_SMOKE=18/18 PASS（含 secret 泄露扫描：bundle 无 SEARCH_API_KEY、无服务器路径）
E2E=58/58 PASS（CDP 三视口 desktop-1920/tablet-768/mobile-390：boot/卡片/筛选/搜索/trust/溯源/MyWeekend 重载/Map/console errors=0）
VITE_BUILD=PASS（1709 modules，dist 329.09 kB JS gzip 96.33 kB，23.89s）
```

启动 smoke test：

```text
BACKEND：python pipeline/api/server.py --port 18765 --mode demo → /api/health {"status":"ok","providerMode":"demo"} ✓；POST /api/search 自然语言解析正常 ✓
FRONTEND：npm run dev（5173，proxy /api→8000）；preview 4173（E2E 已实际使用）
```

## 10. 当前已知问题

1. **测试时间腐化（13 failures）**：test_nearby×7 + test_store×6，fixture 日期过期 + include_past=False。属于 BASELINE_EXISTING_FAILURE，Phase 0 未修（按指令）。
2. **Windows 平台偶发（1 error）**：WinError 10053，test_public_server 拒绝连接场景，不能稳定复现，ENVIRONMENT_PLATFORM_FLAKE。
3. **工作区脏状态**：hrl worktree 18 个未提交 tracked 修改 + 多个 untracked 数据文件。其中 `pipeline/search/service.py` 的 +4 行（include_past 显式化）与 `NaturalSearchScreen.jsx` 的 +62 行属潜在有价值工作，但归属与提交决定权在用户，Phase 0 只记录。
4. **legacy 删除进行中（未提交）**：assets/logo-*.svg、ui_kits/admin/{README,queue.js}、ui_kits/dashboard/{README,Sidebar} 被本地删除；`ui_kits/admin/queue.js` 是 Admin 的 DEMO fallback 数据，若确认删除需检查 review-data.js 的 fallback 链是否完整。
5. **PWA install/offline 专项测试未实跑**。
6. **真实 provider 未做实网验证**（Phase 0 无 key、不外呼）。
7. **route/planning 是契约空壳**（Mock RouteProvider、Itinerary 仅 models.py）——Workbench 任务规划层需新建，但这是 NEW 不是缺陷。
8. **origin/feature/v1-frontend-build 仅存在于远程**（本地无该分支），迁移时需先 `git fetch origin` 确保对象在本地。

## 11. 可复用资产

见 `WORKBENCH_REUSE_MAP.md`（KEEP 15 项 / ADAPT 8 项 / MIGRATE 4 项 / NEW 3 项）。复用率估算 **≈80%**。

## 12. 后续不应重写的部分

`pipeline/search/`（6645 行检索链）、`pipeline/store/`、`pipeline/trust/`+`pipeline/review/`、`pipeline/normalize/`+`clean/`+`dedupe/`、`pipeline/api/server.py`、`components/` 设计系统、v1fb `app/src/` 前端。理由见 REUSE_MAP「千万不要重写」节。

## 13. 推荐 Workbench 基线分支

```text
BASELINE=feature/human-review-loop @ 648d8c0（后端/检索/Human Review/地理最完整的分支）
WORKBENCH_BRANCH=feature/workbench-competition @ 648d8c0
```

`feature/workbench-competition` 已按补充要求创建为**纯 branch ref 指向干净的 648d8c0**：未 checkout、未 stash、未 reset、未提交任何当前未提交修改；hrl worktree 的脏修改原样保留在原分支，未带入 Workbench 分支。

## 14. 推荐前端迁移策略

```text
MIGRATE_FROM=origin/feature/v1-frontend-build @ 5d412d9
MIGRATE=app/（整目录）+ AGENTS.md（+ 按需 docs/{ROADMAP,CURRENT_STATE,V1_FRONTEND*}.md）
DO_NOT_MERGE_BLINDLY=true
```

**首选：文件级迁移**（`git checkout origin/feature/v1-frontend-build -- app/ AGENTS.md`），因为它零冲突、不带入 9 个 docs/test commits 的历史、不触碰 Phase 3/4/5 后端任何文件。

**merge 整分支也是安全的**：`feature/travel-agent-v1 @ 067256c` 正是 merge(5d412d9, 648d8c0)，commit message 实证 "no conflicts: v1-frontend-build did not modify any pipeline/* file"，且两分支改动文件集零重叠（§2）。但 merge 会带入 9 个 commit 的 docs 历史，基线不如文件级干净。

**travel-agent-v1 定性**（仅记录，Phase 0 未 merge/checkout/cherry-pick）：它不是「v1fb + 1 个普通 commit」，而是 1 个 merge commit `chore(integration): establish travel agent v1 worktree baseline`（author Travel Agent V1，2026-10-07 16:03），内容=v1fb 前端 + hrl 后端的组合基线预演，附 `docs/TRAVEL_AGENT_V1_BASELINE.md`。对 Workbench 的价值=merge 可行性的现成证据（其 worktree 中 E2E/单元/构建全绿就是在组合形态下跑出的）；其「travel-agent」方向的后续演进对 Workbench 无直接迁移价值，不作为基线。

## 15. 推荐桌面打包方案

```text
DESKTOP_PACKAGING_RECOMMENDATION=pywebview + PyInstaller（React/Vite → vite build → Python backend → pywebview → PyInstaller → Gorgon Workbench.exe）
```

评估矩阵与理由见 `WORKBENCH_TARGET_ARCHITECTURE.md` §5。要点：后端纯标准库 → pywebview 是唯一零改后端形态的方案；PWA 保留为手机/零安装形态；Tauri 引入 Rust 工具链超比赛预算；Electron 包体与栈不匹配。注意：PyInstaller 需处理 `pipeline/data/` 缓存/DB 到用户数据目录；目标机需 WebView2（Win10/11 默认有）。Phase 0 未接入任何桌面框架。

## 16. Phase 1 的最小范围（建议，未开始）

1. `git fetch origin` 后在 `feature/workbench-competition` 上（建议在新 worktree 或干净 checkout 中）迁入 `app/` + `AGENTS.md`，复跑 27/18/58 测试建立新基线。
2. 新建 `workbench/` 骨架（router/task_service/skills 接口 + tests），首个 skill 只做 search_skill 包装 `search_events()`，全程确定性、零 LLM。
3. Workbench UI 最小一屏（目标输入→结果→审核动作），复用 AppShell 与 review 契约。
4. 决定 hrl worktree 未提交修改的去留（用户裁决），并处理 §10-4 的 legacy 删除一致性。
5. 暂缓：LLM 接入、pywebview、Task Router 复杂规划（均须按 TOKEN_STRATEGY 白名单流程另立任务）。

## Phase 0 Gate

```text
[x] REPO_ROOT 已确认
[x] CURRENT_BRANCH 已确认
[x] 所有重要分支已审计（5 分支 + travel-agent-v1 + 2 worktrees）
[x] human-review-loop 与 v1-frontend-build 已比较（3/9 diverged，文件零重叠）
[x] 前端技术栈已确认（React 18.3.1 + Vite 5.4）
[x] Pipeline 已确认（7 阶段 + 检索链 + store/location/crawlers）
[x] Human Review 已确认（契约 + apply.py + admin UI）
[x] Search 已确认（REAL/DEMO/FIXTURE/FALLBACK 分级）
[x] Token Strategy 已确认（已成文且代码一致）
[x] PWA 状态已确认（资产齐全；专项测试未实跑已注明）
[x] 现有测试已实际运行（453 Python / 27+18+58 前端）
[x] Build 已实际验证（vite build PASS + 后端 smoke PASS）
[x] 已生成 WORKBENCH_BASELINE.md
[x] 已生成 WORKBENCH_REUSE_MAP.md
[x] 已生成 WORKBENCH_TARGET_ARCHITECTURE.md
[x] 未重构业务代码（仅新增 docs/workbench/ 三份文档 + 1 个 branch ref）
[x] 未进入 Phase 1
STATUS=PASS
```
