# Night Shift State

```text
CURRENT_PHASE=PHASE 4A (AI_PROVIDER_FOUNDATION) — INFRA COMPLETE, GATE GREEN
CURRENT_HEAD=598d79c

LAST_COMPLETED=
  PHASE 3B (UI integration + E2E §40/§41/§42 + docs) committed 4280bd5
  screenshot chore 8035a6a
  PHASE 4A infra (config/provider/mock/budget/cache/index + 15 unit tests) f023b33
  PHASE 4A doc + artifact refresh 2cb0240
  legacy screenshot refresh 3ac5b2d
  state checkpoint 0b15634
  run-UX hardening (disable Run when ready+no skills) + NO_SKILLS_SPECIFIED guard 448be4a
  Scenario B guard (search executes exactly once) 598d79c

CURRENT_TASK=Doc accuracy pass on PHASE4_AI_FOUNDATION.md (numbers now stale)
NEXT_TASK=TASK-4C (safe, in-scope — pick ONE):
  (a) a11y: add aria-labels to run / manual-tool buttons (no testid/text change)
  (b) responsive check of TaskDetail runzone at 390px (already covered by mobile E2E)
  (c) add error-code enum doc for AI responses (AI_BUDGET_EXCEEDED / AI_EMPTY_INPUT / AI_INVALID_REQUEST)
  Recommend (a): tiny, zero regression risk, explicitly allowed by the brief.

GATE (latest verified this session):
  UNIT=127/127
  TEST_BUILD=18/18
  VITE_BUILD=PASS (~404.85 kB)
  WORKBENCH_E2E=69/69 (console errors 0) — re-verified after TaskDetail change
  LEGACY_E2E=58/58 (console errors 0)
  NEW_REGRESSIONS=0
  PIPELINE_CHANGED=false
  LLM_PAID_API=none (MockProvider only; no keys, no network)
  NEW_DEPENDENCIES=0

KNOWN_FAILURES=none

FILES_TOUCHED (this session):
  app/src/workbench/ai/config.js (NEW)
  app/src/workbench/ai/provider.js (NEW)
  app/src/workbench/ai/providers/mock.js (NEW)
  app/src/workbench/ai/budget.js (NEW)
  app/src/workbench/ai/cache.js (NEW)
  app/src/workbench/ai/index.js (NEW)
  app/tests/ai.test.mjs (NEW)
  app/tests/task-runner.test.mjs (MOD — 2 hardening tests)
  app/src/screens/TaskDetailScreen.jsx (MOD — Run disabled on ready+no-skills)
  docs/workbench/PHASE4_AI_FOUNDATION.md (NEW, accuracy pass pending commit)
  docs/workbench/NIGHT_SHIFT_STATE.md (NEW)

BLOCKERS=none

LAST_UPDATE=2026-10-08 01:59 GMT+8
```

## Notes
- Verified assumption: the "unknown intent" empty-state message ALREADY existed in TaskDetailScreen (lines ~280-284) — the queued TASK-4B needed no work. Replaced with the real gap: Run button was clickable for ready+no-skills producing a no-op error → now disabled.
- Runner error paths confirmed safe (no hang/crash): created+unknown → executed:false reason unknown_intent → ready; ready+null → NO_SKILLS_SPECIFIED clean error. Both now regression-tested.
- Scenario B "plan uses search, 禁止重复搜索" verified: plan consumes previousResults (metadata.source="search_results", already tested in skills.test.mjs:151) AND search now proven to execute exactly once per run.
- AI module stays DORMANT (not imported by App/store/skills/router) → Settings "Not configured" + E2E `workbench-status-ai` assertions intact by construction.
- Do NOT invent Phase 5/6. Remaining time → only Demo stability / 空状态 / 错误处理 / a11y / tests.
- STOP at 07:00 / BLOCKER / 3x same failure on one issue.
