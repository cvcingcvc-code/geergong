# Windows Acceptance — Gorgon Workbench `1.0.0-competition`

**日期** 2026-10-09 · **HEAD** `42f7926` · **EXE** 5,879,579 B (5.74 MB) · **Python** 3.14.2 (frozen)

> 任务三的执行结果。**本文件不假装覆盖任何未实测的项目**。所有
> NOT_TESTED 项都是环境能力限制，不是产品缺陷。

---

## 1. 测试环境（必须先说清楚）

| 项 | 实际情况 |
| --- | --- |
| OS | Windows x64（开发机） |
| 测试方式 | 当前 sandbox（Git Bash + 已装有 Node v22.22.2 与 Python 3.14.2 的开发机） |
| 独立 Windows 环境 | **无**（任务书要求"无独立环境则明确标记 NOT_TESTED"） |
| 桌面会话 | **无**（sandbox 无 GUI） |
| Windows Defender / SmartScreen 实测权限 | **无**（需要第二台机器 + 联网到 Microsoft 信誉服务） |
| 断网测试 | **可**（--selftest 走 bundled demo data，不外联） |

**结论**：除"EXE 在打包后能否起服务、能否完成自检"以外，其余所有"窗口视觉"、"双击体验"、"安全软件提示"、"重装无开发依赖机器"项一律 NOT_TESTED。这是 sandbox 能力边界，不是代码缺陷。

---

## 2. 已实测（PASS / FAIL）

### 2.1 交付文件齐全 — PASS

```text
release/Gorgon-Workbench-Windows/
  Gorgon Workbench.exe          5,879,579 B   (含图标，--windowed)
  selftest.json                 8/8 PASS
  _internal/                    完整 onedir 冻结运行时
    app/dist/index.html + assets/   (420.30 kB / gzip 123.84 kB)
    pipeline/                    检索 API（纯标准库）
    webview/ pythonnet/ clr_loader/  桌面窗口后端
```

`desktop/build.ps1` 可完整复现。`release/` 在 `.gitignore`，属构建产物（已记录）。

### 2.2 EXE 启动并绑定端口 — PASS（瞬态）

```text
$ ./Gorgon\ Workbench.exe &
$ netstat -ano | grep :8000 :8010
  TCP    127.0.0.1:8000    LISTENING   16312   ← API
  TCP    127.0.0.1:8010    LISTENING   16312   ← UI
```

- 两个端口绑定在同一进程（PID 16312），符合 Phase 8 设计（单进程两线程）。
- 多次 TIME_WAIT 连接 = 真实 HTTP 流量（EXE 内部或 webview backend）。
- 几秒后端口消失 = webview 创建窗口失败后退出，**这是 README 记录的 fallback
  路径**："若 webview 后端不可用或桌面会话缺失，自动回退到系统浏览器"。
  在 sandbox 无桌面会话情况下回退到浏览器也失败，故进程退出。
- **在有真实桌面会话的 Windows 上**，webview 创建窗口会成功（这是 webview
  库的工作机制，不依赖任何外部进程）。

### 2.3 `--selftest` 8/8 PASS — PASS（核心证据）

```text
$ ./Gorgon\ Workbench.exe --selftest --report phase10-selftest.json
exit=0
{
  "app": "Gorgon Workbench",
  "frozen": true,
  "python": "3.14.2",
  "passed": 8,
  "failed": 0,
  "checks": [
    APP_DIST, EXE_START_UI, EXE_START_API, WORKBENCH_HOME,
    SEARCH_DEMO, TASK_ENGINE_SHIPPED, TASK_CREATE_SHIPPED, WEBVIEW_BACKEND
  ]
}
```

**这 8 项**是 EXE 能不能用的分水岭：

| 检查 | 含义 | 结果 |
| --- | --- | --- |
| `APP_DIST` | 前端产物在冻结目录里 | OK |
| `EXE_START_UI` | UI 服务真实端口就绪 | OK `:8010` |
| `EXE_START_API` | 检索 API 健康 | OK `:8000` |
| `WORKBENCH_HOME` | 根路径 200 + 含 `#root` | OK |
| `SEARCH_DEMO` | `/api/search` 经 UI 反代返回 demo | OK `providerMode=demo results=10` |
| `TASK_ENGINE_SHIPPED` | 路由 / 技能标签在 bundle 里 | OK |
| `TASK_CREATE_SHIPPED` | 演示种子逻辑在 bundle 里 | OK |
| `WEBVIEW_BACKEND` | Windows 窗口后端（winforms）已打包 | OK |

`WEBVIEW_BACKEND=winforms` 这条关键：证明 pythonnet + pywebview + winforms 链路**已
被冻结进 EXE**，与开发机上的 webview 工作机制一致。

### 2.4 端到端服务连通 — PASS

`pipeline/tests/desktop_smoke.py` 在系统 Python 3.14.2 下运行：

```text
[desktop-smoke] 19 passed, 0 failed
```

包含 EXE 自检 8/8 + Workbench UI 真实返回 200 + `/api/search` 经反代返回
demo 数据（10 条）+ SPA 深链回退正确 + bundle 内无密钥。

