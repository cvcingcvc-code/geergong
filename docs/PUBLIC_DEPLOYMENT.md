# PUBLIC_DEPLOYMENT.md — 把 Gorgon 变成「开机即可用的公网活动检索」

这份文档解决一件事：**别人通过一个公网 URL 就能用活动检索。**

本轮范围是**公开只读访问**。以下都**没有**做，也不在本文档范围内：

登录 · 注册 · 用户账户 · 权限系统 · 支付 · 收藏同步

唯一允许的公网动作是「查询」：加载页面、看活动、检索。没有任何接口会修改服务器状态。

---

## 当前线上地址

| | |
|---|---|
| 分享链接 | **https://shanghai-activity-search.app.workbuddy.host/** |
| 发布方式 | 平台内置「发布应用」（见 C 节） |
| 已验证 | 入口 200、真实检索 200（`providerMode=real`）、`pipeline/` `.git/` `admin/` `docs/` 全部 404、无 CORS |

这个链接**不依赖你的电脑开机**——服务跑在平台的沙箱里。
它和你自己开隧道（D 节）是两条互不干扰的路：本节这条是"别人随时能用"，D 节那条是"只有你开机时能用"。

管理地址：**设置 → 数据管理 → 应用**。

---

## 0. 一分钟版

```bash
cd <仓库根目录，即含 pipeline/ 的那一层>

# 本地服务（默认 127.0.0.1:8000，real 真实检索）
python pipeline/api/server.py --port 8000
```

本机跑起来只服务 `127.0.0.1`。要让**外部**访问，二选一：

| 方案 | 适合 | 依赖你开机 | 链接稳定性 |
|---|---|---|---|
| **C. 平台一键发布** | 长期分享给任何人 | 否 | 固定域名，重新发布也不变 |
| D. Cloudflare Tunnel | 临时透传你自己的机器 | 是 | 每次重启换 URL，且本机有 DNS 坑（见 D 节） |

---

## A. 如何启动 Gorgon

### 前置条件

| 需要 | 说明 |
|---|---|
| Python 3.9+ | 服务只用标准库，**不需要 pip install**，没有 requirements.txt |
| cloudflared | 仅 D 节需要 |

### 启动命令

```bash
# 默认：真实检索（会访问互联网）
python pipeline/api/server.py --port 8000

# 只用本地 fixtures，不发任何出站请求（离线演示 / E2E 用）
python pipeline/api/server.py --port 8000 --mode demo

# 真实检索 + fixtures 补齐
python pipeline/api/server.py --port 8000 --mode hybrid

# 不抓取候选页面（更快，结果只保留列表页信息）
python pipeline/api/server.py --port 8000 --no-fetch
```

参数：

| 参数 | 默认 | 作用 |
|---|---|---|
| `--port` | `8000`，或环境变量 `PORT` | 监听端口 |
| `--host` | `127.0.0.1`，或环境变量 `GORGON_HOST` | 监听地址。**本地不要改成 `0.0.0.0`**，见 G 节 |
| `--mode` | `real` | `real` 真实检索 / `hybrid` 真实+fixture / `demo` 纯 fixtures |
| `--debug` | 关 | 让响应附带内部调试载荷。**本地专用，绝不与隧道同时开** |
| `--today` | 今天 | 固定「今天」的日期，便于演示与测试 |
| `--no-fetch` | 关 | 跳过候选页面抓取 |

### 端口/地址是从环境变量推出来的（托管平台需要）

`resolve_bind_defaults()` 的规则只有两条：

- 环境里**有 `PORT`** → 说明有托管平台/反向代理在替你接公网流量，于是绑 **`0.0.0.0`** 并使用该端口。
- 环境里**没有 `PORT`** → 绑 **`127.0.0.1`**，端口 8000。

也就是说**在自己电脑上直接跑永远不会意外暴露到局域网**；只有在被托管时才会监听全部网卡。
想强制指定，`GORGON_HOST` 优先级高于上面的推断。

### 检索相关环境变量（可选）

服务读取环境变量而不是写死配置，密钥永远不进仓库：

