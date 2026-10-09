# Phase 6 — Human Review / Action Safety

> 目标：把「AI / 引擎想做的事」与「真正执行的事」用一条**可审计的提议（Proposal）状态机**隔开。
> 人的批准是唯一的执行入口。

## 1. 为什么需要这一层

Phase 5 之后，技能可以调用模型产出内容。若把「模型输出」直接写回任务/系统，
就出现了不可审计的自动执行路径。Phase 6 引入 Proposal：**任何需要落地为外部动作的事情，
先变成一条待批准的提议**，未批准不得执行。

## 2. 模型（纯函数，可单测）

`app/src/workbench/proposal-model.js`

```text
PROPOSED ──approve──▶ APPROVED ──execute──▶ EXECUTED
   │                     │
   ├──edit──▶ EDITED ──▶ │            └──(外部动作未接入)──▶ FAILED
   │            │        │
   └────────────┴──reject─┴──▶ REJECTED
```

- `PROPOSAL_STATUS`：`proposed / approved / edited / rejected / executed / failed`
- `PROPOSAL_TRANSITIONS`：显式白名单。`edited → approved` 是**有意**保留的——
  一次编辑之后仍然需要一次明确的人工「是」，编辑不等于批准（此规则由单测守护）。
- `ACTION_KINDS` + `ALWAYS_REVIEW_ACTIONS`：某些动作类型**永远**需要人工审核，
  与置信度无关（`requiresReview(kind)`）。
- `createProposal` / `transitionProposal` / `effectivePayload` / `isPending` / `isTerminal`。

## 3. 仓储（同步、可注入）

`app/src/store/proposal-repository.js`，localStorage key `gorgon_workbench_proposals_v1`。

关键**安全护栏**（均由单测守护）：

| 护栏 | 行为 |
| --- | --- |
| 只能从 `PROPOSED` / `EDITED` 批准 | 其他状态调用 approve **原样返回，不抛错**（幂等、不产生非法转移） |
| 只能从 `APPROVED` 执行 | 未批准直接 execute → 拒绝，状态不变 |
| 外部动作 | 未接入时 → `FAILED` 并写明诚实原因，**绝不假装成功** |
| 审计 | 每次转移都追加 `{ status, at, note }` 到 `history` |

`executeProposal` 是**同步**函数（它不产生异步副作用）——早期写成 async 导致审批链拿到 Promise，已修正。

## 4. Store / UI 接线

- `workbench-store.js`：`getProposals` / `addProposal` / `decideProposal(id, decision)`。
  批准时通过注入的 `createTask` 钩子**真正**创建一个后续任务（`decideProposal` 会刷新任务列表）。
- `ReviewCenterScreen`：新增 REAL Proposals 区（`data-testid="workbench-proposals"`），
  含 approve / reject / history；旧 demo 卡片**降到最后**并继续标注 DEMO，不混淆真假。

## 5. 验收（实测）

- `app/tests/proposal-model.test.mjs`：14 条（含 `edited → approved`、非法转移、终态判定）
- `app/tests/e2e_workbench_shell.mjs` §60/§61/§62：
  提议生成 → 批准 → executed；拒绝的提议**永不**到达 executed；
  批准**真的**创建了后续任务（before=0 → after=1）；已决提议进入审计历史。
- `phase6: console errors = 0`

## 6. 明确不做

不做多智能体、不做自动循环、不做自动执行外部动作。人仍然是唯一的执行授权来源。