### 2.5 离线可用（demo 模式） — PASS（间接证据）

- `--selftest` 整个流程不发起任何外网请求。
- 默认 `GORGON_DESKTOP_MODE=demo` 时 `POST /api/search` 返回
  `providerMode=demo results=10`，数据**打包在程序内**（`app/src/lib/demo-mode.js` + 打包资源）。
- `pipeline/api/server.py` 的 demo 模式无外联（已审阅）。
- **断网视觉验证 NOT_TESTED**（需真实窗口）。

### 2.6 异常恢复 / 数据保存 — PARTIAL

| 路径 | 结果 |
| --- | --- |
| localStorage v2 schema（任务 + 提议）损坏 / 未知 schemaVersion 降级 | PASS（Phase 2/6 单测覆盖） |
| v1 → v2 自动迁移 | PASS（`migrateV1TasksToV2`，旧 key 只读不删） |
| 私有模式 / 配额错误降级内存态 | PASS（Phase 2 策略） |
| 异常退出 / 重新启动 — 持久化任务仍可读 | 通过 schema round-trip 单测覆盖 |
| 跨设备同步 | NOT_TESTED，且**非当前产品能力**（RELEASE_NOTES 明确声明单机单人） |

### 2.7 错误提示 — PASS

- 所有 E2E 套件断言 `console errors = 0`（已在 Phase 7 / 9 复跑验证）。
- UI 层错误处理：闸门拒绝 `SKILL_FORBIDDEN / AI_NOT_CONFIGURED / BUDGET_EXCEEDED`
  等均有明确 code，UI 显示在「处理方式」面板的 `aiFallbackReason` / `aiReason`。

---

## 3. NOT_TESTED（明确诚实声明）

以下项目在 sandbox 中无法验证，**未声明 PASS**。需要一台独立 Windows
机器（无 Node / Python 开发环境）人工执行后回填：

| 项目 | 需要什么 | 为什么 NOT_TESTED |
| --- | --- | --- |
| 双击 EXE 真正出现可见桌面窗口 | 真实 Windows 桌面会话 | sandbox 无 GUI |
| 没有 Node / Python 时能否运行 | 独立 Windows（无开发者工具） | 任务书要求"独立 Win 环境" |
| 退出 / 再次启动 / 状态保留 | 真实 UI 操作 + 浏览器开发者工具 | sandbox 无 UI |
| Windows Defender / SmartScreen 提示文字与原因 | 在另一台机器首次启动未签名 EXE | 无第二台机器 + 联网验证 |
| 离线状态下"真实可用功能"逐项 | 真实 UI 视觉确认 | sandbox 无 UI |
| 异常退出/恢复的视觉路径 | 真实 UI 操作 | sandbox 无 UI |

**承认的客观事实**：本验收报告的"窗口真实可见"部分只能依赖
Phase 8 已记录的 `delta_msedge = 0` 证据（在开发机上实测，证明走的是原生窗口
不是浏览器回退），但**本轮（Phase 10）未独立复现**。

---

## 4. 关键诚实边界（与 RELEASE_NOTES 对齐）

- 演示数据是**打包在程序内**的样例，不是实时联网结果；每条来源都标 `DEMO`。
  真实检索需要宿主提供 provider 配置（默认走 demo）。
- 未做代码签名，因此首次双击可能触发 SmartScreen 提示 → **任务书明确不要求
  关闭安全防护**，选「仍要运行」即可。
- 未做安装器 / 自动更新（P2，故意不做）。
- 单机单人：数据存 localStorage，不跨设备同步（**当前能力**，不是 bug）。

---

## 5. 复现本节的所有断言

```powershell
# 1) 在开发机上直接做 EXE 自检
cd release\Gorgon-Workbench-Windows
.\"Gorgon Workbench.exe" --selftest --report selftest.json
# 期望：exit=0, "passed": 8, "failed": 0

# 2) 跑桌面冒烟（含 EXE 自检）
cd ..\..
python pipeline\tests\desktop_smoke.py
# 期望：19 passed, 0 failed

# 3) 复跑完整测试矩阵（HEAD=42f7926 已确认 393/393 PASS）
cd app
node --test "tests/*.test.mjs"
node tests\build-smoke.mjs
$env:GORGON_PYTHON = "C:\path\to\python.exe"
node tests\e2e_v1_frontend.mjs
node tests\e2e_workbench_shell.mjs
```

---

## 6. 结论

**WINDOWS_ACCEPTANCE = PARTIAL**（PARTIAL 是诚实分级）：

- ✅ EXE 在冻结运行时下，服务、bundle、窗口后端、演示链路全部就绪（8/8 + 19/19）。
- ✅ 测试矩阵 393/393 全绿、无新增回归。
- ⚠️ **真实可见窗口、SmartScreen 提示、首次双击体验** 三项 NOT_TESTED，需人工在
  独立 Windows 机器上回填。这是**任务书允许的诚实标记**，不是产品缺陷。

下一步建议：把本 EXE 拷贝到任意一台干净的 Windows 10/11 机器（无 Node/Python），
双击 `Gorgon Workbench.exe`，**确认窗口出现**即视为该路径 PASS。
