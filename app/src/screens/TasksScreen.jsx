// Gorgon Workbench — TasksScreen (Phase 2: formal Task Engine data).
//
// Reads the v2 Task model via the repository facade and offers the §15
// filter vocabulary: 全部 / 进行中 / 待审核 / 已完成 / 失败. Status
// changes go through the State Machine only. Clicking a task opens its
// Task Detail.

import React from "react";
import { Button } from "../lib/ds.js";
import * as WB from "../store/workbench-store.js";
import { canTransition } from "../workbench/task-model.js";
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

const STATUS_TONE = {
  created: { color: "var(--text-muted)", bg: "var(--bg-sunken)" },
  planning: { color: "var(--brand)", bg: "var(--brand-soft)" },
  ready: { color: "var(--brand)", bg: "var(--brand-soft)" },
  running: { color: "var(--brand)", bg: "var(--brand-soft)" },
  review_required: { color: "#9A6300", bg: "var(--warning-soft)" },
  completed: { color: "var(--accent-strong, #047857)", bg: "var(--accent-soft)" },
  failed: { color: "var(--danger)", bg: "var(--danger-soft)" },
};

// §15 filter groups.
const FILTER_GROUPS = {
  all: null,
  active: ["created", "planning", "ready", "running"],
  review: ["review_required"],
  completed: ["completed"],
  failed: ["failed"],
};

const FILTERS = [
  { key: "all", label: "全部" },
  { key: "active", label: "进行中" },
  { key: "review", label: "待审核" },
  { key: "completed", label: "已完成" },
  { key: "failed", label: "失败" },
];

// One-step "next action" shortcuts, driven by the real state machine.
const NEXT_ACTION = {
  created: { label: "准备就绪", to: "ready" },
  ready: { label: "开始执行", to: "running" },
  review_required: { label: "继续任务", to: "running" },
};

function fmtTime(iso) {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  } catch (e) { return ""; }
}

export function TasksScreen({ tasks, onStatusChange, onAddTask, onOpenTask }) {
  const [value, setValue] = React.useState("");
  const [filter, setFilter] = React.useState("all");

  const group = FILTER_GROUPS[filter];
  const list = tasks.filter((t) => !group || group.indexOf(t.status) >= 0);

  const submit = () => {
    const t = value.trim();
    if (!t) return;
    onAddTask(t);
    setValue("");
  };

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }} data-gg-screen="workbench-tasks">
      <div style={{ padding: "28px 16px 40px", maxWidth: 860, margin: "0 auto", width: "100%" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 24, color: "var(--text-strong)", margin: 0 }}>
            我的任务
          </h1>
          <span style={{ fontSize: 12, color: "var(--text-faint)" }}>
            本地任务数据 · Task Engine v2 · 状态机受控
          </span>
        </div>

        {/* add form */}
        <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
          <input
            aria-label="新建任务目标"
            data-testid="workbench-task-new-input"
            placeholder="新建一个任务，例如：整理比赛资料"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            style={{
              flex: 1, minWidth: 0, border: "1px solid var(--border-subtle)", outline: "none",
              borderRadius: "var(--radius-md)", padding: "11px 14px", background: "var(--surface-card)",
              fontFamily: "var(--font-sans)", fontSize: 14, color: "var(--text-strong)",
            }}
          />
          <Button variant="primary" onClick={submit} disabled={!value.trim()}
            leadingIcon={<Icon name="plus" style={{ width: 15, height: 15 }} />}>
            添加
          </Button>
        </div>

        {/* status filter */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
          {FILTERS.map((f) => {
            const on = f.key === filter;
            return (
              <button key={f.key} data-testid={"workbench-task-filter-" + f.key} onClick={() => setFilter(f.key)}
                style={{
                  border: on ? "1px solid var(--brand)" : "1px solid var(--border-subtle)",
                  background: on ? "var(--brand)" : "var(--surface-card)",
                  color: on ? "#fff" : "var(--text-body)",
                  fontFamily: "var(--font-sans)", fontWeight: 600, fontSize: 12.5,
                  padding: "7px 13px", borderRadius: "var(--radius-pill)", cursor: "pointer",
                }}>
                {f.label}
              </button>
            );
          })}
        </div>

        {list.length === 0 ? (
          <div style={{ fontSize: 13.5, color: "var(--text-faint)", padding: "30px 0", lineHeight: 1.7 }}>
            这里还没有任务。新建一个，或回到工作台输入一个目标。
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }} data-testid="workbench-task-list">
            {list.map((t) => {
              const tone = STATUS_TONE[t.status] || STATUS_TONE.created;
              const next = NEXT_ACTION[t.status] && canTransition(t.status, NEXT_ACTION[t.status].to)
                ? NEXT_ACTION[t.status] : null;
              return (
                <div key={t.id} data-testid="workbench-task-item" style={{
                  background: "var(--surface-card)", border: "1px solid var(--border-subtle)",
                  borderRadius: "var(--radius-md)", padding: "13px 16px",
                  display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", minWidth: 0,
                }}>
                  <div style={{ minWidth: 0, flex: 1, cursor: onOpenTask ? "pointer" : "default" }}
                    onClick={() => onOpenTask && onOpenTask(t.id)}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-strong)", lineHeight: 1.5 }}>
                      {t.title}
                    </div>
                    <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 3 }}>
                      创建于 {fmtTime(t.createdAt)}
                      {t.steps && t.steps.length > 0 && <> · 步骤 {t.steps.length}</>}
                      {t.sources && t.sources.length > 0 && <> · 来源 {t.sources.length}</>}
                      {t.result && <> · 已有结果</>}
                    </div>
                  </div>
                  <span data-testid="workbench-task-status" style={{
                    flex: "none", fontSize: 11.5, fontWeight: 700, padding: "4px 10px",
                    borderRadius: "var(--radius-pill)", background: tone.bg, color: tone.color,
                  }}>
                    {STATUS_LABEL[t.status] || t.status}
                  </span>
                  {next && (
                    <button data-testid="workbench-task-next" onClick={(e) => { e.stopPropagation(); onStatusChange(t.id, next.to); }}
                      style={{
                        flex: "none", border: "1px solid var(--border-subtle)", background: "transparent",
                        color: "var(--text-body)", fontSize: 12, fontWeight: 600, cursor: "pointer",
                        padding: "6px 11px", borderRadius: "var(--radius-sm)", fontFamily: "var(--font-sans)",
                      }}>
                      {next.label}
                    </button>
                  )}
                  {onOpenTask && (
                    <button data-testid="workbench-task-open" onClick={(e) => { e.stopPropagation(); onOpenTask(t.id); }}
                      aria-label={"打开任务详情：" + t.title}
                      style={{
                        flex: "none", border: "none", background: "transparent", color: "var(--brand)",
                        fontSize: 12, fontWeight: 600, cursor: "pointer", padding: "6px 8px", fontFamily: "var(--font-sans)",
                        display: "inline-flex", alignItems: "center", gap: 4,
                      }}>
                      详情<Icon name="chevron-right" style={{ width: 13, height: 13 }} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
