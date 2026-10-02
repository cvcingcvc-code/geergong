# AGENTS.md — Gorgon 仓库协作规则

> 给后续接手的 AI / 人类协作者。只描述**已确认的真实状态**，不虚构目标。

## 1. Gorgon 是什么

面向上海大学生的周末活动「发现 + 同步」产品：从公开网页聚合活动（社团、市集、运动、展览、工作坊、演出），学生把感兴趣的活动**同步**进本地的「我的周末 / My Weekend」。产品的核心命题是**信息可信度**——每条聚合数据都必须可溯源、可核验。

## 2. 当前产品目标

从已验证的 Demo/检索 MVP 推进到 **Gorgon V1.0 产品化**：真实数据库、用户系统、Tauri Windows 桌面软件、安装包与自动更新。完整阶段拆解见 `docs/ROADMAP.md`，当前精确进度见 `docs/CURRENT_STATE.md`。

## 3. 真实架构（以代码为准，不是以愿景为准）

```
ui_kits/app/        legacy 前端（script 标签 + Babel Standalone 运行时，稳定，勿动）
app/                V1 正式前端（React 18 + Vite 5 生产构建，Phase 1 进行中）
components/         设计系统组件源（legacy 运行时经 _ds_bundle.js 编译；新前端直接 import）
tokens/ styles.css  设计 token 与全局样式（两个前端共用）
pipeline/           数据与检索后端（纯 Python 标准库，零第三方依赖）
  api/server.py     静态服务 + POST /api/search（单进程，白名单只放行 App 资源）
  ingest/normalize/clean/dedupe/trust/review/   数据管线
  search/           检索层：planner -> provider -> fetcher/extract -> adapter -> ranker -> service
  route/provider.py RouteProvider 接口 + MockRouteProvider（无真实地图）
  planning/models.py Itinerary 契约（只有契约，无求解器）
  data/             raw -> normalized -> work -> review -> approved 各阶段产物
  tests/            Python unittest + Node .mjs 测试 + CDP 浏览器 E2E
docs/               各 Phase 报告与部署文档
```

- **前端位置**：legacy `ui_kits/app/index.html` 由 `pipeline/api/server.py` 服务；新前端 `app/`（`npm run dev/build/preview`，产物 `app/dist/`）。两者并行，legacy 保留为 reference，禁止大规模清理。
- **后端位置**：`pipeline/api/server.py`，默认 `127.0.0.1:8000`；环境有 `PORT` 时绑 `0.0.0.0`（托管平台注入）。唯一写接口是 `POST /api/search`，且不修改服务器状态。
- **search pipeline**：确定性 Query Planner（无 LLM 也可跑）→ 多 provider（Meetup/segmentfault/豆瓣/活动行，免密钥；通用网页搜索需 `SEARCH_API_KEY`）→ 页面抓取/抽取 → 归一化 → 排序。来源不可用时如实降级（`provider_degraded` notice），**绝不造假填充**。
- **trust / dedupe / review**：`trust/scorer.py` 0-100 可解释评分；`dedupe/deduplicator.py` 两层去重（不删数据）；`review/queue.py` 按分数路由 approved / needs_review。单来源记录进人工审核是**设计如此**。
- **数据来源**：`data.js` 为 DEMO DATA（`demo:true`，UI 有 DEMO 角标）；`generated-data.js` / `generated-search-demo.js` 是 pipeline 产物（重新生成会覆盖，勿手改）；真实检索结果带 `providerMode:"real"` 与 `dataOrigin`。
- **public server**：静态文件白名单、无 CORS 头、输入校验、30 次/分钟限流、无目录列表、`--debug` 绝不与公网同开。公网只读部署见 `docs/PUBLIC_DEPLOYMENT.md`。
- **持久化状态**：只有浏览器 localStorage（`gorgon_my_weekend_items` / `gorgon_favorites` / `gorgon_selected_district` / `gorgon_admin_review` / `gorgon_demo_v1`）。无数据库、无账号，换设备不互通——这是现状不是 bug。

