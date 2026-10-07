# Night Shift State

```text
CURRENT_PHASE=PHASE 4A (AI_PROVIDER_FOUNDATION) — INFRA COMPLETE, GATE GREEN
CURRENT_HEAD=3ac5b2d

LAST_COMPLETED=
  PHASE 3B (UI integration + E2E §40/§41/§42 + docs) committed 4280bd5
  screenshot chore 8035a6a
  PHASE 4A infra (config/provider/mock/budget/cache/index + 15 unit tests) committed f023b33
  PHASE 4A doc + artifact refresh committed 2cb0240
  legacy screenshot refresh committed 3ac5b2d

CURRENT_TASK=Phase 4A gate closed (all green); choose next safe task
NEXT_TASK=TASK-4B (safe, in-scope): graceful "unknown intent" empty-state in TaskDetail
  - When router returns intent="unknown" (no skill matched), show clear label
    "本地规则未匹配到技能，可手动选择" + keep manual-skill buttons enabled.
  - No AI invoked. Pure UX polish for 比赛 Demo 稳定性 / 空状态.
  - Re-run Workbench E2E after change to protect §40/§41/§42.

GATE (Phase 4A, verified this session):
  UNIT=125/125
  TEST_BUILD=18/18
  VITE_BUILD=PASS (404.78 kB — ai/ NOT bundled, proves dormant)
  WORKBENCH_E2E=69/69 (console errors 0)
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
  docs/workbench/PHASE4_AI_FOUNDATION.md (NEW)
  docs/workbench/NIGHT_SHIFT_STATE.md (NEW)

BLOCKERS=none

LAST_UPDATE=2026-10-08 01:22 GMT+8
```

## Notes
- Phase 3 genuinely PASS (verified: 110/110 unit + 18/18 build-smoke; E2E 69/69 + 58/58 on file, re-confirmed this session after 4A).
- Phase 4A = model INFRASTRUCTURE ONLY. Delivered + tested + documented. AI module is dormant (not imported by App/store/skills/router) → Settings "Not configured" + E2E assertions intact.
- Safety rails enforced: no paid API, no key guessing, no agent loop, deterministic router primary, AI = fallback only (wiring deferred to a later phase).
- STOP at 07:00 / BLOCKER / 3x same failure.
- Do NOT invent Phase 5/6. Remaining time → only Demo stability / 空状态 / 错误处理 / tests.
