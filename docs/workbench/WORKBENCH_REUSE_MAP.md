# Workbench Reuse Map — 哪些资产如何进入 Gorgon Workbench

> Phase 0 审计结论（2026-10-07）。基于 `feature/human-review-loop`（HEAD `648d8c0`，本仓库当前分支）与 `origin/feature/v1-frontend-build`（HEAD `5d412d9`）的真实代码，不基于任何愿景文档。
>
> 裁决原则：**新增 Adapter Layer，不重写 pipeline**。Workbench 的 router/task_service/skills 全部走「调用现有模块」的方式接入，禁止复制粘贴 pipeline 代码。

## 结论速览

- 推荐基线分支：`feature/human-review-loop @ 648d8c0`（后端 + Human Review + 真实搜索 + 地理链最完整）。
- Workbench 分支：`feature/workbench-competition @ 648d8c0` 已创建（branch ref only，未 checkout；当前 worktree 的未提交修改未被带入）。
- 前端迁移：从 `origin/feature/v1-frontend-build` 迁入 `app/` + `AGENTS.md`（文件级 checkout，零重叠冲突）。备选方案 merge 整个 v1fb 分支已被 `feature/travel-agent-v1 @ 067256c` 实证零冲突（该 commit 正是 5d412d9 + 648d8c0 的 merge，commit message 记录 "no conflicts: v1-frontend-build did not modify any pipeline/* file"），但会带入 9 个 docs/test commits 的历史噪音，首选仍是文件级迁移。
- 复用率估算：**≈ 80%**（后端几乎全保留，前端复用 shell/screens/store，新增 Workbench 专属 screens）。
- 桌面打包：pywebview + PyInstaller（详见 WORKBENCH_TARGET_ARCHITECTURE.md §5）。

## KEEP（基本原样保留）

| 资产 | 位置 | 说明 |
| --- | --- | --- |
| 完整数据管线 | `pipeline/` 全部 7 阶段 | ingest→normalize→clean→dedupe→trust→review→export，453 个测试，全程无 LLM、纯标准库 |
| 确定性搜索链 | `pipeline/search/`（约 6645 行） | planner→providers→fetcher→extract→adapter→ranker→service；真实 providers（Brave/Bing/Serper/Tavily/SearXNG 需 key；bing_html 免 key；活动平台直连：豆瓣/Meetup/活动行/segmentfault）+ fixture demo 模式；缺 key/离线时如实降级（provider `not_configured`/`offline` notice），绝不静默造假 |
| Trust / Dedupe / Review 机制 | `pipeline/trust/scorer.py`, `pipeline/dedupe/deduplicator.py`, `pipeline/review/` | 0-100 可解释评分；两层去重（exact + difflib 0.82，不删数据）；阈值路由 + 人工决策回放（decisions 文件契约完整） |
| SQLite 持久层 | `pipeline/store/`（repository/schema/migrations/stats/import_json/normalize） | 单写者模型、canonical_key upsert、search_nearby（距离过滤）、include_past 语义（`search()`/`search_nearby()` 默认排除过去事件） |
| 真实数据采集 | `pipeline/crawlers/douban.py` + `pipeline/data/crawl/douban_events.json`（100 条真实豆瓣事件） + `pipeline/data/gorgon.db`（129 events，未跟踪本地数据） | 豆瓣同城上海真实抓取（10 页 100 活动、100% 成功），REAL 数据，带 source_url 可溯源 |
| Human Review 契约与 Admin UI | `docs/HUMAN_REVIEW_CONTRACT.md` + `pipeline/review/apply.py` + `ui_kits/admin/` | approved/rejected/needs_edit、edits 白名单、reviewedAt/humanEdited/reviewedBy provenance、未知 id 拒绝整文件 |
| API Server | `pipeline/api/server.py` | 静态白名单 + POST /api/search + /api/providers + /api/health、30/min 限流、demo/real/hybrid 模式、无 CORS、无内部信息泄露；smoke test 实测 /api/health 与 /api/search 均响应正常 |
| Token Strategy 原则 | `pipeline/docs/TOKEN_STRATEGY.md` | 「能用确定性代码完成的，绝不调用 LLM」已成文规则；白名单场景（复杂语义分类/深度同活动判定/长文抽取/冲突解释/质量判断）与 Workbench 的 LLM 接入点完全兼容 |
| 检索层契约文档 | `docs/INFORMATION_RETRIEVAL_CONTRACT.md` | 请求/计划/结果/元数据结构（status/providerMode/notices/providers/stages）已成文 |
| 位置/地理模块 | `pipeline/location/` | PlaceResolver 地理编码（GCJ-02 provenance + 持久缓存 geocode_cache.json）、distance、nearby validate、backfill |
| 设计系统 | `components/`（30+ 组件源码 + .d.ts + prompt.md） + `tokens/` + `styles.css` | legacy 运行时与新前端共用 token |
| 前端 Shell 与 Screens | `app/src/`（v1fb 分支） | AppShell、6 screens（Discover/Detail/Search/NaturalSearch/Map/MyWeekend）、store.js（localStorage）、api.js（VITE_API_BASE_URL 可配，bundle 无 key）、全部 lib |
| PWA 资产 | `app/public/manifest.webmanifest` + `sw.js` + icons（256/512） | 手写 SW（无 Workbox）：app shell 预缓存、navigation network-first、静态 cache-first、/api network-first；PWA install/offline 检查测试存在（未在 Phase 0 实跑） |
| 前端测试体系 | `app/tests/`（7 个 .mjs） | 单元 27/27 + build-smoke 18/18（含 secret 泄露扫描）+ E2E 58/58（CDP 三视口），Phase 0 实测全绿 |
| 工程规范文档 | v1fb `AGENTS.md` / `docs/ROADMAP.md` / `docs/CURRENT_STATE.md` | 先读文档再扫仓、conventional commits、禁止越权实现 |