```bash
# Windows PowerShell
$env:SEARCH_PROVIDER="brave"      # auto|brave|bing|serper|tavily|searxng|bing_html
$env:SEARCH_API_KEY="<你的 key>"   # 不设也能跑：会降级为「来源不可用」并如实说明
$env:GORGON_WEB_SEARCH="auto"      # auto|off|bing_html
$env:GORGON_EVENT_SOURCES="segmentfault,douban,meetup"
python pipeline/api/server.py --port 8000
```

启动后会打印一个横幅，包含两个入口地址、API 地址、当前模式与来源配置。
**启动前请确认横幅里没有 `!! --debug IS ON`。**

### 两个入口 URL

| URL | 行为 |
|---|---|
| `http://localhost:8000/` | **302 → `/ui_kits/app/`**，然后正常加载 App |
| `http://localhost:8000/ui_kits/app/` | 直接加载 App |

`/` 之所以是跳转而不是直接吐 HTML：`index.html` 用**相对路径**引用同目录的兄弟文件
（`responsive.css`、`categories-ext.js`、`../../styles.css` 等）。如果直接把它放在 `/` 上，
这些相对路径会按站点根目录解析并全部 404。跳转到目录形式后，相对路径的基准才是对的。
`/ui_kits/app`（不带结尾斜杠）同理也跳转。

### Windows 开机自启（可选，仅 D 节需要）

用「任务计划程序」建一个**登录时触发**的任务：

- 程序：`python`（写绝对路径更稳，例如 `C:\Python313\python.exe`）
- 参数：`pipeline\api\server.py --port 8000`
- 起始位置：**必须填仓库根目录**，因为服务要能找到 `pipeline/` 与静态资源
- 触发器：`登录时`（或 `启动时`，但启动时任务拿不到用户环境变量里的 key）

cloudflared 同理再加一个任务。注意**启动顺序**：先起 Python，再起隧道；
隧道先起也能自动重连，但第一次公网访问可能失败几秒。

---

## B. 如何验证 localhost

### 1. 服务活着

```bash
curl -s http://127.0.0.1:8000/api/health
```

期望：

```json
{"status": "ok", "providerMode": "real", "demoData": false, "today": "2026-09-20"}
```

注意这个响应**只有这 4 个字段**——它不包含 `settings`、`cacheDir`、任何密钥信息，这是有意的。

### 2. 入口跳转正确

```bash
curl -s -o /dev/null -w "%{http_code} -> %{redirect_url}\n" http://127.0.0.1:8000/
# 期望：302 -> http://127.0.0.1:8000/ui_kits/app/

curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8000/ui_kits/app/
# 期望：200
```

### 3. 检索接口可用

```bash
curl -s -X POST http://127.0.0.1:8000/api/search \
  -H "Content-Type: application/json" \
  -d '{"query":"这个周末上海有什么 AI 活动","district":"徐汇","maxResults":5}'
```

期望 HTTP 200，且 JSON 里有 `status`、`providerMode`、`results`、`notices`、`providers`。

### 4. 浏览器

打开 `http://localhost:8000/`，应该看到 Discover 页有活动卡片、右上角地区胶囊显示 `上海 · 全上海`。

### 5. 该被拒绝的路径（重要）

下面这些**必须全部 404**（`/.git/*` 是 403），否则说明暴露面出了问题：

```bash
for p in /pipeline/data/review/review_queue.json /pipeline/data/approved/activities.json \
         /pipeline/api/server.py /.git/config /.git/HEAD \
         /ui_kits/admin/index.html /ui_kits/dashboard/index.html \
         /docs/PUBLIC_DEPLOYMENT.md /readme.md /ui_kits/ /pipeline/ ; do
  printf "%-52s %s\n" "$p" "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8000$p)"
done
```

并确认响应头里**没有** `Access-Control-Allow-Origin`：

```bash
curl -s -D - -o /dev/null http://127.0.0.1:8000/api/health | grep -i "access-control\|x-content-type\|content-security"
```

### 6. 自动化验证

