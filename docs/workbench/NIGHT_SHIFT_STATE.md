# Night Shift State

```text
CURRENT_PHASE=PHASE 4A (AI_PROVIDER_FOUNDATION)
CURRENT_HEAD=8035a6a

LAST_COMPLETED=PHASE 3B (UI integration + E2E §40/§41/§42 + docs), committed 4280bd5; screenshot chore 8035a6a
CURRENT_TASK=PHASE 4A: build AI provider abstraction (config/provider/mock/budget/cache/usage) + unit tests
NEXT_TASK=Run npm test + test:build; confirm NEW_REGRESSIONS=0; commit PHASE 4A checkpoint; re-run Workbench E2E to protect §40/§41/§42

TEST_STATUS=
  UNIT=110/110 (pre-4A baseline)
  TEST_BUILD=18/18
  WORKBENCH_E2E=69/69 (prior run)
  LEGACY_E2E=58/58 (prior run)
  (4A tests pending first run)

KNOWN_FAILURES=none

FILES_TOUCHED=
  app/src/workbench/ai/* (NEW, dormant — not imported by app bundle)
  app/tests/ai.test.mjs (NEW)
  docs/workbench/NIGHT_SHIFT_STATE.md (NEW)

BLOCKERS=none

LAST_UPDATE=2026-10-08 01:18 GMT+8
```

## Notes
- Phase 3 is genuinely PASS (110/110 unit, 18/18 build-smoke, 69/69 Workbench E2E, 58/58 Legacy E2E on file).
- Phase 4A scope (per night-shift brief): build model infrastructure ONLY — AIProvider interface, MockProvider (no key/network), TokenBudget (MAX_AI_CALLS_PER_TASK=3), ResponseCache, UsageTracker, ModelConfig, factory. NO paid API. NO Agent Loop. Deterministic router stays primary; AI is fallback (wiring deferred).
- AI module is intentionally NOT imported by App/store/skills/router — keeps Settings "Not configured" + Workbench E2E `workbench-status-ai` assertions intact (no regression).
- STOP at 07:00, or on BLOCKER, or after 3 failed attempts on same issue.
