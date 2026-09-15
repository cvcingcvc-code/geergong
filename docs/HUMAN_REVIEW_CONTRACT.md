# Human Review Loop — 数据契约（pipeline → admin → pipeline）

> 本文记录 PHASE 3 已落地的真实协议。字段名以现有 pipeline 输出为准，
> 不为了 UI 重构 pipeline。

## 1. pipeline → Admin：`ui_kits/admin/generated-review-data.js`

由 `python pipeline/run.py`（export 阶段自动）或
`pipeline/export/admin_review_export.py` 生成：

```js
window.GORGON_REVIEW_QUEUE = [ { ...item }, ... ];
```

`item` 的真实字段（源自 `pipeline/data/review/review_queue.json` 的 queue entry，
加一层 UI 展示映射）：

| 字段 | 来源 | 说明 |
| --- | --- | --- |
| `id` | activity.id | 稳定 id，decisions 的主键 |
| `title/category/date/time/venue/location/price` | activity.* | 展示映射（date=展示标签） |
| `startDate/startTime/endTime/district/organizer/registrationUrl/description/tags` | activity.* | 编辑目标字段 |
| `priceType` / `priceRaw` | activity | 价格归一化结果 |
| `source` | activity.sourceName | 来源名 |
| `sourceUrl` / `registrationUrl` | activity | 核实入口 |
| `crawledAt` | activity.collectedAt | 采集时间 |
| `score` | entry.trustScore | 0-100 |
| `suggestion` | 由 `reason` 映射 | `duplicate_candidate`/`cross_source_conflict`/`low_confidence`/`medium_confidence` → `"review"`；仅展示用 |
| `reviewReason` | entry.reason | 机器判定原因（原样保留） |
| `trustReasons` | activity.trustReasons | 评分解释（named reasons） |
| `checks` | 由 trustReasons/冲突 生成 | 复用现有 CheckRow 渲染 |
| `conflicts` | 冲突检测结果 | `[{type, detail}]`，type ∈ time/price/location_conflict |
| `duplicateCandidates` | entry.duplicateCandidates + candidate 快照 | `[{duplicateOf, duplicateConfidence, activity:{title,startDate,venue,organizer,sourceName}}]` |
| `status` | activity.status | `needs_review` |

`window.GORGON_REVIEW_QUEUE` 为空或缺失时，Admin 自动 fallback 到 `queue.js` 的
DEMO 队列（`ui_kits/admin/review-data.js` 负责）。

## 2. Admin → pipeline：`gorgon-review-decisions.json`

Admin「Export Review Decisions」按钮导出（浏览器下载），放入
`pipeline/data/review/human_decisions.json` 后由
`python pipeline/run.py --apply-reviews [path]` 消费：

```json
{
  "version": 1,
  "exportedAt": "2026-09-15T18:00:00",
  "decisions": {
    "b01": {
      "decision": "approved",           // approved | rejected | needs_edit
      "reviewedAt": "2026-09-15T17:59:00",
      "edits": { "venue": "西岸智塔 AI 空间" }
    }
  }
}
```

- 可编辑字段白名单：`title, startDate, startTime, venue, district, category, price, organizer, registrationUrl`。
  其他字段（id/trustScore/trustReasons/来源元数据）由 CLI 忽略并告警，原始 pipeline 数据永不修改。
- 同一 activity 多条 decision：**后写的覆盖先写的**（deterministic，按文件顺序）。
- 未知 activity id：整个文件拒绝（exit code 非 0），防手滑。
- `needs_edit`（RETURN）不算最终决定，不进入 approved，留在 pending。

## 3. 最终合并规则（--apply-reviews）

| 记录 | 结果 |
| --- | --- |
| pipeline 自动 approved | 直接进入 final approved（`reviewedBy: "auto"`） |
| 人工 approved（无 edits） | 进入 final approved（`reviewedBy: "human"`） |
| 人工 approved（有 edits） | 应用 edits 后进入（`humanEdited: true`） |
| 人工 rejected | 排除 |
| pending / 未决定 / duplicate candidate 未处理 | 排除 |

Provenance 字段（final approved 每条都带）：
`reviewedBy`（auto|human）、`reviewedAt`、`reviewDecision`（auto_approved|approved|rejected）、
`humanEdited`（bool）。不存个人姓名。

## 4. Admin 内部持久化

- 复用现有 localStorage key `gorgon_admin_review`（`GorgonStore.getAdmin/setAdmin`）。
- 值从老的 `"approve"` 字符串升级为
  `{ decision, reviewedAt, edits }`；读取时兼容旧字符串（视为 approved/reject/return）。