```bash
# HTTP 边界（白名单、穿越、输入校验、限流、不泄漏、前端不依赖外部 CDN）
# 会自己起临时端口，无需先开服务
python -m unittest pipeline.tests.test_public_server

# 浏览器端到端（需要服务已在 8000 端口运行）
node pipeline/tests/e2e_public.mjs

# 对着线上链接跑同一套（把地址换成 C 节那个）
GORGON_BASE=https://shanghai-activity-search.app.workbuddy.host \
GORGON_EXPECT_MODE=real node pipeline/tests/e2e_public.mjs
```

---

## C. 公网方案一：平台内置「发布应用」（推荐）

服务本身就是一个"单端口 HTTP 服务"，符合平台的发布要求，**不需要** cloudflared、不需要开端口、
不需要担心本机 DNS（见 D 节那个坑）。

### 发布

在对话里说「发布」/「上线」/「同步到线上」，或让我直接执行。等价的做法是让平台用这些参数发布：

| 参数 | 值 | 为什么 |
|---|---|---|
| 目录 | 仓库根目录（含 `pipeline/`） | 上传的是源码，平台自己起服务 |
| 语言 | `python` | |
| 安装命令 | 空 | 零第三方依赖，不需要 pip install |
| 启动命令 | `python pipeline/api/server.py` | 平台会注入 `PORT`，服务据此绑 `0.0.0.0` |
| 端口 | `8000` | 与注入的 `PORT` 一致 |

服务端的 `resolve_bind_defaults()` 就是为这件事写的：**看到 `PORT` 就绑 `0.0.0.0`**，
所以启动命令里不用写 `--host`。

### 重新发布 = 覆盖同一条链接

同一个应用再次发布，**链接不变**，线上内容被替换。改动代码后要重新发布，线上才会变。

### 发布后请再确认一次

```bash
B=https://shanghai-activity-search.app.workbuddy.host

# 入口
curl -s -o /dev/null -w "%{http_code}\n" "$B/ui_kits/app/"        # 200

# 该被拒绝的
curl -s -o /dev/null -w "%{http_code}\n" "$B/pipeline/api/server.py"     # 404
curl -s -o /dev/null -w "%{http_code}\n" "$B/.git/config"                # 403
curl -s -o /dev/null -w "%{http_code}\n" "$B/ui_kits/admin/index.html"   # 404

# 检索
curl -s -X POST "$B/api/search" -H "Content-Type: application/json" \
  -d '{"query":"AI 活动","maxResults":5}' | head -c 200
```

### 平台网关会改写部分响应头（实测）

| 头 | 本地 | 线上 |
|---|---|---|
| `Server` | `Gorgon` | `CloudStudio Gateway`（网关自己的，覆盖了我们的） |
| `X-Content-Type-Options` | `nosniff` | `nosniff` |
| `Referrer-Policy` | `no-referrer` | `no-referrer` |
| `Content-Security-Policy` | 原样 | 原样，但 `frame-ancestors 'self'` 被追加成 `'self' *` |
| `X-Frame-Options` | `SAMEORIGIN` | **被网关丢弃** |

含义：线上别人仍不能通过 iframe 拿到页面*内容*（CSP 的 `connect-src 'self'` 管的是页面能往哪发请求），
但**允许被任何站点 iframe 嵌入**。要收紧只能在自己的域名/网关上做，不在本仓库范围内。

---

## D. 公网方案二：Cloudflare Tunnel

Cloudflare Tunnel 是**出站**连接：不用开路由器端口、不暴露公网 IP。
cloudflared 从你的机器主动连到 Cloudflare 边缘，公网流量再从边缘回到本机的 `127.0.0.1:8000`。

### 安装

```powershell
winget install --id Cloudflare.cloudflared
cloudflared --version
```

或从 <https://github.com/cloudflare/cloudflared/releases/latest> 下载
`cloudflared-windows-amd64.exe`，重命名为 `cloudflared.exe` 并放进 `PATH`。

> winget 装的 cloudflared **不一定在 `PATH` 上**。找不到命令时直接用绝对路径：
> `& "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Cloudflare.cloudflared_Microsoft.Winget.Source_8wekyb3d8bbwe\cloudflared.exe" tunnel --url http://127.0.0.1:8000`

