# Night Shift State

```text
CURRENT_PHASE=PHASE 4A (AI_PROVIDER_FOUNDATION)
CURRENT_HEAD=f023b33

LAST_COMPLETED=
  PHASE 3B (UI integration + E2E §40/§41/§42 + docs) committed 4280bd5
  screenshot chore 8035a6a
  PHASE 4A infra (config/provider/mock/budget/cache/index + 15 unit tests) committed f023b33

CURRENT_TASK=Verify Workbench E2E shows no regression after Phase 4A (ai/ module is dormant)
NEXT_TASK=Add concise docs/workbench/PHASE4_AI_FOUNDATION.md; then a SAFE, opt-in AI-assisted router fallback for intent="unknown" (only when provider configured; default off) OR stop 4A infra here and harden tests

TEST_STATUS=
  UNIT=125/125 (110 prior + 15 new AI tests)
  TEST_BUILD=18/18
  VITE_BUILD=PASS (404.78 kB — ai/ NOT bundled, proves dormant)
  WORKBENCH_E2E=69/69 (pending re-verify this run; BiVRe0)
  LEGACY_E2E=58/58 (prior run)

KNOWN_FAILURES=none

FILES_TOUCHED=
  app/src/workbench/ai/config.js (NEW)
  app/src/workbench/ai/provider.js (NEW)
  app/src/workbench/ai/providers/mock.js (NEW)
  app/src/workbench/ai/budget.js (NEW)
  app/src/workbench/ai/cache.js (NEW)
  app/src/workbench/ai/index.js (NEW)
  app/tests/ai.test.mjs (NEW)
  docs/workbench/NIGHT_SHIFT_STATE.md (NEW)

BLOCKERS=none

LAST_UPDATE=2026-10-08 01:24 GMT+8
```

## Notes
- Phase 3 genuinely PASS (verified this session: 110/110 unit, 18/18 build-smoke; E2E 69/69 + 58/58 on file).
- Phase 4A scope (per brief): model INFRASTRUCTURE ONLY. Delivered: AIProvider interface, MockProvider (offline, no key/network), TokenBudget (MAX_AI_CALLS_PER_TASK=3), ResponseCache, UsageTracker via AIClient, ModelConfig (real→mock auto-downgrade w/o key), factory.
- AI module is NOT imported by App/store/skills/router → Settings stays "Not configured", Workbench E2E `workbench-status-ai` assertion intact. No regression by construction.
- NO paid API, NO agent loop, deterministic router still primary. AI = fallback only (wiring deferred to a later phase).
- STOP at 07:00 / BLOCKER / 3x same failure.
