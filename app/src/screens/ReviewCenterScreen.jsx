// Gorgon Workbench — ReviewCenterScreen (Phase 1: UI Shell ONLY).
//
// Shows, with a clearly-marked DEMO / PREVIEW card, how future AI or
// automated actions will queue here for human confirmation BEFORE they
// really run. Approve / edit / reject buttons toggle LOCAL UI STATE ONLY —
// the real Python Human Review protocol migrates in Phase 6. Nothing here
// calls a backend or executes anything.

import React from "react";
import * as WB from "../store/workbench-store.js";
import { Icon } from "../components/Icon.jsx";

const DECISION_LABEL = {
  pending: "待你确认",
  approved: "已批准（本地演示）",
  rejected: "已拒绝（本地演示）",
  edited: "已修改（本地演示）",
};

function fmtTime(iso) {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  } catch (e) { return ""; }
}

export function ReviewCenterScreen({ cards, onDecide }) {
  const pending = cards.filter((c) => c.decision === "pending");
  const decided = cards.filter((c) => c.decision !== "pending");

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }} data-gg-screen="workbench-review">
      <div style={{ padding: "28px 16px 40px", maxWidth: 860, margin: "0 auto", width: "100%" }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 24, color: "var(--text-strong)", margin: 0 }}>
          审核中心
        </h1>
        <p style={{ fontSize: 13.5, color: "var(--text-muted)", lineHeight: 1.7, margin: "10px 0 0", maxWidth: 640 }}>
          未来 AI 或自动化操作在真正执行之前，会先进入这里等待你的确认。
          当前为 Phase 1 界面外壳：卡片与按钮只切换本地状态，不连接任何后端审核协议。
        </p>

        {/* pending cards */}
        <div style={{ marginTop: 20 }} data-testid="workbench-review-pending">
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-muted)", marginBottom: 10 }}>
            待确认 ({pending.length})
          </div>
          {pending.length === 0 ? (
            <div style={{ fontSize: 13.5, color: "var(--text-faint)", padding: "16px 0" }}>
              暂无待确认的操作。
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {pending.map((c) => (
                <div key={c.id} data-testid="workbench-review-card" style={{
                  background: "var(--surface-card)", border: "1px dashed var(--border-strong, var(--border-subtle))",
                  borderRadius: "var(--radius-lg)", padding: "16px 18px", minWidth: 0,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap", marginBottom: 8 }}>
                    <span style={{
                      fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", padding: "3px 9px",
                      borderRadius: "var(--radius-pill)", background: "var(--warning-soft)", color: "#9A6300",
                    }}>
                      DEMO / PREVIEW
                    </span>
                    <span style={{ fontSize: 12, color: "var(--text-faint)" }}>演示卡片 · {fmtTime(c.createdAt)}</span>
                  </div>
                  <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 16, color: "var(--text-strong)", lineHeight: 1.5 }}>
                    {c.title}
                  </div>
                  {c.detail && (
                    <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.7, marginTop: 7 }}>
                      {c.detail}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 9, marginTop: 14, flexWrap: "wrap" }}>
                    <button data-testid="workbench-review-approve" onClick={() => onDecide(c.id, "approved")}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 6, border: "none", cursor: "pointer",
                        background: "var(--accent)", color: "#06241B", fontWeight: 700, fontSize: 13,
                        padding: "9px 16px", borderRadius: "var(--radius-sm)", fontFamily: "var(--font-sans)",
                      }}>
                      <Icon name="check" style={{ width: 14, height: 14 }} />批准
                    </button>
                    <button data-testid="workbench-review-edit" onClick={() => onDecide(c.id, "edited")}
                      style={{
                        border: "1px solid var(--border-subtle)", background: "var(--surface-card)",
                        color: "var(--text-body)", fontWeight: 600, fontSize: 13, padding: "9px 16px",
                        borderRadius: "var(--radius-sm)", cursor: "pointer", fontFamily: "var(--font-sans)",
                      }}>
                      修改
                    </button>
                    <button data-testid="workbench-review-reject" onClick={() => onDecide(c.id, "rejected")}
                      style={{
                        border: "1px solid var(--danger-soft)", background: "transparent",
                        color: "var(--danger)", fontWeight: 600, fontSize: 13, padding: "9px 16px",
                        borderRadius: "var(--radius-sm)", cursor: "pointer", fontFamily: "var(--font-sans)",
                      }}>
                      拒绝
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* decided history */}
        {decided.length > 0 && (
          <div style={{ marginTop: 24 }} data-testid="workbench-review-decided">
            <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-muted)", marginBottom: 10 }}>
              已处理
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {decided.map((c) => (
                <div key={c.id} style={{
                  display: "flex", alignItems: "center", gap: 12, justifyContent: "space-between",
                  padding: "11px 14px", background: "var(--bg-sunken)", borderRadius: "var(--radius-md)", minWidth: 0,
                }}>
                  <span style={{ fontSize: 13, color: "var(--text-body)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {c.title}
                  </span>
                  <span style={{ flex: "none", fontSize: 12, fontWeight: 700, color: "var(--text-muted)" }}>
                    {DECISION_LABEL[c.decision] || c.decision}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
