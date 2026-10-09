# Test Report — Gorgon Workbench `1.0.0-competition`

**日期** 2026-10-09 · **分支** `feature/workbench-competition` · **HEAD** `848c6c0`（Phase 8 提交）
**结论：Release Gate PASS —— 全部 5 个套件全绿，新增回归 0，仓库内明文密钥 0。**

---

## 1. 总览

| # | 套件 | 命令 | 结果 |
| --- | --- | --- | --- |
| 1 | 单元测试 | `node --test "tests/*.test.mjs"`（在 `app/`） | **205 / 205 PASS** |
| 2 | 构建冒烟 + 密钥扫描 | `node tests/build-smoke.mjs`（在 `app/`） | **18 / 18 PASS** |
| 3 | 遗留前端 E2E | `node tests/e2e_v1_frontend.mjs`（在 `app/`） | **58 / 58 PASS** |
| 4 | Workbench E2E | `node tests/e2e_workbench_shell.mjs`（在 `app/`） | **93 / 93 PASS** |
| 5 | 桌面冒烟（含打包 EXE） | `python pipeline/tests/desktop_smoke.py` | **19 / 19 PASS** |
| — | **打包 EXE 无头自检** | `"Gorgon Workbench.exe" --selftest` | **8 / 8 PASS** |

```text
合计            = 205 + 18 + 58 + 93 + 19 = 393 项断言全绿
NEW_REGRESSIONS = 0
API_KEYS_IN_REPO= 0
```

> 运行环境：Node v22.22.2、Python 3.14.2（含 pandas 3.0.1）、Windows x64。
> E2E 会真实启动 API + `vite preview` 并用 CDP 驱动无头浏览器，
> 因此**必须先确认 8000 / 4173 / 4175 端口空闲**（外部进程占用会造成假失败）。

---

## 2. 各套件覆盖内容

### 2.1 单元测试（205）

覆盖确定性核心：任务状态机与合法转移、路由规则与上限（最多 3 个技能、未知意图不猜）、
Runner 单一写入口与并发护栏、五个技能的行为、AI 闸门（11 步判定与硬拒绝）、
Provider 选择、降级链与缓存、提议状态机与仓储护栏、演示种子幂等性。

重点新增加固（本版）：

| 文件 | 断言数 | 守的是什么 |
| --- | --- | --- |
| `ai-eligibility.test.mjs` | 31 | 闸门：硬拒绝优先于复杂度；禁用技能短路 |
| `ai-assisted-skills.test.mjs` | 18 | 四个技能经同一桥接；无 AI 时保持同步契约 |
| `proposal-model.test.mjs` | 14 | 提议转移白名单；`edited → approved` 仍需人工确认 |
| `demo-chain.test.mjs` | 8 | **演示链路 AI_CALLS=0**；search 恰好一次；Mock 不得替换内容 |
| `demo-mode.test.mjs` | 7 | 演示种子幂等、可注入、不误写真实仓储 |

### 2.2 构建冒烟（18）

确认产物是**真正的生产构建**：无 Babel Standalone、无 React 开发版、
无运行时 JSX 转译、图标由 React 拥有（无 `window.lucide`）、资源已内联哈希；
并扫描 bundle 内**无任何密钥模式**、无服务器内部路径、无绝对文件系统路径。

### 2.3 遗留前端 E2E（58）

守住**兼容契约**：`?legacy=1` 仍启动 Discover、五个 `data-gg-nav` 入口齐备、
桌面/平板/移动三档视口与移动底部导航正常、控制台零错误。
即「新增 Workbench 没有破坏老产品」。

### 2.4 Workbench E2E（93）

按阶段覆盖（`§` 为规格条目号）：

| 区段 | 覆盖 |
| --- | --- |
| Phase 1/2 | Workbench 为默认首屏；首页 hero / 任务输入 / 状态条；创建任务并进入详情 |
| Phase 3 | 真实 Runner 执行；路由面板；手动选技能；未知意图不产生空跑 |
| Phase 6 (§60–§62) | 提议生成 → 批准 → 执行；**被拒提议永不到达执行**；批准真的创建后续任务；审计历史 |
| Phase 7 (§70–§72) | `?demo=1` 种入恰好 1 条（幂等）；任务列表出现；详情打开；**真实引擎跑至已完成**；路由解释；「处理方式」面板渲染、逐步标签、Token 用量、本地/ai 汇总；时间线 |
| 全程 | 控制台错误 = 0 |

### 2.5 桌面冒烟（19）

不仅检查源码，**真的去跑打包后的 EXE**：