## ADAPT（稍微包装即可成为 Workbench 能力）

| 资产 | 位置 | Workbench 包装方式 |
| --- | --- | --- |
| 搜索链 `search_events()` | `pipeline/search/service.py` | 已是纯函数式编排器：包一层 `workbench/skills/search_skill.py`，把 SearchRequest/结果转为 Workbench Task step 输出；保留 providerMode/notices 如实降级语义 |
| 附近搜索 `nearby_search_payload()` | `pipeline/search/service.py` | 同上，作为「信息搜索」skill 的 geo 变体 |
| Trust 排序与理由 | `pipeline/trust/scorer.py` | 输出已是「分数 + named reasons」结构，直接作为「来源可信度」step 的展示与路由依据 |
| Review 决策回放 | `pipeline/review/apply.py` | Workbench 的人工审核节点直接复用 decisions 文件格式（version/decisions/{id:{decision,reviewedAt,edits}}）；AI_PROPOSED→USER_APPROVED 映射见 BASELINE §7 |
| Admin 审核界面 | `ui_kits/admin/` | 可作为 Workbench「审核中心」的参考实现或移植 screen；generated-review-data.js 导出契约不变 |
| 爬虫基类与豆瓣实现 | `pipeline/crawlers/` | 新来源接入照抄 `base.py` 契约即可；Workbench「信息搜索」的深度抓取直接调 douban.py |
| PWA | `app/public/` | 比赛阶段 PWA（可安装 Web App）+ 桌面 exe 双形态；PWA 零改动 |
| `include_past=False` 默认值 | `pipeline/store/repository.py` | 已是 HEAD 提交行为，Workbench 照用；新增时间敏感场景注意测试 fixture 日期（见 BASELINE §10 已知问题） |

## MIGRATE（需要从其他分支迁入）

| 资产 | 来源 | 迁入方式 |
| --- | --- | --- |
| Vite + React 前端（`app/` 全目录） | `origin/feature/v1-frontend-build`（5d412d9） | 文件级：`git checkout origin/feature/v1-frontend-build -- app/`。v1fb 的 9 commits 未改动任何 pipeline/* 文件（travel-agent-v1 的 merge 已实证），与 hrl 基线零重叠 |
| `AGENTS.md` 协作规范 | `origin/feature/v1-frontend-build` | 同上文件级 checkout |
| （可选）前端文档 | v1fb `docs/ROADMAP.md` / `docs/CURRENT_STATE.md` / `docs/V1_FRONTEND_*.md` | 按需 checkout，注意与 hrl 侧 docs 无冲突 |
| （仅参考，不合入）travel-agent-v1 | `feature/travel-agent-v1`（067256c，另一 worktree `Gorgon-Travel-Agent-V1`，工作区干净） | 它是 5d412d9 与 648d8c0 的 **merge commit**（不是 v1fb+1 个普通 commit），实证两分支零冲突、后端模块 py_compile 全过。价值=merge 可行性证据 + 现成组合预演；Phase 0 不 merge/checkout/cherry-pick，仅记录 |

## REPLACE（确实不适合继续使用）

| 资产 | 位置 | 原因 |
| --- | --- | --- |
| （无必须替换项） | — | Phase 0 审计未发现必须替换的模块。legacy `ui_kits/app/` 按 AGENTS.md 保留为 reference（「禁止大规模清理」），Workbench 不以其为新 UI 基础即可 |
| （观察项）`ui_kits/dashboard/` README+Sidebar、`ui_kits/admin/` README+queue.js、`assets/logo-*.svg` | 当前 worktree 未提交删除 | 这些删除属于**用户未提交工作**，Phase 0 只记录不处理、不还原、不提交 |

## NEW（Workbench 必须新建的最小模块）

| 模块 | 位置（目标） | 说明 |
| --- | --- | --- |
| workbench 入口与编排 | `workbench/` | router（目标→任务分解，确定性规则优先）、task_service（状态机 draft→plan_approved→executing→done，SQLite 持久化复用 store 单写者模式）、skills（search/organize/plan 薄封装）、ai_provider（可选 LLM，仅 TOKEN_STRATEGY 白名单场景）、token_budget（预算计量） |
| Workbench UI screens | `app/src/screens/` 新增 | 目标输入页、审核中心（复用 admin 设计语言）、任务进度视图；复用 AppShell/store，不动现有 6 screens |
| 桌面打包 | `desktop/` | pywebview 壳 + PyInstaller spec（Phase 1+ 评估后实施，Phase 0 未接入） |

## 哪些模块千万不要重写

1. **`pipeline/search/` 整个检索链** — 6645 行、真实 providers、fixture 测试、providerMode 诚实降级机制。Workbench 的「信息搜索」skill 只是它的一层壳。
2. **`pipeline/store/` SQLite 层** — 单写者事务模型与 canonical_key upsert 是数据一致性的根基，search_nearby 已含距离过滤与排序。
3. **`pipeline/trust/` + `pipeline/review/`** — 可解释评分 + 人工决策回放是 Workbench Human-in-the-loop 的直接基础，decisions 契约已在 pipeline→admin→pipeline 往返中验证。
4. **`pipeline/normalize/` + `pipeline/clean/` + `pipeline/dedupe/`** — TOKEN_STRATEGY 的确定性主干，453 个测试覆盖。
5. **`pipeline/api/server.py`** — 公网安全模型（白名单/限流/无 CORS/无泄露）经过 PUBLIC_DEPLOYMENT 实战。
6. **`components/` 设计系统 + v1fb `app/src/` 前端** — 6 screens + store + api 层已过 E2E，Workbench UI 在其上增量添加 screen。
