// Gorgon Workbench — TasksScreen (Phase 1: UI + minimal localStorage).
//
// Lists local tasks with title / status / created time / source. Status is
// the Phase-1 UI vocabulary (draft / ready / completed) — NOT the final
// Task State Machine, which is Phase 2. No engine, no AI, no backend.

import React from "react";
import { Button } from "../lib/ds.js";
import * as WB from "../store/workbench-store.js";
import { Icon } from "../components/Icon.jsx";

const STATUS_LABEL = { draft: "草稿", ready: "等待执行", completed: "已完成" };
const STATUS_TONE = {
  draft: { color: "var(--text-muted)", bg: "var(--bg-sunken)" },
  ready: { color: "var(--brand)", bg: "var(--brand-soft)" },
  completed: { color: "var(--accent-strong, #047857)", bg: "var(--accent-soft)" },
};

const NEXT_ACTION = {
  draft: { label: "标记为等待执行", to: WB.TASK_STATUS.READY },
  ready: { label: "标记为已完成", to: WB.TASK_STATUS.COMPLETED },
  completed: { label: "重新打开", to: WB.TASK_STATUS.DRAFT },
};

function fmtTime(iso) {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  } catch (e) { return ""; }
}

export function TasksScreen({ tasks, onStatusChange, onAddTask }) {
  const [value, setValue] = React.useState("");
  const [filter, setFilter] = React.useState("all");

  const list = tasks.filter((t) => filter === "all" || t.status === filter);

  const submit = () => {
    const t = value.trim();
    if (!t) return;
    onAddTask(t);
    setValue("");
  };

  const filters = [
    { key: "all", label: "全部" },
    { key: "draft", label: "草稿" },
    { key: "ready", label: "等待执行" },
    { key: "completed", label: "已完成" },
  ];

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }} data-gg-screen="workbench-tasks">
      <div style={{ padding: "28px 16px 40px", maxWidth: 860, margin: "0 auto", width: "100%" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 24, color: "var(--text-strong)", margin: 0 }}>
            我的任务
          </h1>
          <span style={{ fontSize: 12, color: "var(--text-faint)" }}>
            本地任务数据 · 任务引擎将在下一阶段接入
          </span>
        </div>

        {/* add form */}
        <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
          <input
            aria-label="新建任务标题"
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
          {filters.map((f) => {
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
              const tone = STATUS_TONE[t.status] || STATUS_TONE.draft;
              const next = NEXT_ACTION[t.status];
              return (
                <div key={t.id} data-testid="workbench-task-item" style={{
                  background: "var(--surface-card)", border: "1px solid var(--border-subtle)",
                  borderRadius: "var(--radius-md)", padding: "13px 16px",
                  display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", minWidth: 0,
                }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-strong)", lineHeight: 1.5 }}>
                      {t.title}
                    </div>
                    <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 3 }}>
                      创建于 {fmtTime(t.createdAt)} · 来源：{t.source}
                    </div>
                  </div>
                  <span data-testid="workbench-task-status" style={{
                    flex: "none", fontSize: 11.5, fontWeight: 700, padding: "4px 10px",
                    borderRadius: "var(--radius-pill)", background: tone.bg, color: tone.color,
                  }}>
                    {STATUS_LABEL[t.status] || t.status}
                  </span>
                  {next && (
                    <button data-testid="workbench-task-next" onClick={() => onStatusChange(t.id, next.to)}
                      style={{
                        flex: "none", border: "1px solid var(--border-subtle)", background: "transparent",
                        color: "var(--text-body)", fontSize: 12, fontWeight: 600, cursor: "pointer",
                        padding: "6px 11px", borderRadius: "var(--radius-sm)", fontFamily: "var(--font-sans)",
                      }}>
                      {next.label}
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
