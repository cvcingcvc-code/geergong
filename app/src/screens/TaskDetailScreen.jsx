// Gorgon Workbench — TaskDetailScreen (Phase 2).
//
// The formal detail surface for ONE task: title / goal / status / times /
// steps / sources / result / timeline (§14). Simulation buttons drive the
// REAL State Machine — buttons for illegal transitions are not rendered,
// so an illegal move is impossible from this UI. No AI, no backend.

import React from "react";
import { Button } from "../lib/ds.js";
import * as WB from "../store/workbench-store.js";
import { TASK_STATUS, canTransition } from "../workbench/task-model.js";
import * as SkillRegistry from "../workbench/skills/registry.js";
import { Icon } from "../components/Icon.jsx";

const STATUS_LABEL = {
  created: "已创建",
  planning: "规划中",
  ready: "等待执行",
  running: "执行中",
  review_required: "待审核",
  completed: "已完成",
  failed: "失败",
};

const STEP_LABEL = { pending: "待执行", running: "执行中", completed: "已完成", failed: "失败" };

const EVENT_LABEL = {
  task_created: "创建任务",
  status_changed: "状态变更",
  step_added: "添加步骤",
  step_updated: "更新步骤",
  source_added: "添加来源",
  result_saved: "保存结果",
  task_failed: "任务失败",
};

const EVENT_ICON = {
  task_created: "plus",
  status_changed: "git-branch",
  step_added: "list-plus",
  step_updated: "list-todo",
  source_added: "link",
  result_saved: "file-check",
  task_failed: "alert-triangle",
  // Phase 3 execution events (§23).
  routing_started: "compass",
  routing_completed: "map",
  skill_started: "play",
  skill_completed: "check-circle",
  skill_failed: "alert-triangle",
  task_execution_completed: "flag",
};

// Phase 3 Router result rendering (§25): map skill ids / intent → labels.
function skillName(id) {
  const s = SkillRegistry.getSkill(id);
  return s ? s.name : id;
}
function intentLabel(router) {
  if (!router) return "未分析";
  if (router.intent === "unknown") return "未识别（需手动选择工具）";
  if (router.intent === "manual") return "手动选择";
  if (router.intent === "workflow") return "多步工作流";
  return skillName(router.intent);
}

// The 5 deterministic skills a user may pick manually (§27). Order matters.
const MANUAL_SKILLS = ["search", "summarize", "extract", "plan", "write"];

// Simulation controls (§14): each maps to a LEGAL transition target; the
// button only renders when canTransition(current, target) is true.
const SIM_ACTIONS = [
  { key: "planning", to: TASK_STATUS.PLANNING, label: "进入规划", testid: "workbench-detail-sim-planning" },
  { key: "ready", to: TASK_STATUS.READY, label: "准备就绪", testid: "workbench-detail-sim-ready" },
  { key: "running", to: TASK_STATUS.RUNNING, label: "开始执行", testid: "workbench-detail-sim-running" },
  { key: "review", to: TASK_STATUS.REVIEW_REQUIRED, label: "需要审核", testid: "workbench-detail-sim-review" },
  { key: "completed", to: TASK_STATUS.COMPLETED, label: "标记完成", testid: "workbench-detail-sim-completed" },
  { key: "failed", to: TASK_STATUS.FAILED, label: "标记失败", testid: "workbench-detail-sim-failed" },
];

function fmtTime(iso) {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  } catch (e) { return ""; }
}

function Section({ title, testid, children, extra }) {
  return (
    <div style={{ marginTop: 20 }} data-testid={testid}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 9 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-muted)" }}>{title}</div>
        {extra}
      </div>
      {children}
    </div>
  );
}

const card = {
  background: "var(--surface-card)", border: "1px solid var(--border-subtle)",
  borderRadius: "var(--radius-md)", padding: "12px 14px",
};