## 4. 测试体系（当前基线，先跑再改）

| 套件 | 数量 | 命令 |
|---|---|---|
| Python unittest | 268 | `python -m unittest discover -s pipeline/tests -t .` |
| JS view model | 125 | `node pipeline/tests/ui_view_model.test.mjs` |
| JS district | 131 | `node pipeline/tests/district.test.mjs` |
| 浏览器 E2E（Edge CDP，零依赖） | — | `node pipeline/tests/e2e_public.mjs` 等（需服务已启动） |
| V1 前端单测/构建冒烟 | 新增中 | `cd app && npm test && npm run test:build` |

共享语料 `pipeline/tests/fixtures/*.json` 同时钉住 Python 与 JS 两侧实现，两侧必须一起过。

## 5. 常用命令

```bash
python pipeline/api/server.py --port 8000          # 本地服务（real 检索）
python pipeline/api/server.py --port 8000 --mode demo   # 离线 demo 模式
python pipeline/run.py                             # 数据管线全流程
cd app && npm install && npm run dev               # V1 前端（dev 代理 /api -> 8000）
cd app && npm run build && npm run preview         # 生产构建与预览
```

## 6. 分支 / Git 规则

- 默认分支 `master`，**禁止直接修改**；每个 Phase 用 `feature/<name>` 分支，Phase 内代码只进该分支。
- 重要阶段用清晰 commit（`chore(frontend):` / `refactor(frontend):` / `test(frontend):` / `docs(frontend):` 风格）。
- 不删除现有稳定代码；旧实现保留为 legacy/reference，验证通过前不做大规模清理。

## 7. 安全规则

- `SEARCH_API_KEY` 与任何 provider key **只在服务端**，绝不进浏览器 bundle、不进仓库、不进截图与聊天记录（用环境变量；仓库无 `.env`）。
- 前端 API 地址统一走 `app/src/lib/api.js`（`VITE_API_BASE_URL` 可配），组件里禁止出现裸 API URL。
- 本地不要 `--host 0.0.0.0`；`--debug` 绝不与公网/隧道同开；用户输入由服务端校验（前端不做信任假设）。
- 不扩大现有公网暴露面：白名单、限流、无 CORS 的现状只能收紧不能放松。

## 8. 核心算法——未经明确授权禁止修改

- `pipeline/trust/scorer.py`（trust score 算法）
- `pipeline/dedupe/deduplicator.py`（dedupe 核心规则）
- `pipeline/review/queue.py`（review 路由阈值）
- `pipeline/normalize/` 归一化规则 与 `pipeline/search/ranker.py` 排序权重
- 发现与上述无关的 bug 可以修；相关的一律先记录（`docs/V1_FRONTEND_KNOWN_ISSUES.md` 或对应 Phase 文档），不擅自扩大任务范围。

## 9. 修改代码前必须先读

`readme.md` → `docs/ROADMAP.md` → `docs/CURRENT_STATE.md` → 与本任务相关的 Phase 报告（`docs/PHASE5_FINAL_REPORT.md`、`docs/PUBLIC_DEPLOYMENT.md`）→ 涉及模块的源码与其测试。

## 10. Agent 工作规则

1. 先读文档与现状，再动手；不确定就查代码，不凭印象断言。
2. 不编造命令、路径、端口、提交哈希；引用的数字必须能复现。
3. 不做超出任务范围的改动；发现额外问题先记录再请示。
4. 修改任何代码前先跑测试记录 baseline，改完再跑并对比。
5. 禁止把 secret 写入任何文件；前端 bundle 不得含任何 key。
6. 测试、文档、代码事实三者不一致时，以代码事实为准并指出不一致。
7. 每个 Phase 结束输出可核验的 PASS / FAIL / BLOCKED，不伪造通过。