### 方式一：Quick Tunnel（免账号，最快）

```powershell
cloudflared tunnel --url http://127.0.0.1:8000
```

输出里会出现形如 `https://<随机词>.trycloudflare.com` 的地址，直接分享。

要点：

- 不确定隧道有没有配对，**先用这个验证**，再去配自有域名。
- **每次重启 cloudflared 都会换一个新 URL**，旧 URL 立刻失效。
- **没有任何鉴权**：拿到 URL 的人就能用。URL 本身就是凭证，别发到公开场合。
- 官方定位是测试/临时用途，不适合长期对外。

### 本机实测过的坑：DNS 不返回 SRV 记录 → 隧道建好又立刻退出

在**这台机器**上 quick tunnel 会在拿到 URL 之后几秒内失败退出，日志形如：

```
ERR edge discovery: error looking up Cloudflare edge IPs: the DNS query failed
    error="lookup argotunnel.com: no such host"
ERR Could not lookup srv records on _v2-origintunneld._tcp.argotunnel.com
```

**这不是网络不通，也不是 cloudflared 的问题。** 原因很具体：

```
nslookup -type=SRV _v2-origintunneld._tcp.argotunnel.com              # 本机 DNS：查不到 SRV
nslookup -type=SRV _v2-origintunneld._tcp.argotunnel.com 1.1.1.1      # 正常返回 region1/region2
nslookup region1.v2.argotunnel.com                                    # A 记录也正常
```

cloudflared 靠 SRV 记录发现边缘节点，而本机 DNS（路由器/VPN 下发的解析器）**不返回 SRV**，
于是它认为 `argotunnel.com` 不存在。cloudflared 没有"指定解析器"或"直接写死边缘地址"的开关，绕不过去。

**解决办法（任选）**：

1. **改用 C 节的平台发布**——不依赖本机 DNS，也是最省事的。
2. 把本机 DNS 改成 `1.1.1.1` / `8.8.8.8` 再跑隧道：

   ```powershell
   Get-DnsClientServerAddress -AddressFamily IPv4 |
     Where-Object { $_.InterfaceAlias -notmatch 'Loopback' } |
     Set-DnsClientServerAddress -ServerAddresses 1.1.1.1,8.8.8.8
   ```

   这会**改变整台机器的 DNS**（路由器/VPN 的本地域名解析可能一起受影响），请自行决定。
3. 换 VPN/路由器，让下发的解析器支持 SRV。

### 方式二：Named Tunnel（需要 Cloudflare 账号 + 自有域名）

```powershell
cloudflared tunnel login                       # 浏览器里授权域名
cloudflared tunnel create gorgon               # 记下输出的隧道 ID
cloudflared tunnel route dns gorgon gorgon.example.com
```

再建配置文件 `%USERPROFILE%\.cloudflared\config.yml`：

```yaml
tunnel: <上一步的隧道 ID>
credentials-file: C:\Users\<你>\.cloudflared\<隧道 ID>.json
ingress:
  - hostname: gorgon.example.com
    service: http://127.0.0.1:8000
  # 末尾必须有一条兜底规则，否则未匹配的请求会被当成错误
  - service: http_status:404
```

`credentials-file` 用**绝对路径**。然后：

```powershell
cloudflared tunnel ingress validate             # 校验配置
cloudflared tunnel ingress rule https://gorgon.example.com   # 看会命中哪条规则
cloudflared tunnel run gorgon                   # 启动
```

要让域名生效，该域名的 DNS 必须由 Cloudflare 托管（在注册商处把 NS 指到 Cloudflare）。
DNS 生效可能需要几分钟到几小时。

### 开隧道后请再确认一次

用真实公网 URL 重新跑一遍 B 节第 5 步的那些路径——**从公网看也必须是 404**。

---

## E. 如何停止公网访问

**平台发布**：在**设置 → 数据管理 → 应用**里下线，或让我执行「取消发布」。链接立刻失效。

**Cloudflare Tunnel**：

