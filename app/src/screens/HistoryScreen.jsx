// Gorgon Workbench — HistoryScreen (Phase 2: REAL Task timelines).
//
// Default view "最近活动": aggregates every task's timeline, sorted by
// timestamp, newest first (§19). The Phase-1 flat local log is still shown
// as a secondary section (cross-surface events like search/approvals that
// do not belong to a single task). No mock history data.

import React from "react";
import { STATUS_LABELS } from "../workbench/task-status-labels.js";
import { Icon } from "../components/Icon.jsx";

const EVENT_META = {
  task_created: { icon: "plus", label: "创建任务" },
  status_changed: { icon: "git-branch", label: "状态变更" },
  step_added: { icon: "list-plus", label: "添加步骤" },
  step_updated: { icon: "list-todo", label: "更新步骤" },
  source_added: { icon: "link", label: "添加来源" },
  result_saved: { icon: "file-check", label: "保存结果" },
  task_failed: { icon: "alert-triangle", label: "任务失败" },
};

const LOG_META = {
  task_create: { icon: "plus", label: "创建任务" },
  task_status: { icon: "list-todo", label: "任务状态" },
  run_search: { icon: "search", label: "运行搜索" },
  user_approve: { icon: "shield-check", label: "用户批准" },
  user_reject: { icon: "shield-alert", label: "用户拒绝" },
};

function fmtTime(iso) {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  } catch (e) { return ""; }
}

/** Aggregate: all task timeline events -> flat newest-first list (§19). */
export function collectRecentActivity(tasks) {
  const rows = [];
  for (const t of tasks || []) {
    if (!t || !Array.isArray(t.timeline)) continue;
    for (const ev of t.timeline) {
      if (!ev || typeof ev !== "object" || !ev.type) continue;
      rows.push({ kind: "timeline", taskId: t.id, taskTitle: t.title, taskStatus: t.status, ...ev });
    }
  }
  rows.sort((a, b) => String(b.timestamp || "").localeCompare(String(a.timestamp || "")));
  return rows;
}

export function HistoryScreen({ tasks, log, onOpenTask }) {
  const activity = React.useMemo(() => collectRecentActivity(tasks), [tasks]);
  const entries = (log && log.length > 0) ? log : [];

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }} data-gg-screen="workbench-history">
      <div style={{ padding: "28px 16px 40px", maxWidth: 860, margin: "0 auto", width: "100%" }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 24, color: "var(--text-strong)", margin: 0 }}>
          工作记录
        </h1>
        <p style={{ fontSize: 13, color: "var(--text-faint)", lineHeight: 1.7, margin: "8px 0 0" }}>
          最近活动读取每个任务的真实时间线（Task.timeline）。本地浏览器内数据，不含后端执行历史。
        </p>

        {/* A. aggregated task timelines */}
        <div style={{ marginTop: 18 }} data-testid="workbench-history-recent">
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-muted)", marginBottom: 9 }}>
            最近活动 ({activity.length})
          </div>
          {activity.length === 0 ? (
            <div style={{ fontSize: 13.5, color: "var(--text-faint)", padding: "14px 0", lineHeight: 1.7 }}>
              暂无任务活动。创建任务后，事件会出现在这里。
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }} data-testid="workbench-history-list">
              {activity.slice(0, 200).map((e, i) => {
                const meta = EVENT_META[e.type] || { icon: "info", label: "事件" };
                return (
                  <div key={(e.id || "") + "-" + i} data-testid="workbench-history-item"
                    onClick={() => onOpenTask && e.taskId && onOpenTask(e.taskId)}
                    style={{
                      display: "flex", alignItems: "center", gap: 12, padding: "11px 14px",
                      background: "var(--surface-card)", border: "1px solid var(--border-subtle)",
                      borderRadius: "var(--radius-md)", minWidth: 0,
                      cursor: onOpenTask && e.taskId ? "pointer" : "default",
                    }}>
                    <span style={{
                      flex: "none", width: 30, height: 30, borderRadius: "var(--radius-sm)",
                      background: "var(--bg-sunken)", display: "inline-flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <Icon name={meta.icon} style={{ width: 15, height: 15, color: "var(--text-muted)" }} />
                    </span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 13.5, color: "var(--text-strong)", fontWeight: 600, lineHeight: 1.5 }}>
                        {meta.label}
                      </div>
                      <div style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.55, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {e.taskTitle ? `「${e.taskTitle}」` : ""}{e.message || ""}
                      </div>
                    </div>
                    <span style={{ flex: "none", fontSize: 11.5, color: "var(--text-faint)", fontVariantNumeric: "tabular-nums" }}>
                      {fmtTime(e.timestamp)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* B. cross-surface local log (kept from Phase 1) */}
        {entries.length > 0 && (
          <div style={{ marginTop: 26 }} data-testid="workbench-history-log">
            <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-muted)", marginBottom: 9 }}>
              其他本地事件
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {entries.slice(0, 50).map((e, i) => {
                const meta = LOG_META[e.type] || { icon: "info", label: "事件" };
                return (
                  <div key={(e.at || "") + "-" + i} style={{
                    display: "flex", alignItems: "center", gap: 12, padding: "10px 13px",
                    background: "var(--bg-sunken)", borderRadius: "var(--radius-md)", minWidth: 0,
                  }}>
                    <span style={{ flex: "none", width: 28, height: 28, borderRadius: "var(--radius-sm)", background: "var(--surface-card)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                      <Icon name={meta.icon} style={{ width: 14, height: 14, color: "var(--text-faint)" }} />
                    </span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-body)" }}>{meta.label}</span>
                      {e.text && <span style={{ fontSize: 12, color: "var(--text-muted)" }}> · {e.text}</span>}
                    </div>
                    <span style={{ flex: "none", fontSize: 11.5, color: "var(--text-faint)" }}>{fmtTime(e.at)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
