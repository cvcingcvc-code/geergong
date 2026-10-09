// Gorgon Workbench — ReviewCenterScreen (Phase 6: REAL Proposal model).
//
// THREE card sources, in priority order:
//   1. REAL Proposals (Phase 6) — persisted, versioned, with a real state
//      machine (PROPOSED → APPROVED/EDITED/REJECTED → EXECUTED/FAILED).
//      These lead the page and support 批准 / 修改 / 拒绝 for real.
//   2. REAL tasks with status === "review_required", resumed through the Task
//      State Machine (Phase 2 contract, unchanged).
//   3. The Phase-1 DEMO / PREVIEW cards, kept last and still labelled DEMO so
//      nothing is ever passed off as a real reviewed action.

import React from "react";
import * as WB from "../store/workbench-store.js";
import { canTransition } from "../workbench/task-model.js";
import { PROPOSAL_STATUS, ACTION_KINDS } from "../workbench/proposal-model.js";
import { Icon } from "../components/Icon.jsx";

const DECISION_LABEL = {
  pending: "待你确认",
  approved: "已批准（本地演示）",
  rejected: "已拒绝（本地演示）",
  edited: "已修改（本地演示）",
};

const PROPOSAL_STATUS_LABEL = {
  [PROPOSAL_STATUS.PROPOSED]: "待你确认",
  [PROPOSAL_STATUS.APPROVED]: "已批准",
  [PROPOSAL_STATUS.EDITED]: "已修改，待确认",
  [PROPOSAL_STATUS.REJECTED]: "已拒绝",
  [PROPOSAL_STATUS.EXECUTED]: "已执行",
  [PROPOSAL_STATUS.FAILED]: "执行失败",
};

const ACTION_KIND_LABEL = {
  [ACTION_KINDS.READ_ONLY]: "只读建议",
  [ACTION_KINDS.CREATE_REMINDER]: "创建后续任务",
  [ACTION_KINDS.CREATE_CALENDAR]: "创建日历事件",
  [ACTION_KINDS.SEND_EMAIL]: "发送邮件",
  [ACTION_KINDS.WRITE_FILE]: "修改文件",
  [ACTION_KINDS.EXTERNAL_SUBMIT]: "外部提交",
};

function fmtTime(iso) {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  } catch (e) { return ""; }
}