- 最快：回到 cloudflared 窗口按 `Ctrl+C`。公网 URL 立刻失效，本地服务不受影响。
- 彻底停止：再回到 Python 窗口按 `Ctrl+C`。

**找不到窗口时**（Windows）：

```powershell
Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force
Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique |
  ForEach-Object { Stop-Process -Id $_ -Force }
```

或者查端口再定点结束：

```powershell
netstat -ano | findstr :8000
taskkill /PID <上面查到的 PID> /F
```

**验证已经关掉**：

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8000/api/health   # 期望：连不上
curl -s -o /dev/null -w "%{http_code}\n" https://<你的公网URL>/api/health    # 期望：530/1033 或连不上
```

注意：named tunnel 的 DNS 记录还在，**下次 `cloudflared tunnel run` 一跑起来公网访问就恢复**。
要永久停用，需要删掉 DNS 记录（`cloudflared tunnel route dns` 的反向操作，或在 Cloudflare 面板里删）
或直接删隧道 `cloudflared tunnel delete gorgon`。

---

## F. 如何验证真实搜索

### 1. 确认模式

```bash
curl -s http://127.0.0.1:8000/api/health
# "providerMode":"real"  <- 这就是真实检索
```

如果服务是用 `--mode demo` 起的，这里会是 `demo`，检索**不会**联网。这是最常见的「怎么搜不出真东西」原因。

### 2. 直接打接口

```bash
curl -s -X POST http://127.0.0.1:8000/api/search \
  -H "Content-Type: application/json" \
  -d '{"query":"这个周末上海有什么 AI / Agent 活动？最好免费","maxResults":10}' \
  | python -c "import json,sys; d=json.load(sys.stdin); print(d['providerMode'], d['status'], len(d['results'])); [print(' -', r['activity']['title']) for r in d['results'][:5]]"
