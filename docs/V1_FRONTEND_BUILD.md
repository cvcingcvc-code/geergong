# V1_FRONTEND_BUILD.md — Gorgon V1.0 前端工程化（Phase 1）

> 适用范围：`geergong` 仓库的 `app/` 目录（React + Vite 生产构建）。  
> 本文件只描述 **Phase 1 前端工程化** 这一层；后端、管线、数据、部署分别见  
> `AGENTS.md`、`docs/ROADMAP.md`、`docs/PUBLIC_DEPLOYMENT.md`。  
> 最近更新：2026-10-07（新增 §8 手机端 PWA 安装）。

---

## 0. 一句话定位

Phase 1 **只把前端从「React 开发版 + Babel 浏览器运行时」迁移为「React + Vite 生产构建」**，  
为后续真实数据库、用户系统、Tauri 桌面端、安装包、自动更新建立可靠的前端基座。  
**这一阶段没有新增任何业务功能**——UI、交互、布局、数据结构、搜索体验与 legacy 完全一致。

- 分支：`feature/v1-frontend-build`（从 `master` 切出，`master` 未动）
- 旧实现：`ui_kits/app/` 保留为 legacy / reference，**未清理**
- 新实现：`app/`（独立 Vite 工程）

---

## 1. 环境要求

| 项      | 版本 / 说明                                                                                                         |
| ------ | --------------------------------------------------------------------------------------------------------------- |
| Node   | 任意 18+（本机用系统 Node 24.15.0 + `D:/npm.cmd` 安装依赖；managed Node 22 在 esbuild postinstall 上有 EBUSY，勿用于 `npm install`） |
| Python | 3.11+（仅本地联调检索 API 时需要，前端构建本身不依赖）                                                                                |
| 包管理    | `npm`（`app/package.json`，`type: module`）                                                                        |

> 安装依赖时：
>
> ```bash
> cd app && D:/npm.cmd install     # 用系统 Node 的 npm，避免 managed Node 的 EBUSY
> ```

---

## 2. 常用命令

```bash
cd app

npm install          # 安装依赖（见上方环境说明）
npm run dev          # Vite dev server（端口 5173；/api 代理到 127.0.0.1:8000）
npm run build        # 生产构建 -> app/dist/
npm run preview      # 预览构建产物（端口 4173；/api 代理到 127.0.0.1:8000）
npm test             # 纯函数单测（node --test，27 个用例）
npm run test:build   # 构建产物冒烟（18 项断言：无 secret / 无 Babel / 无绝对路径 …）
npm run test:e2e     # 浏览器端到端（Edge CDP 驱动，58 项断言，四档 viewport）
```

### 本地联调（前端 + 检索 API 同时跑）

前端 dev/preview 通过 Vite 代理把 `/api` 转发到 `127.0.0.1:8000`，因此需要另开一个终端启动  
Python 检索服务（否则 Natural Search 会优雅降级到内置 demo 录屏数据，并明确标注「DEMO DATA」）：

```bash
# 仓库根目录
python pipeline/api/server.py --port 8000 --mode demo      # 仅 fixture
python pipeline/api/server.py --port 8000 --mode hybrid    # 真实检索 + fixture
```

> **为什么必须代理？** 检索 API 服务端按设计**不发送 CORS 头**（见 `docs/PUBLIC_DEPLOYMENT.md` §G）。  
> 浏览器从 `localhost:5173/4173` 跨源直连 `127.0.0.1:8000` 会被拦。dev/preview 同源代理规避了这一点。  
> 生产 / Tauri 跨域场景改用环境变量 `VITE_API_BASE_URL`（见 §4）。

---

## 3. 目录结构（新前端 `app/`）