export function TaskDetailScreen({ task, onTransition, onBack, onAddStep, onUpdateStep, onSetResult, onAddSource, onRun }) {
  const [stepTitle, setStepTitle] = React.useState("");
  const [sourceTitle, setSourceTitle] = React.useState("");
  const [resultText, setResultText] = React.useState("");
  const [running, setRunning] = React.useState(false);
  const [runError, setRunError] = React.useState(null);

  const isRunnable = (task.status === TASK_STATUS.CREATED || task.status === TASK_STATUS.READY) && !running;
  const router = task.metadata && task.metadata.router;

  const handleRun = async (skillIds) => {
    if (!onRun || running) return;
    setRunError(null);
    setRunning(true);
    try {
      const out = await onRun(task.id, skillIds ? { skillIds } : {});
      if (out && out.ok === false && out.code) {
        setRunError(out.message || "无法运行任务");
      }
    } catch (e) {
      setRunError(String((e && e.message) || e));
    } finally {
      setRunning(false);
    }
  };

  if (!task) {
    return (
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }} data-gg-screen="workbench-task-detail">
        <div style={{ padding: "28px 16px", maxWidth: 860, margin: "0 auto" }}>
          <div style={{ fontSize: 13.5, color: "var(--text-faint)" }}>任务不存在或已被删除。</div>
          {onBack && <div style={{ marginTop: 12 }}><Button onClick={onBack}>返回任务列表</Button></div>}
        </div>
      </div>
    );
  }

  const legalActions = SIM_ACTIONS.filter((a) => canTransition(task.status, a.to));

  const submitStep = () => {
    const t = stepTitle.trim();
    if (!t) return;
    onAddStep(t);
    setStepTitle("");
  };

  const submitSource = () => {
    const t = sourceTitle.trim();
    if (!t) return;
    onAddSource({ type: "user", title: t });
    setSourceTitle("");
  };

  const saveResult = () => {
    const t = resultText.trim();
    if (!t) return;
    onSetResult({ type: "text", content: t });
    setResultText("");
  };

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }} data-gg-screen="workbench-task-detail">
      <div style={{ padding: "28px 16px 48px", maxWidth: 860, margin: "0 auto", width: "100%" }}>
        {onBack && (
          <button onClick={onBack} data-testid="workbench-detail-back"
            style={{ border: "none", background: "transparent", color: "var(--brand)", fontSize: 13, fontWeight: 600, cursor: "pointer", padding: 0, marginBottom: 14, display: "inline-flex", alignItems: "center", gap: 5 }}>
            <Icon name="arrow-left" style={{ width: 15, height: 15 }} />返回任务列表
          </button>
        )}

        {/* header */}
        <div data-testid="workbench-detail-header">
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span data-testid="workbench-detail-status" style={{
              fontSize: 11.5, fontWeight: 700, padding: "4px 11px", borderRadius: "var(--radius-pill)",
              background: task.status === "completed" ? "var(--accent-soft)" : task.status === "failed" ? "var(--danger-soft)" : "var(--brand-soft)",
              color: task.status === "completed" ? "var(--accent-strong, #047857)" : task.status === "failed" ? "var(--danger)" : "var(--brand)",
            }}>
              {STATUS_LABEL[task.status] || task.status}
            </span>
            {task.status === "created" && (
              <span style={{ fontSize: 12, color: "var(--text-faint)" }}>等待任务引擎 · 尚未开始执行</span>
            )}
          </div>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 23, color: "var(--text-strong)", margin: "10px 0 0", lineHeight: 1.4 }}>
            {task.title}
          </h1>
          <div style={{ marginTop: 10, ...card, fontSize: 13.5, color: "var(--text-body)", lineHeight: 1.7 }} data-testid="workbench-detail-goal">
            {task.goal}
          </div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 10, fontSize: 12, color: "var(--text-faint)" }}>
            <span>创建于 {fmtTime(task.createdAt)}</span>
            <span>更新于 {fmtTime(task.updatedAt)}</span>
            {task.startedAt && <span>开始于 {fmtTime(task.startedAt)}</span>}
            {task.completedAt && <span>完成于 {fmtTime(task.completedAt)}</span>}
            {task.failureReason && (
              <span style={{ color: "var(--danger)" }} data-testid="workbench-detail-failure">失败原因：{task.failureReason}</span>
            )}
          </div>
        </div>

        {/* ── Phase 3: run / router / manual selection (§18/§24/§25/§27) ── */}
        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 12 }} data-testid="workbench-detail-runzone">
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <Button variant="primary" data-testid="workbench-detail-run" disabled={!isRunnable}
              onClick={() => handleRun(null)}
              leadingIcon={<Icon name={running ? "compass" : "play"} style={{ width: 15, height: 15 }} />}>
              {running ? "正在执行…" : "运行任务"}
            </Button>
            {task.status === TASK_STATUS.CREATED && !running && (
              <span style={{ fontSize: 12, color: "var(--text-faint)" }}>
                任务引擎会先分析目标，再按顺序执行对应工具。
              </span>
            )}
            {task.status === TASK_STATUS.RUNNING && (
              <span style={{ fontSize: 12, color: "var(--brand)" }}>正在执行，请勿重复点击。</span>
            )}
            {runError && (
              <span data-testid="workbench-detail-run-error" style={{ fontSize: 12.5, color: "var(--danger)" }}>
                {runError}
              </span>
            )}
          </div>

          {router && (
            <div style={{ ...card, fontSize: 13, lineHeight: 1.7 }} data-testid="workbench-detail-router">
              <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-faint)", marginBottom: 7, letterSpacing: "0.03em" }}>
                任务路由（确定性规则）
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 7 }}>
                <span style={{ color: "var(--text-muted)", fontWeight: 600, marginRight: 4 }}>任务类型：</span>
                <span style={{ fontWeight: 700, color: "var(--text-strong)" }}>{intentLabel(router)}</span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 7 }}>
                <span style={{ color: "var(--text-muted)", fontWeight: 600, marginRight: 4 }}>使用工具：</span>
                {router.skillIds.length === 0 ? (
                  <span style={{ color: "var(--text-faint)" }}>无（未识别到明确能力）</span>
                ) : (
                  router.skillIds.map((sid) => (
                    <span key={sid} style={{
                      fontSize: 12, fontWeight: 600, padding: "2px 9px", borderRadius: "var(--radius-pill)",
                      background: "var(--brand-soft)", color: "var(--brand)",
                    }}>✓ {skillName(sid)}</span>
                  ))
                )}
              </div>
              <div style={{ color: "var(--text-muted)" }}>
                <span style={{ fontWeight: 600, marginRight: 4 }}>判断依据：</span>
                {router.reasons.length ? router.reasons.join("；") : "（未识别到关键词）"}
              </div>
            </div>
          )}

          {isRunnable && (
            <div data-testid="workbench-detail-manual">
              <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-faint)", marginBottom: 7, letterSpacing: "0.03em" }}>
                手动选择工具（确定性本地能力，无需模型）
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {MANUAL_SKILLS.map((sid) => (
                  <button key={sid} data-testid={"workbench-detail-manual-" + sid} disabled={running}
                    onClick={() => handleRun([sid])}
                    style={{
                      border: "1px solid var(--border-subtle)", background: "var(--surface-card)",
                      color: "var(--text-body)", fontSize: 12.5, fontWeight: 600, cursor: running ? "default" : "pointer",
                      padding: "7px 12px", borderRadius: "var(--radius-pill)", fontFamily: "var(--font-sans)",
                    }}>
                    {skillName(sid)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {router && router.intent === "unknown" && (
            <div style={{ fontSize: 12.5, color: "var(--text-muted)", background: "var(--bg-sunken)", borderRadius: "var(--radius-md)", padding: "9px 13px", lineHeight: 1.6 }}>
              暂时无法确定该使用哪项能力。你可以修改目标，或手动选择一个工具。
            </div>
          )}
        </div>

        {/* simulation controls — LEGAL transitions only (kept for manual state checks) */}
        <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }} data-testid="workbench-detail-actions">
          {legalActions.map((a) => (
            <button key={a.key} data-testid={a.testid} onClick={() => onTransition(a.to)}
              style={{
                border: "1px solid var(--border-subtle)", background: "var(--surface-card)",
                color: "var(--text-body)", fontSize: 12.5, fontWeight: 600, cursor: "pointer",
                padding: "8px 13px", borderRadius: "var(--radius-sm)", fontFamily: "var(--font-sans)",
              }}>
              {a.label}
            </button>
          ))}
          {legalActions.length === 0 && (
            <span style={{ fontSize: 12, color: "var(--text-faint)" }}>
              任务已到终态（{STATUS_LABEL[task.status] || task.status}），没有可用流转。
            </span>
          )}
        </div>

        {/* steps */}
        <Section title={`步骤 (${task.steps.length})`} testid="workbench-detail-steps">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {task.steps.map((s) => (
              <div key={s.id} data-testid="workbench-detail-step" style={{ ...card, display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ minWidth: 0, flex: 1, fontSize: 13.5, fontWeight: 600, color: "var(--text-strong)" }}>{s.title}</div>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-muted)" }}>{STEP_LABEL[s.status] || s.status}</span>
                {s.status === "pending" && onUpdateStep && (
                  <button data-testid="workbench-detail-step-start" onClick={() => onUpdateStep(s.id, { status: "running" })}
                    style={{ border: "1px solid var(--border-subtle)", background: "transparent", fontSize: 12, fontWeight: 600, cursor: "pointer", padding: "5px 10px", borderRadius: "var(--radius-sm)", color: "var(--text-body)" }}>
                    开始
                  </button>
                )}
                {(s.status === "running" || s.status === "pending") && onUpdateStep && (
                  <button data-testid="workbench-detail-step-complete" onClick={() => onUpdateStep(s.id, { status: "completed" })}
                    style={{ border: "1px solid var(--border-subtle)", background: "transparent", fontSize: 12, fontWeight: 600, cursor: "pointer", padding: "5px 10px", borderRadius: "var(--radius-sm)", color: "var(--text-body)" }}>
                    完成
                  </button>
                )}
              </div>
            ))}
            <div style={{ display: "flex", gap: 9 }}>
              <input aria-label="新步骤标题" data-testid="workbench-detail-step-input" placeholder="添加一个步骤，例如：收集本周活动列表"
                value={stepTitle} onChange={(e) => setStepTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submitStep(); }}
                style={{ flex: 1, minWidth: 0, border: "1px solid var(--border-subtle)", outline: "none", borderRadius: "var(--radius-md)", padding: "10px 13px", background: "var(--surface-card)", fontFamily: "var(--font-sans)", fontSize: 13.5, color: "var(--text-strong)" }} />
              <Button onClick={submitStep} disabled={!stepTitle.trim()}>添加步骤</Button>
            </div>
          </div>
        </Section>

        {/* sources */}
        <Section title={`来源 (${task.sources.length})`} testid="workbench-detail-sources">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {task.sources.map((s) => (
              <div key={s.id} data-testid="workbench-detail-source" style={{ ...card, display: "flex", alignItems: "center", gap: 12 }}>
                <Icon name="link" style={{ width: 15, height: 15, color: "var(--text-faint)", flex: "none" }} />
                <div style={{ minWidth: 0, flex: 1, fontSize: 13, color: "var(--text-body)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {s.url ? <a href={s.url} target="_blank" rel="noreferrer" style={{ color: "var(--brand)" }}>{s.title}</a> : s.title}
                </div>
                {s.demo && (
                  <span data-testid="workbench-detail-demo-badge" style={{ flex: "none", fontSize: 10.5, fontWeight: 700, padding: "2px 7px", borderRadius: "var(--radius-pill)", background: "var(--warning-soft)", color: "#9A6300" }}>
                    DEMO 数据
                  </span>
                )}
                <span style={{ fontSize: 11.5, color: "var(--text-faint)", flex: "none" }}>{s.type}</span>
              </div>
            ))}
            <div style={{ display: "flex", gap: 9 }}>
              <input aria-label="新来源标题" data-testid="workbench-detail-source-input" placeholder="添加一个来源，例如：活动官网"
                value={sourceTitle} onChange={(e) => setSourceTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submitSource(); }}
                style={{ flex: 1, minWidth: 0, border: "1px solid var(--border-subtle)", outline: "none", borderRadius: "var(--radius-md)", padding: "10px 13px", background: "var(--surface-card)", fontFamily: "var(--font-sans)", fontSize: 13.5, color: "var(--text-strong)" }} />
              <Button onClick={submitSource} disabled={!sourceTitle.trim()}>添加来源</Button>
            </div>
          </div>
        </Section>

        {/* result */}
        <Section title="结果" testid="workbench-detail-result">
          {task.result ? (
            <div style={card} data-testid="workbench-detail-result-view">
              <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-faint)", marginBottom: 6 }}>
                {task.result.type} · {fmtTime(task.result.createdAt)}
              </div>
              <div style={{ fontSize: 13.5, color: "var(--text-body)", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
                {typeof task.result.content === "string" ? task.result.content : JSON.stringify(task.result.content, null, 2)}
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 12.5, color: "var(--text-faint)", padding: "4px 0 10px" }}>还没有保存结果。</div>
          )}
          <div style={{ display: "flex", gap: 9, marginTop: 10 }}>
            <input aria-label="结果内容" data-testid="workbench-detail-result-input" placeholder="记录一段文本结果，例如：已确认 3 场目标活动"
              value={resultText} onChange={(e) => setResultText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") saveResult(); }}
              style={{ flex: 1, minWidth: 0, border: "1px solid var(--border-subtle)", outline: "none", borderRadius: "var(--radius-md)", padding: "10px 13px", background: "var(--surface-card)", fontFamily: "var(--font-sans)", fontSize: 13.5, color: "var(--text-strong)" }} />
            <Button onClick={saveResult} disabled={!resultText.trim()}>保存结果</Button>
          </div>
        </Section>

        {/* timeline */}
        <Section title={`时间线 (${task.timeline.length})`} testid="workbench-detail-timeline">
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }} data-testid="workbench-detail-timeline-list">
            {task.timeline.slice().reverse().map((ev, i) => {
              const meta = { icon: EVENT_ICON[ev.type] || "info", label: EVENT_LABEL[ev.type] || ev.type };
              return (
                <div key={ev.id || i} data-testid="workbench-detail-timeline-item" style={{
                  display: "flex", alignItems: "center", gap: 12, padding: "10px 13px",
                  background: "var(--surface-card)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)",
                }}>
                  <span style={{ flex: "none", width: 28, height: 28, borderRadius: "var(--radius-sm)", background: "var(--bg-sunken)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                    <Icon name={meta.icon} style={{ width: 14, height: 14, color: "var(--text-muted)" }} />
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-strong)" }}>{meta.label}</div>
                    {ev.message && (
                      <div style={{ fontSize: 12.5, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ev.message}</div>
                    )}
                  </div>
                  <span style={{ flex: "none", fontSize: 11.5, color: "var(--text-faint)", fontVariantNumeric: "tabular-nums" }}>{fmtTime(ev.timestamp)}</span>
                </div>
              );
            })}
          </div>
        </Section>
      </div>
    </div>
  );
}