```text
EXE_BUILD        app/dist 存在、有哈希 JS 产物、体积非平凡
EXE_PACKAGED     打包 exe 存在（5.87 MB）
                 --selftest 退出码 0
                 报告 frozen=true, python=3.14.2
                 8/8 bundle 检查全过
                 桌面窗口后端已打包（winforms）
EXE_START        UI 服务与检索 API 均在真实端口就绪
WORKBENCH_HOME   根路径返回应用外壳；SPA 深链回退正确
SEARCH_DEMO      经 UI 源站反代 /api/search 返回 demo 结果
TASK_EXECUTE     路由/技能标签与状态机在 bundle 内；bundle 内无密钥
TASK_CREATE      演示种子逻辑在 bundle 内
```

为什么必须跑打包件：源码级检查**看不见**冻结模块图、内嵌的 pythonnet 运行时、
webview 后端这三件事 —— 它们恰恰是「能跑」与「坏包」的分界。

---

## 3. 打包 EXE 自检输出（实测原样）

```json
{
  "app": "Gorgon Workbench",
  "frozen": true,
  "python": "3.14.2",
  "checks": [
    { "name": "APP_DIST",             "ok": true, "detail": "...\\_internal\\app\\dist" },
    { "name": "EXE_START_UI",         "ok": true, "detail": "http://127.0.0.1:8010/" },
    { "name": "EXE_START_API",        "ok": true, "detail": "http://127.0.0.1:8000/api/health" },
    { "name": "WORKBENCH_HOME",       "ok": true, "detail": "status=200" },
    { "name": "SEARCH_DEMO",          "ok": true, "detail": "providerMode=demo results=10" },
    { "name": "TASK_ENGINE_SHIPPED",  "ok": true, "detail": "" },
    { "name": "TASK_CREATE_SHIPPED",  "ok": true, "detail": "" },
    { "name": "WEBVIEW_BACKEND",      "ok": true, "detail": "winforms" }
  ],
  "passed": 8,
  "failed": 0
}
```

---

## 4. 端到端人工验证（打包件真实启动）

直接启动 `Gorgon Workbench.exe`（不走 `--selftest`）后实测：

```text
UI_PORT_FOUND   = 8010
DEMO_URL_STATUS = 200          (http://127.0.0.1:8010/?demo=1)
PROXY_SEARCH    = demo 5       (经 UI 源站反代 /api/search)
STILL_ALIVE     = True         (进程存活，未异常退出)
delta_msedge    = 0            (未回退到浏览器 ⇒ 走的是原生桌面窗口)
```

`delta_msedge = 0` 这条很关键：它证明窗口路径真的走通了，
而不是「webview 失败后悄悄退回浏览器」——后者虽然也能看到产品，但不是桌面程序。

---

## 5. 安全核查

| 检查 | 结果 |
| --- | --- |
| 仓库内密钥文件（`.env` / `*.pem` / `*.key` / `id_rsa`） | 无（仅 `.env.example` 模板，值为空） |
| 高熵密钥模式（`sk-…` / `AKIA…` / `ghp_…` / PRIVATE KEY 块） | 无命中 |
| 硬编码 `apiKey/secret/token = "…"` 赋值 | 无命中 |
| 前端 bundle 内密钥 | 无（构建冒烟 + 桌面自检双重断言） |
| 宿主凭证路径 | 仅从 `process.env` 读取；浏览器无 `process`，该分支为死代码 ⇒ **结构上不可能进 bundle** |

---

## 6. 已知的环境性干扰（非代码缺陷）

1. **`npm run build` 在沙箱内清理 `app/dist` 被删除拦截**（`ETIMEDOUT` / `genie-trash`）。
   改用 `vite build --emptyOutDir=false` 即 PASS，产物一致（420.30 kB）。
   `desktop/build.ps1` 在 `app/dist` 已存在时直接复用，已规避。
2. **端口被外部进程占用**会造成 E2E 假失败
   （曾观测到陌生服务占据 4173 导致遗留 E2E 连错服务）。
   跑测试前先确认端口空闲即可 —— 清理后 58/58 全绿。
3. **`python` 在 PATH 上指向托管 3.13**，不含 pyinstaller/pywebview。
   打包须显式指定 3.14 解释器；`build.ps1` 支持 `GORGON_PYTHON` 并会主动校验。

---

## 7. 复现步骤

```bash
# 前端依赖与产物
cd app && npm install && npx vite build --emptyOutDir=false

# 1) 单元测试
node --test "tests/*.test.mjs"

# 2) 构建冒烟
node tests/build-smoke.mjs

# 3) 遗留 E2E（需 Python：GORGON_PYTHON 指向装有依赖的解释器）
GORGON_PYTHON=/path/to/python node tests/e2e_v1_frontend.mjs

# 4) Workbench E2E
GORGON_PYTHON=/path/to/python node tests/e2e_workbench_shell.mjs

# 5) 桌面冒烟（含打包件自检）
cd .. && python pipeline/tests/desktop_smoke.py

# 6) 打包 EXE 自检（单独）
cd release/Gorgon-Workbench-Windows && ./"Gorgon Workbench.exe" --selftest --report selftest.json
```