```

期望：`real ok <非 0 条数>`，并列出真实活动标题。
每条结果带 `dataOrigin`（`real` / `demo`），可以据此判断是不是真的来自公网。

### 3. 浏览器

打开 App → 点「智能」→ 输入问题（例如「这个周末上海有什么 AI / Agent / Vibe Coding 的活动？最好免费，徐汇附近」）
→ 结果区出现卡片，且顶部徽标是 **REAL SEARCH**（不是 DEMO DATA）。
徽标不是装饰：它由响应的 `providerMode` 决定，服务没联网时它一定会说 DEMO DATA。

### 4. 端到端（含真实检索）

```bash
GORGON_EXPECT_MODE=real node pipeline/tests/e2e_public.mjs
```

这一轮除了部署项，还会驱动「智能」屏真的检索一次，并断言拿到真实结果、徽标是 REAL SEARCH。

### 5. 搜不到东西时的排查顺序

1. `providerMode` 是不是 `real`？（用了 `--mode demo` 就会是 `demo`）
2. 响应里的 `notices[]` —— 服务会把原因写成可读中文，例如「部分搜索源暂时不可用」「真实检索尚未配置」。
3. `providers[]` 里哪个来源 `available:false`、`reason` 是什么（`timeout` / `http_error` / `blocked` / `not_configured` …）。
4. 网络与代理：本机若在代理后面，服务会读取 `HTTP_PROXY`/`HTTPS_PROXY`。代理不通则所有来源都会失败。
5. `SEARCH_API_KEY` 没配时，通用网页搜索不启用，只剩免密钥来源——结果会少很多，这是设计如此，不是故障。
6. **托管环境下，某些活动平台会按出口 IP 拒绝**：线上实测 `events:huodongxing` 返回 `blocked`，
   其余来源正常（一次检索 raw 16 → 去重 9 → 返回 5）。这是来源侧的策略，不是服务故障。

真实检索会向第三方发起**出站请求**，有配额与延迟成本（每次检索可能抓取十余个候选页面）。

---

## G. 安全注意事项

### 已经做到的（代码层面）

| 项 | 做法 |
|---|---|
| 静态文件 | **白名单**：只放行 `/ui_kits/app/`、`/components/`、`/tokens/`、`/assets/`、`/styles.css`、`/_ds_bundle.js`。其余一律 404 |
| 不暴露 | `pipeline/`（含 `pipeline/data/` 与 review queue）、`.git/`、`ui_kits/admin/`、`ui_kits/dashboard/`、`docs/`、`.md`/`.py` 源文件 |
| 目录列举 | 全部关闭，没有任何 `Index of ...` 页面 |
| 任意文件读取 | 路径解析后必须仍在该白名单目录内；`..`、`%2e%2e`、点目录一律拒绝 |
| CORS | 不下发任何 `Access-Control-Allow-Origin`（前端同源，不需要） |
| 不泄漏内部信息 | 响应里没有 `settings`/`cacheDir`/`debug`/provider 原始 `detail`/stack trace/绝对路径/密钥 |
| 环境变量名 | notice 文案里出现过的 `XXX_API_KEY` 这类 token 会被替换成「服务端配置」再下发 |
| 调试面 | `debug` 与 `mode` **只认服务端 `--debug` 开关**，客户端传了也无效 |
| 输入校验 | `query` ≤ 300 字符；`district` 对照上海区白名单；`maxResults` 1–50 整数；`topics` ≤ 8 个且每个 ≤ 40 字符；请求体 ≤ 64 KB |
| 超时 | 单次检索 40 秒上限，超时返回可读的 504；线程池上限 8 |
| 限流 | 每 IP 每分钟 30 次检索请求，超出返回 429 与 `retryAfter` |
| 错误处理 | 详细堆栈只写服务端 stderr，浏览器只拿到一句可读中文 |
| 响应头 | `X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer`、`X-Frame-Options: SAMEORIGIN`、CSP（`connect-src 'self'`，`script-src` 无任何外域） |
| 前端自持 | React / ReactDOM / Babel / lucide **已本地化到 `assets/vendor/`**，不再从 `unpkg.com` 加载 |
| 指纹 | 不播报 Python 版本，`Server: Gorgon` |
| 只读 | 唯一「写」接口是 `POST /api/search`，它不修改任何服务器状态；没有管理接口、没有 shell、没有命令执行 |

### 你必须自己保证的

1. **永远不要 `--debug` + 公网同时开。** 那会让响应带上内部调试载荷。启动横幅会明确警告。
2. **本地不要 `--host 0.0.0.0`。** 默认只听 `127.0.0.1`；只有检测到 `PORT`（托管平台注入）时才会监听全部网卡。
   自己手动绑 `0.0.0.0` 会让同网段的人绕过隧道直连。
3. **密钥不进仓库、不进截图、不进聊天记录。** 用环境变量；`SEARCH_API_KEY` 只在服务端使用，永远不会下发到浏览器。
   （本仓库目前**没有** `.env` 文件，发布时也不会把密钥传上去。）
4. **URL 就是凭证。** Quick Tunnel 与平台链接都没有鉴权，任何拿到 URL 的人都能用。
5. **限流是进程内的。** 重启即清零，也不跨进程共享；如果将来跑多实例，需要换成外部限流。
6. **真实检索有出站成本。** 第三方来源的配额、速率限制与封禁风险由你承担；限流是为此加的第一道闸。
7. **字体仍来自 `fonts.googleapis.com`。** JS 运行时已本地化，字体没有；取不到时会退到系统字体栈，
   页面照常可用（这是有意的取舍：字体不影响功能）。要彻底自持就把字体也下到 `assets/vendor/`。
8. **线上响应头会被平台网关改写**（见 C 节实测表）：`X-Frame-Options` 丢失、`frame-ancestors` 被放宽到 `'self' *`。
   这是托管环境的行为，不在本仓库控制范围内。
9. **搜索结果是第三方的。** `trustScore` / 可信度标签只是提示，不构成保证；活动信息请以来源链接为准。
10. **跑服务的账户权限越小越好。** 建议用专用低权限账户，而不是管理员账户。

### 本轮明确没做

登录 · 注册 · 用户账户 · 权限系统 · 支付 · 收藏同步。
`我的周末` / 收藏目前只存在浏览器 `localStorage` 里，**不存在服务器上**，因此换设备不互通——
这也是「没有账户系统」的必然结果，不是 bug。
