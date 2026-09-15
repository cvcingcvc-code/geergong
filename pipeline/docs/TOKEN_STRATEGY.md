# Token Strategy — 能用确定性代码完成的，绝不调用 LLM

## 本阶段禁止调用 LLM 的阶段（全部是纯规则，当前实现即是）

| 阶段 | 说明 | 实现位置 |
| --- | --- | --- |
| normalize | 标题/地区/城市/场馆文本规则 | `normalize/text.py`, `normalize/location.py` |
| 日期解析 | `2026/09/20` `2026-09-20` `9月20日` `晚上7点` … | `normalize/datetime.py` |
| 价格解析 | `免费` `0元` `¥0` `￥0` `free` `¥29` … | `normalize/activity.py` |
| clean | HTML / 空白 / 垃圾字符 / emoji / 重复标签 | `clean/cleaner.py` |
| 基础 dedupe | exact 匹配 + difflib 相似度（阈值 0.82） | `dedupe/deduplicator.py` |
| trust 打分 | 加减分规则表 + named reasons | `trust/scorer.py` |
| schema validation | 结构校验（字段类型/取值域） | `schema.py::validate` |
| review 路由 | 阈值路由（≥80 / 50-80 / <50） | `review/queue.py` |
| Gorgon export | 字段映射 + 展示默认值 | `export/gorgon_export.py` |

理由：以上任务 LLM 不确定、慢、贵、不可复现，而规则代码 100% 确定、免费、毫秒级、可测试。

## 未来允许调用模型的场景（白名单，均未实现）

1. **复杂语义分类**：关键词规则打不出的类目判断（如「这是讲座还是社群聚会？」语义模糊时）。
2. **深度同活动判定**：两个活动文本差异巨大（标题完全不同）但可能是同一活动，
   规则相似度失效时，才让模型辅助判断，且输出仅作为 needs_review 的候选，不自动合并。
3. **长文结构抽取**：从一篇长文章 / 公众号推文中抽取活动结构化字段
   （此时用 `WechatSourceAdapter` 拿原文，LLM 只做抽取，normalize 仍走规则）。
4. **来源冲突解释**：两个来源冲突时生成一句给审核员看的解释（不参与打分）。
5. **复杂内容质量判断**：如判断描述是否为纯广告软文（规则黑名单覆盖不了的长尾）。

## 规则

> **能用 deterministic code 完成的，绝不调用 LLM。**

- LLM 只允许出现在上表白名单场景，且必须落在 ingest 之前或 trust 之后，
  不允许插入 normalize→review 的主干（保证主干可重放、可测试）。
- LLM 的任何输出只允许作为「候选/建议」进入 review queue，不允许直接改写 approved 数据。
- 每引入一处 LLM 调用，必须记录：触发条件、调用频率上限、缓存策略、失败降级路径。
- 任何 LLM 结果必须带 `llmAssisted: true` 标记，保证数据血统可审计。