```
app/
├── index.html              # <div id="root"> + 两个 @keyframes + PWA 元信息（theme-color / manifest / apple-touch-icon）
├── package.json            # name=gorgon-app；type=module；react/react-dom/lucide-react + vite
├── vite.config.js          # react 插件；dev/preview 端口；fs.allow=仓库根；/api 代理
├── .env.example            # VITE_API_BASE_URL 说明（留空=同源代理）
├── .gitignore             # node_modules/ dist/ .env .env.local
├── public/
│   ├── manifest.webmanifest # PWA 清单（name/short_name/icons/display:standalone/start_url/主题色）
│   ├── sw.js               # 手写 Service Worker（预缓存外壳 + 运行时缓存 + 导航离线兜底）
│   ├── icons/              # icon-256.png / icon-512.png（品牌徽标，含 maskable）
│   └── assets/placeholders/ # 13 个 SVG 占位图（从仓库 assets/placeholders 复制），dist 自包含
├── src/
│   ├── main.jsx            # 入口：import 设计系统 css、applyCategoryExtensions、initDemoReset、createRoot
│   ├── App.jsx             # 根组件：状态归属（weekend/favorites/detail/mapFocus/district/toast）
│   ├── lib/
│   │   ├── api.js          # ★ 统一 API 配置层（唯一知道 API URL 的地方）
│   │   ├── activity-view.js# 活动视图模型（ES 版，含 typeof window 守卫）
│   │   ├── district.js     # 上海区词汇 + 归一化/过滤/计数（ES 版）
│   │   ├── data.js         # 重新导出 GORGON_DATA / GORGON_SEARCH_DEMO
│   │   ├── ds.js           # 重新导出 design-system 组件（Button/Tag/…/CATEGORIES）
│   │   ├── categories.js   # applyCategoryExtensions()
│   │   ├── useResponsive.js# useMediaQuery/useResponsive/currentBreakpoint（与 legacy 一致）
│   │   ├── demo-reset.js   # initDemoReset()
│   │   └── store/store.js  # localStorage 封装（6 个 key）
│   ├── components/
│   │   ├── Icon.jsx        # lucide-react 具名导入映射表（未知图标 warn + 返回 null）
│   │   ├── atoms.jsx       # ActivityImage/TrustChip/ProviderBadge/MapPlaceholder/NoticeBlock …
│   │   ├── DistrictPicker.jsx   # 地区选择器（Portal 到 body；与 legacy 行为一致）
│   │   ├── AppShell.jsx    # 桌面/平板 chrome（Sidebar + Header）+ 移动 PhoneFrame + TabBar
│   │   └── ds/             # ★ vendored 副本：SearchField.jsx / ActivityCard.jsx
│   │                        #   （仅把 <i data-lucide> 换成 <Icon>；原因见文件头）
│   └── screens/            # Discover / Search / NaturalSearch / ActivityDetail / MyWeekend / Map
└── tests/
    ├── district.test.mjs          # 读共享 district_corpus.json（与 Python location.py 对齐）
    ├── activity-view.test.mjs     # 读共享 textnorm_corpus.json（与 Python textnorm.py 对齐）
    ├── store.test.mjs             # 内存 localStorage stub，9 例
    ├── build-smoke.mjs            # 真实 vite build + 18 项断言
    ├── e2e_v1_frontend.mjs        # Edge CDP 浏览器 E2E（四档 viewport，58 项断言）
    ├── pwa_install_check.mjs      # PWA 可安装性校验（manifest + SW active + 图标 ≥192px）
    ├── pwa_offline_check.mjs      # PWA 离线冒烟（断网后 SW 兜底仍能加载外壳）
    └── .e2e-logs/                # 子进程日志（api.log / web.log），git 忽略
```

> ★ = 与 legacy 相比**结构性新增/变更**的文件；其余为行为一致的 ES 模块迁移。

---

## 4. API 配置层（`src/lib/api.js`）

所有前端请求**只**经此模块，禁止在组件里硬编码 URL 或引入任何密钥。

```js
const RAW_BASE = (import.meta.env.VITE_API_BASE_URL || "").trim();
export const API_BASE_URL = RAW_BASE.replace(/\/+$/, "");   // 空 = 同源（dev/preview 代理）
export function apiUrl(path) { /* 拼接绝对/相对路径，补单斜杠 */ }
export const REQUEST_TIMEOUT_MS = 45000;
export async function searchActivities({ query, topics, maxResults, district }) {
  // 返回 { kind: "ok" | "error" | "unavailable", ... }，永不抛异常
  // API 不在时调用方负责降级到 GORGON_SEARCH_DEMO（如实标注 DEMO DATA）
}
```

环境变量：

| 变量                  | 取值                | 含义                                        |
| ------------------- | ----------------- | ----------------------------------------- |
| `VITE_API_BASE_URL` | 留空                | dev/preview 下经 Vite 代理 `/api`，同源          |
| `VITE_API_BASE_URL` | `https://api.xxx` | 生产 / Tauri 跨域构建，前端直连该地址（届时服务端需按来源放开 CORS） |

**安全约束（已通过构建冒烟验证）：** 构建产物中无 `SEARCH_API_KEY`、无真实 Secret、  
不暴露 debug 内部信息、API URL 可配置。

---

## 5. 迁移原则（与 legacy 的对照）

