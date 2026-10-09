// Gorgon Workbench — Task Runner (Phase 3 execution engine).
//
// The Runner is the ONLY writer between Skills and the Task layer (§3).
// Skills return a SkillResult; the Runner persists it into the repository
// (steps, sources, result, timeline). A Skill can NEVER mutate a Task,
// localStorage, or React state — that keeps Phase-4 LLM skills from ever
// corrupting Task state.
//
// Flow (§18/§19):
//   created ─▶ planning ─(route)─▶ ready ─▶ running ─▶ completed | failed
//
// Determinism & safety (§48/§49):
//   * Router runs exactly ONCE per run.
//   * Each skill executes at most once, in a fixed, stable order.
//   * MAX_SKILLS_PER_TASK caps the work; manual selection is also clipped.
//   * A task already `running` is refused (concurrency guard).
//
// The Runner is dependency-injected: every external collaborator (repository,
// router, registry, search fn, clock) can be supplied via `options`, so it is
// unit-testable in plain Node with ZERO localStorage / DOM / LLM.

import {
  TASK_STATUS, makeStep,
} from "./task-model.js";
import {
  routeTask, MAX_SKILLS_PER_TASK,
} from "./task-router.js";
import {
  getSkill as defaultGetSkill,
} from "./skills/registry.js";

// Real repository is the default persistence layer (browser). It is only
// imported for its function signatures; its localStorage access happens inside
// the functions, which unit tests never reach because they inject a mock.
import * as defaultRepository from "../store/task-repository.js";

const defaultNow = () => new Date().toISOString();

/** Build a manual-selection route (§27). Clipped to the cap. */
function manualRoute(ids) {
  const clipped = Array.isArray(ids) ? ids.slice(0, MAX_SKILLS_PER_TASK) : [];
  return {
    intent: "manual",
    skillIds: clipped,
    confidence: 1,
    reasons: ["手动选择工具"],
  };
}

/**
 * Run a task to completion through the deterministic engine.
 *
 * @param {string} taskId
 * @param {object} [options]
 *   repository : { getTask, transitionTask, addTaskStep, updateTaskStep,
 *                 setTaskResult, addTaskSource, appendTimelineEvent, updateTask }
 *   router     : (input) => { intent, skillIds, confidence, reasons }
 *   registry   : { getSkill(id) => skill|null }
 *   search     : fn passed to the search skill as deps.search (real API client)
 *   aiClient   : OPT-IN AI client; when omitted every skill stays deterministic
 *   skillIds   : forced skill list (manual selection / re-run), overrides router
 *   now        : () => timestamp string
 * @returns {Promise<{ok:boolean, executed?:boolean, task?:object,
 *                     routed?:object, failed?:boolean, failureReason?:string,
 *                     code?:string, message?:string}>}
 */
