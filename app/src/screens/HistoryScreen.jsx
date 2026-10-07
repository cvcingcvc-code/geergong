// Gorgon Workbench — HistoryScreen (Phase 1: local activity log only).
//
// A flat, newest-first list of what happened in this browser: task
// created, search run (placeholder for Phase 1), user approved, task done.
// Deliberately NO event sourcing — this is a readable local trail, capped
// at the most recent 100 entries by the store.

import React from "react";
import { getLog } from "../store/workbench-store.js";
import { Icon } from "../components/Icon.jsx";

const TYPE_ICON = {
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

export function HistoryScreen({ log }) {
  const entries = log.length > 0 ? log : getLog();

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }} data-gg-screen="workbench-history">
      <div style={{ padding: "28px 16px 40px", maxWidth: 860, margin: "0 auto", width: "100%" }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 24, color: "var(--text-strong)", margin: 0 }}>
          工作记录
        </h1>
        <p style={{ fontSize: 13, color: "var(--text-faint)", lineHeight: 1.7, margin: "8px 0 0" }}>
          本地浏览器内的活动记录（最近 100 条）。不包含后端执行历史。
        </p>

        {entries.length === 0 ? (
          <div style={{ fontSize: 13.5, color: "var(--text-faint)", padding: "30px 0", lineHeight: 1.7 }}>
            暂无记录。创建任务、使用搜索或处理审核卡片后，活动会出现在这里。
          </div>
        ) : (
          <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 6 }} data-testid="workbench-history-list">
            {entries.map((e, i) => {
              const meta = TYPE_ICON[e.type] || { icon: "info", label: "事件" };
              return (
                <div key={(e.at || "") + "-" + i} data-testid="workbench-history-item" style={{
                  display: "flex", alignItems: "center", gap: 12, padding: "11px 14px",
                  background: "var(--surface-card)", border: "1px solid var(--border-subtle)",
                  borderRadius: "var(--radius-md)", minWidth: 0,
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
                    {e.text && (
                      <div style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.55, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {e.text}
                      </div>
                    )}
                  </div>
                  <span style={{ flex: "none", fontSize: 11.5, color: "var(--text-faint)", fontVariantNumeric: "tabular-nums" }}>
                    {fmtTime(e.at)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