| 维度   | legacy（`ui_kits/app/`）                                                      | V1（`app/`）                                    |
| ---- | --------------------------------------------------------------------------- | --------------------------------------------- |
| 运行时  | `react.development.js` + `react-dom.development.js` + `babel.min.js` 浏览器内编译 | React 18.3.1 生产版 + `vite build`               |
| 模块系统 | `window.GorgonApp` / `window.GorgonDistrict` … 全局命名空间                       | 标准 `import/export` ES 模块                      |
| 图标   | `<i data-lucide>` + lucide CDN 运行时                                          | `lucide-react` npm 包 + `<Icon>` 组件            |
| 组件源  | `_ds_bundle.js` 同步 XHR 拉 `components/core/*.jsx` 再用 Babel 编译                | `components/core/*.jsx` 直接 import（Vite 编译期处理） |
| API  | 散落各屏的 `fetch`                                                               | 统一 `src/lib/api.js`                           |
| 设计系统 | `styles.css` + `tokens/` + `responsive.css` 原样复用                            | 同左，路径提升至仓库根 `import "../../styles.css"`       |

**保持不变（刻意）：** UI、交互、布局、响应式断点（390/768/1440/1920）、数据结构、  
搜索体验、district filter、localStorage 模型、My Weekend、Activity Detail、Discover、  
Map、Natural Search、Demo 模式、视觉设计。

**为什么两个组件要 vendor 副本（`app/src/components/ds/`）：** legacy 运行时（Babel Standalone）  
无法解析 npm import（`lucide-react`）；直接改共享的 `components/core/*.jsx` 会破坏仍在用的 legacy 构建。  
因此只复制 `SearchField` / `ActivityCard` 并把 `<i data-lucide>` 换成 `<Icon>`。legacy 退役后这一层消失。

---

## 6. 生产 / Tauri 接入说明

- **生产 Web 部署：** `npm run build` 生成 `app/dist/`（`dist/assets/index-*.js ~329 kB / gzip ~96 kB`），  
  将 `dist/` 整体托管到同源静态服务即可；若跨域访问 API，设 `VITE_API_BASE_URL`。
- **Tauri（Phase 6 才做，本阶段未实现）：** `app/dist/` 即 Tauri 的 `distDir`。Tauri 的 `devUrl` 可用  
  `http://127.0.0.1:4173`（即 `npm run preview`）。前端 `VITE_API_BASE_URL` 指向本地/远端 API；  
  届时 API 服务端需按 Tauri 来源放开 CORS（Phase 1 不解决）。
- **不要做的事（Phase 1 禁止）：** 接 PostgreSQL/SQLite、账号/登录/OAuth/微信登录、支付、  
  Tauri/Electron 实现、真实地图 API、itinerary solver、搜索排名重写、trust/dedupe 核心规则变更、大规模视觉改版。

---

## 7. 已知限制（与迁移无关，见 `docs/V1_FRONTEND_KNOWN_ISSUES.md`）

- 详情页没有「添加收藏」入口（legacy 既有缺口）。
- 桌面详情页描述在 header 与「活动介绍」重复渲染（PHASE 5 已知限制 #6）。
- 疑似重复记录借用「存在冲突」状态展示（PHASE 5 已知限制 #5）。
- 字体走 Google Fonts CDN，取不到退化为系统字体（有意取舍）。
- 检索 API 不在时，Natural Search 降级到内置 demo 录屏数据（明确标注 DEMO DATA）。
- PWA 离线仅缓存「静态外壳 + 已加载过的资源」；未访问过的检索数据需联网（同源 `/api` GET 已做网络优先兜底，但纯静态部署无同源 API 时仍是 DEMO 数据）。

---

## 8. 手机端安装（PWA / 可「下载」到主屏的应用）

用户明确要求把前端做成「可供用户下载的应用」。在当前环境（无 Android SDK、无 Mac、  
GitHub 不可达、无 Rust/Cargo、无 WiX/NSIS，Electron/Tauri 均不可行）下，**PWA（Progressive Web App）**  
是唯一能真正产出「可安装到手机主屏、支持离线」成品的路径——无需应用商店、无需签名。

> PWA 只新增「交付/安装层」，**不改动任何业务功能、算法或视觉**。它让既有 Web 前端可被
> Android / iOS 当作原生应用安装，并缓存外壳实现离线打开。

### 8.1 产出物（`app/public/` + `app/index.html` + `app/src/main.jsx`）