export async function runTask(taskId, options = {}) {
  const repository = options.repository || defaultRepository;
  const router = options.router || routeTask;
  const registry = options.registry || { getSkill: defaultGetSkill };
  const now = typeof options.now === "function" ? options.now : defaultNow;
  // `aiClient` is OPT-IN (Phase 5). When absent, every Skill stays purely
  // deterministic — which is what keeps the competition demo at AI_CALLS = 0
  // and prevents a mock provider from degrading good local output.
  const deps = { search: options.search, now, aiClient: options.aiClient };

  const task0 = repository.getTask(taskId);
  if (!task0) {
    return { ok: false, code: "TASK_NOT_FOUND", message: "任务不存在" };
  }
  if (task0.status === TASK_STATUS.RUNNING) {
    return { ok: false, code: "TASK_ALREADY_RUNNING", message: "任务正在运行中，请勿重复执行", task: task0 };
  }
  if (task0.status !== TASK_STATUS.CREATED && task0.status !== TASK_STATUS.READY) {
    return {
      ok: false, code: "TASK_NOT_RUNNABLE",
      message: `任务处于「${task0.status}」状态，无法运行`, task: task0,
    };
  }

  const forced = Array.isArray(options.skillIds) && options.skillIds.length
    ? options.skillIds.slice()
    : null;

  let skillIds = [];
  let route = null;

  // ── Phase A: planning (only from a fresh `created` task) ──────────────
  if (task0.status === TASK_STATUS.CREATED) {
    repository.transitionTask(taskId, TASK_STATUS.PLANNING, { at: now() });
    repository.appendTimelineEvent(
      taskId, "routing_started", "开始分析任务目标", { goal: task0.goal },
    );

    route = forced ? manualRoute(forced) : router({ goal: task0.goal, metadata: task0.metadata });

    const curMeta = repository.getTask(taskId).metadata || {};
    repository.updateTask(taskId, {
      metadata: Object.assign({}, curMeta, { router: route }),
    });
    repository.appendTimelineEvent(
      taskId, "routing_completed",
      `确定工具：${route.skillIds.join(" + ") || "无"}`,
      { intent: route.intent, skillIds: route.skillIds, confidence: route.confidence },
    );

    skillIds = route.skillIds;

    if (skillIds.length === 0) {
      // §8: cannot determine intent. Leave the task ready; no steps, no run.
      repository.transitionTask(taskId, TASK_STATUS.READY, { at: now() });
      return {
        ok: true, executed: false, routed: route, reason: "unknown_intent",
        task: repository.getTask(taskId),
      };
    }

    // Create one step per skill; step.metadata.skillId links them (§20).
    for (const sid of skillIds) {
      const sk = registry.getSkill(sid);
      const title = sk ? sk.name : sid;
      repository.addTaskStep(taskId, makeStep(title, { metadata: { skillId: sid }, now: now() }));
    }
    repository.transitionTask(taskId, TASK_STATUS.READY, { at: now() });
  } else {
    // ── Manual selection / re-run from `ready` (§27) ───────────────────
    if (!forced) {
      return {
        ok: false, code: "NO_SKILLS_SPECIFIED",
        message: "请选择要执行的工具", task: repository.getTask(taskId),
      };
    }
    route = manualRoute(forced);
    skillIds = route.skillIds;
    const cur = repository.getTask(taskId);
    for (const sid of skillIds) {
      const exists = cur.steps.some((s) => s.metadata && s.metadata.skillId === sid);
      if (!exists) {
        const sk = registry.getSkill(sid);
        repository.addTaskStep(taskId, makeStep(sk ? sk.name : sid, { metadata: { skillId: sid }, now: now() }));
      }
    }
    const curMeta = repository.getTask(taskId).metadata || {};
    repository.updateTask(taskId, {
      metadata: Object.assign({}, curMeta, { router: route }),
    });
  }

  // ── Phase B: running ─────────────────────────────────────────────────
  repository.transitionTask(taskId, TASK_STATUS.RUNNING, { at: now() });

  const baseTask = repository.getTask(taskId);
  const previousResults = [];
  const previousSources = [];
  const aggregated = [];
  let failed = false;
  let failureReason = null;

  for (const sid of skillIds) {
    const skill = registry.getSkill(sid);
    if (!skill) {
      repository.appendTimelineEvent(
        taskId, "skill_failed", `工具「${sid}」未注册`, { skillId: sid },
      );
      failed = true;
      failureReason = `工具「${sid}」未注册`;
      break;
    }

    const step = baseTask.steps.find((s) => s.metadata && s.metadata.skillId === sid);
    repository.appendTimelineEvent(
      taskId, "skill_started", `开始执行：${skill.name}`, { skillId: sid },
    );
    if (step) repository.updateTaskStep(taskId, step.id, { status: "running" });

    let result;
    try {
      result = await skill.execute(
        { task: baseTask, goal: baseTask.goal, previousResults, previousSources },
        deps,
      );
    } catch (e) {
      result = {
        ok: false, skillId: sid,
        error: { code: "SKILL_THREW", message: String((e && e.message) || e) },
      };
    }

    if (result && result.ok) {
      if (step) {
        // Data accuracy: persist the skill's REAL metadata (method / aiAssisted /
        // aiReason / aiUsageTotal / simulated / isDemo ...) onto the step so the
        // "处理方式" panel reads actual values instead of defaults. Previously
        // only status + result content were written, silently dropping the very
        // metadata the UI promises to surface (§46 honesty guarantee).
        repository.updateTaskStep(taskId, step.id, {
          status: "completed",
          result: result.result || null,
          metadata: Object.assign({}, step.metadata || {}, result.metadata || {}),
        });
      }
      repository.appendTimelineEvent(
        taskId, "skill_completed", `完成：${skill.name}`, { skillId: sid },
      );
      const sources = Array.isArray(result.sources) ? result.sources : [];
      for (const src of sources) repository.addTaskSource(taskId, src);
      previousResults.push({ skillId: sid, result: result.result || null });
      previousSources.push(...sources);
      aggregated.push({ skillId: sid, result: result.result || null });
    } else {
      if (step) repository.updateTaskStep(taskId, step.id, { status: "failed" });
      const errMsg = (result && result.error && result.error.message) || "执行失败";
      const errCode = result && result.error ? result.error.code : null;
      repository.appendTimelineEvent(
        taskId, "skill_failed", `失败：${skill.name} — ${errMsg}`, { skillId: sid, code: errCode },
      );
      failed = true;
      failureReason = errMsg;
      break;
    }
  }

  // §22: single skill → its result; multi → workflow_result envelope.
  const finalResult = skillIds.length === 1
    ? (aggregated[0] ? aggregated[0].result : null)
    : { type: "workflow_result", content: aggregated };

  if (finalResult) repository.setTaskResult(taskId, finalResult);

  if (!failed) {
    repository.transitionTask(taskId, TASK_STATUS.COMPLETED, { at: now() });
    repository.appendTimelineEvent(
      taskId, "task_execution_completed", "任务执行完成", { skillIds },
    );
  } else {
    repository.transitionTask(taskId, TASK_STATUS.FAILED, { at: now(), failureReason });
  }

  return {
    ok: true, executed: true,
    task: repository.getTask(taskId),
    routed: route, failed, failureReason,
  };
}

export default runTask;
