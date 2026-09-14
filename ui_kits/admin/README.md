# Gorgon — 审核后台 UI Kit(人工审核控制台)

运营侧的「人工审核 + 自动验证」控制台,把爬取来的活动审过再上架。

## 这条链路在哪一环
```
①自动爬取 → ②自动校验(机器) → ③人工审核(本界面) → ④发布到 App
```
- ①②④ 是后端(爬虫 / 校验服务 / 数据库),浏览器跑不了,属开发阶段。
- **③ 就是这个界面** —— 决定「自动化验证」最终靠不靠谱的人在回路(human-in-the-loop)。

## 运行
打开 `index.html`,加载 `../../_ds_bundle.js` 与 `queue.js`(待审核样例队列)。

## 结构
- **顶栏** — Logo、链路说明、统计(待审核 / 自动通过率 / 今日已处理)。
- **左侧队列**(`QueueItem`)— 每条爬取活动:综合评分环 + 标题 + 来源 + 抓取时间 +
  机器建议状态点(绿=自动通过 / 琥珀=需核实 / 红=建议拒绝)。
- **中部校验面板**(`ReviewPanel` + `CheckRow`)— 机器建议横幅 + 六项自动校验
  (来源核验 / 去重 / 地址解析 / 时间校验 / 风险扫描 / 封面图),每项 pass·warn·fail。
- **右侧预览 + 操作** — 用真实 `ActivityCard` 预览上架后的样子;操作:
  **通过并发布 / 退回核实 / 拒绝**。处理过的条目在队列中置灰标记。

## 自动校验模型(`queue.js`)
每条 `item` 带 `score`(0–100)、`suggestion`(auto_pass / review / reject)和 `checks[]`
(`{ key, label, status, detail }`)。生产环境由后端校验服务产出,前端只负责呈现 + 收集人工决策。

组合复用 `components/core` 与 `components/trust`(`SourceTag`、`VerifiedBadge`、`Tag`、
`Button`、`StatBlock`、`ActivityCard`)。图标:Lucide CDN。