| 文件                         | 作用                                                                                  |
| -------------------------- | ----------------------------------------------------------------------------------- |
| `public/manifest.webmanifest` | 应用清单：`name` / `short_name` / `start_url:"/"` / `display:"standalone"` / `orientation:portrait` / 主题色 `#5B47E0` / 背景 `#F7F8FB` / 三档图标（256、512、含 `maskable`） |
| `public/sw.js`             | 手写 Service Worker（零依赖）：`install` 预缓存外壳+图标并 `skipWaiting`；`activate` 清旧缓存+`clients.claim`；`fetch` 对同源 GET 做「导航网络优先兜底缓存 / 静态资源缓存优先 / `/api` 网络优先兜底」 |
| `public/icons/icon-256.png`<br>`public/icons/icon-512.png` | 品牌图标（深靛蓝→紫渐变 + 发光六边形徽标，居中留白，适配 maskable 安全区）              |
| `app/index.html`           | 注入 `<link rel="manifest">`、`<link rel="apple-touch-icon">`、`<meta name="theme-color">` 与 iOS `mobile-web-app-capable` / `apple-mobile-web-app-*` 系列 |
| `app/src/main.jsx`         | 生产构建下（`import.meta.env.PROD`）注册 `/sw.js`（dev 不注册，避免缓存开发资源）         |

> **为什么 SW 注册放在 `main.jsx` 而非 `index.html` 内联脚本？** Vite 在生产构建中
> 会剥离 `index.html` 里的内联 `<script type="module">`，内联写法无法进入 `dist/`。
> 放进 JS 入口可保证在打包后的 bundle 里生效。

### 8.2 用户怎么装（终态交付）

- **Android（Chrome / Edge）：** 打开站点 → 地址栏右侧「安装」图标 / 菜单「安装应用」→ 确认。
  桌面也会生成快捷方式。断网后从主屏图标仍可直接打开外壳。
- **iOS（Safari）：** 打开站点 → 底部「分享」→「添加到主屏幕」→ 命名「Gorgon」→ 完成。
  （iOS 只支持 standalone 显示，不支持 `beforeinstallprompt` 系统弹窗，需手动分享添加。）
- **桌面（Chrome / Edge）：** 同 Android，「安装应用」后成为独立窗口。

### 8.3 部署前提（关键约束）

可安装性要求 **安全上下文**：必须为 `https://`（或本机 `http://localhost` / `http://127.0.0.1`）。
纯 `http://` 内网 IP（如 `192.168.x.x`）下 **不会** 弹出安装、SW 也不注册。因此：

1. 静态托管到任意 HTTPS 静态服务（Netlify / Vercel / 对象存储 + CDN / 自有 Nginx+TLS）。
2. 若部署到子路径（如 `https://x.com/gorgon/`），需同步在 `vite.config.js` 设 `base: "/gorgon/"`，
   并把 `manifest.webmanifest` 的 `start_url` / `scope` 改为 `"/gorgon/"`，否则 scope 不匹配无法安装。
3. 纯静态部署无同源检索 API 时，Natural Search 会按设计降级到内置 DEMO 数据（见 §4 / §7）。
   若要让离线也能看历史数据，可后续把 `/api` GET 也纳入 SW 缓存（当前已对同源 `/api` 做网络优先兜底）。

### 8.4 校验

```bash
npm run build
npm run preview -- --host 127.0.0.1 --port 4180   # 另开终端
node tests/pwa_install_check.mjs   # 可安装性：manifest + SW active + 图标 ≥192px → INSTALLABLE
node tests/pwa_offline_check.mjs   # 离线冒烟：断网 reload 后外壳仍加载 → OFFLINE SHELL LOADS
```

两项在 `localhost`（安全上下文）下均已验证 PASS。

---

## 9. 测试体系

| 层         | 命令                               | 覆盖                                                                                                          | 状态         |
| --------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------- |
| 纯函数单测     | `npm test`                       | district 归一化/过滤、activity-view 文本归一化、localStorage 模型（共享语料与 Python 对齐）                                        | 27/27 PASS |
| 构建冒烟      | `npm run test:build`             | 真实 build + 18 项断言（无 Babel/React dev build/data-lucide/`_ds_bundle`/`GorgonDesignSystem_56aa78`/secret/绝对路径） | 18/18 PASS |
| 浏览器 E2E   | `npm run test:e2e`               | Edge CDP：Discover/Search/Natural Search/Detail/Weekend/Favorites/Map + 四档 viewport + console errors=0       | 58/58 PASS |
| PWA 可安装性  | `node tests/pwa_install_check.mjs` | manifest 合法 + SW 已激活并接管页面 + 图标 ≥192px + display:standalone                                       | INSTALLABLE ✓ |
| PWA 离线冒烟  | `node tests/pwa_offline_check.mjs` | 断网 reload 后 SW 兜底外壳仍加载（title 含 Gorgon、root 已挂载、SW 接管）                                      | OFFLINE SHELL LOADS ✓ |
| Python 基线 | `cd ../.. && pytest`（或既有 runner） | 管线 trust/dedupe/review/normalize（268 例，2026-10-02 基线）                                                       | 未变         |

> 跑 Python 测试会改写 `pipeline/data/*` 产物，属测试副作用；提交前 `git checkout -- pipeline/data/` 还原。