export function ReviewCenterScreen({ cards, onDecide, reviewTasks, onResumeTask, proposals, onProposal }) {
  const pending = cards.filter((c) => c.decision === "pending");
  const decided = cards.filter((c) => c.decision !== "pending");
  const waiting = (reviewTasks || []).filter((t) => t.status === "review_required");
  const allProposals = proposals || [];
  const openProposals = allProposals.filter(
    (p) => p.status === PROPOSAL_STATUS.PROPOSED || p.status === PROPOSAL_STATUS.EDITED,
  );
  const closedProposals = allProposals.filter(
    (p) => p.status !== PROPOSAL_STATUS.PROPOSED && p.status !== PROPOSAL_STATUS.EDITED,
  );

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }} data-gg-screen="workbench-review">
      <div style={{ padding: "28px 16px 40px", maxWidth: 860, margin: "0 auto", width: "100%" }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 24, color: "var(--text-strong)", margin: 0 }}>
          审核中心
        </h1>
        <p style={{ fontSize: 13.5, color: "var(--text-muted)", lineHeight: 1.7, margin: "10px 0 0", maxWidth: 640 }}>
          任何会产生外部副作用的动作，都会先生成一条真实建议（Proposal），等待你批准后才执行。
          只读能力（搜索 / 总结 / 提取 / 规划 / 写作）默认不需要审核。
        </p>

        {/* ── A. REAL Proposals (Phase 6) ─────────────────────────── */}
        <div style={{ marginTop: 22 }} data-testid="workbench-proposals">
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-muted)", marginBottom: 10 }}>
            待你决策的建议 ({openProposals.length})
          </div>
          {openProposals.length === 0 ? (
            <div style={{ fontSize: 13.5, color: "var(--text-faint)", padding: "14px 0" }} data-testid="workbench-proposals-empty">
              暂无待决策的建议。产生外部副作用的动作会在这里等待你的确认。
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {openProposals.map((p) => (
                <div key={p.id} data-testid="workbench-proposal" style={{
                  background: "var(--surface-card)", border: "1px solid var(--brand)",
                  borderRadius: "var(--radius-lg)", padding: "16px 18px", minWidth: 0,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap", marginBottom: 8 }}>
                    <span style={{
                      fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", padding: "3px 9px",
                      borderRadius: "var(--radius-pill)", background: "var(--brand-soft, var(--warning-soft))",
                      color: "var(--brand-ink, #9A6300)",
                    }}>
                      {ACTION_KIND_LABEL[p.kind] || p.kind}
                    </span>
                    <span style={{ fontSize: 12, color: "var(--text-faint)" }}>
                      {PROPOSAL_STATUS_LABEL[p.status] || p.status} · {fmtTime(p.history?.[p.history.length - 1]?.at)}
                    </span>
                  </div>
                  <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 16, color: "var(--text-strong)", lineHeight: 1.5 }}>
                    {p.title}
                  </div>
                  {p.rationale && (
                    <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.7, marginTop: 7 }}>
                      {p.rationale}
                    </div>
                  )}
                  {p.editedPayload && (
                    <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 8, lineHeight: 1.6 }} data-testid="workbench-proposal-edited">
                      已修改为：{p.editedPayload.goal || p.editedPayload.title || JSON.stringify(p.editedPayload)}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 9, marginTop: 14, flexWrap: "wrap" }}>
                    <button data-testid="workbench-proposal-approve" onClick={() => onProposal && onProposal(p.id, "approve")}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 6, border: "none", cursor: "pointer",
                        background: "var(--accent)", color: "#06241B", fontWeight: 700, fontSize: 13,
                        padding: "9px 16px", borderRadius: "var(--radius-sm)", fontFamily: "var(--font-sans)",
                      }}>
                      <Icon name="check" style={{ width: 14, height: 14 }} />批准
                    </button>
                    <button data-testid="workbench-proposal-reject" onClick={() => onProposal && onProposal(p.id, "reject")}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer",
                        border: "1px solid var(--border-subtle)", background: "var(--surface-card)",
                        color: "var(--text-body)", fontWeight: 600, fontSize: 13, padding: "9px 16px",
                        borderRadius: "var(--radius-sm)", fontFamily: "var(--font-sans)",
                      }}>
                      拒绝
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── B. decided proposals (audit trail) ───────────────────── */}
        {closedProposals.length > 0 && (
          <div style={{ marginTop: 22 }} data-testid="workbench-proposals-history">
            <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-muted)", marginBottom: 10 }}>
              已处理建议 ({closedProposals.length})
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {closedProposals.map((p) => (
                <div key={p.id} data-testid="workbench-proposal-history-item" style={{
                  background: "var(--surface-card)", border: "1px solid var(--border-subtle)",
                  borderRadius: "var(--radius-md, var(--radius-lg))", padding: "12px 15px", minWidth: 0,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-strong)" }}>
                      {PROPOSAL_STATUS_LABEL[p.status] || p.status}
                    </span>
                    <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>{p.title}</span>
                  </div>
                  {p.history?.[p.history.length - 1]?.note && (
                    <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 5, lineHeight: 1.6 }}>
                      {p.history[p.history.length - 1].note}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* A. real review_required tasks */}
        <div style={{ marginTop: 20 }} data-testid="workbench-review-tasks">
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-muted)", marginBottom: 10 }}>
            待确认任务 ({waiting.length})
          </div>
          {waiting.length === 0 ? (
            <div style={{ fontSize: 13.5, color: "var(--text-faint)", padding: "14px 0" }}>
              暂无等待确认的任务。
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {waiting.map((t) => (
                <div key={t.id} data-testid="workbench-review-task" style={{
                  background: "var(--surface-card)", border: "1px solid var(--brand)",
                  borderRadius: "var(--radius-lg)", padding: "16px 18px", minWidth: 0,
                }}>
                  <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 16, color: "var(--text-strong)", lineHeight: 1.5 }}>
                    {t.title}
                  </div>
                  <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.7, marginTop: 7 }}>
                    {t.goal}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 8 }}>
                    当前等待用户确认 · 创建于 {fmtTime(t.createdAt)}
                  </div>
                  {canTransition(t.status, "running") && onResumeTask && (
                    <div style={{ marginTop: 14 }}>
                      <button data-testid="workbench-review-resume" onClick={() => onResumeTask(t.id)}
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 6, border: "none", cursor: "pointer",
                          background: "var(--brand)", color: "#fff", fontWeight: 700, fontSize: 13,
                          padding: "9px 16px", borderRadius: "var(--radius-sm)", fontFamily: "var(--font-sans)",
                        }}>
                        <Icon name="play" style={{ width: 14, height: 14 }} />继续任务
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* pending demo cards */}
        <div style={{ marginTop: 24 }} data-testid="workbench-review-pending">
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-muted)", marginBottom: 10 }}>
            待确认演示卡片 ({pending.length})
          </div>
          {pending.length === 0 ? (
            <div style={{ fontSize: 13.5, color: "var(--text-faint)", padding: "14px 0" }}>
              暂无待确认的演示操作。
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

        {/* decided demo history */}
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
