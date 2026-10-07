// Gorgon Workbench — WorkbenchHome (Phase 1 shell screen).
//
// The new desktop-first visual home of the product. Phase 1 scope:
//   * hero + main task input: creating a task stores it LOCALLY (no LLM,
//     no task engine) and the UI says so honestly.
//   * up to 4 quick actions, all REAL: three prefill the input, 智能搜索
//     jumps to the existing natural-language search.
//   * recent tasks read from the local workbench store, clearly labelled
//     as local data — never presented as backend-executed.
//   * a truthful system status strip: the search engine is the real one,
//     the AI engine is NOT connected in Phase 1.
//
// The legacy Discover screen stays the boot tab for the E2E contract; this
// screen is reached through the Workbench navigation.

import React from "react";
import { Button } from "../lib/ds.js";
import { useResponsive } from "../lib/useResponsive.js";
import * as WB from "../store/workbench-store.js";
import { Icon } from "../components/Icon.jsx";

const QUICK_ACTIONS = [
  { key: "opportunity", label: "寻找行业机会", text: "帮我寻找本周值得参加的行业机会活动" },
  { key: "organize", label: "整理资料", text: "帮我整理一份比赛报名所需的资料清单" },
  { key: "plan", label: "制定工作计划", text: "帮我制定一份本周的工作计划" },
  { key: "search", label: "智能搜索", gotoSearch: true },
];

const STATUS_ITEMS = [
  { key: "engine", label: "搜索引擎", value: "Ready", ok: true },
  { key: "rules", label: "本地规则", value: "Ready", ok: true },
  { key: "ai", label: "AI Engine", value: "Not connected", ok: false },
  { key: "review", label: "Human Review", value: "Ready / Planned", ok: true },
];

function fmtTime(iso) {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  } catch (e) { return ""; }
}

const STATUS_LABEL = { draft: "草稿", ready: "等待执行", completed: "已完成" };

export function WorkbenchHome({ tasks, onAddTask, onGoSearch, onGoTasks }) {
  const { isMobile } = useResponsive();
  const [value, setValue] = React.useState("");
  const [notice, setNotice] = React.useState("");
  const inputRef = React.useRef(null);

  const recent = tasks.slice(0, 3);

  const submit = () => {
    const t = value.trim();
    if (!t) return;
    onAddTask(t);
    setValue("");
    setNotice("任务已保存到本地。任务引擎将在下一阶段接入，当前不会自动执行。");
  };

  const quick = (a) => {
    if (a.gotoSearch) { onGoSearch(); return; }
    setValue(a.text);
    if (inputRef.current && inputRef.current.focus) inputRef.current.focus();
  };

  const gutter = "var(--gg-gutter)";

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }} data-gg-screen="workbench-home">
      <div style={{ padding: isMobile ? "22px 16px 0" : "34px 32px 0", maxWidth: 860, margin: "0 auto", width: "100%" }}>
        {/* A. Top */}
        <div data-testid="workbench-hero">
          <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
            <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 12, letterSpacing: "0.1em", color: "var(--brand)", textTransform: "uppercase" }}>
              Gorgon Workbench
            </span>
          </div>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: isMobile ? 25 : 31, color: "var(--text-strong)", letterSpacing: "-0.02em", margin: "8px 0 0", lineHeight: 1.3 }}>
            把目标交给工作台，<br />把决定留给你。
          </h1>
        </div>

        {/* B. Main task input — the visual core of the home */}
        <div style={{ marginTop: 22 }} data-testid="workbench-task-input">
          <div style={{
            background: "var(--surface-card)", border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-xl)", boxShadow: "var(--shadow-md)", padding: "18px 20px 14px",
          }}>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15.5, color: "var(--text-strong)", marginBottom: 10 }}>
              今天想完成什么？
            </div>
            <textarea
              aria-label="描述一个目标"
              placeholder={"描述一个目标，例如：\n帮我寻找本周值得参加的 AI 活动……"}
              rows={isMobile ? 2 : 3}
              value={value}
              ref={inputRef}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
              style={{
                width: "100%", border: "none", outline: "none", resize: "none",
                background: "var(--bg-sunken)", borderRadius: "var(--radius-md)",
                padding: "12px 14px", fontFamily: "var(--font-sans)", fontSize: 14.5,
                lineHeight: 1.6, color: "var(--text-strong)", boxSizing: "border-box",
              }}
            />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", marginTop: 10, gap: 10 }}>
              <span style={{ fontSize: 11.5, color: "var(--text-faint)", marginRight: "auto" }}>
                Enter 提交 · Shift + Enter 换行
              </span>
              <Button variant="primary" onClick={submit} disabled={!value.trim()}
                leadingIcon={<Icon name="arrow-right" style={{ width: 16, height: 16 }} />}>
                开始任务
              </Button>
            </div>
          </div>
          {notice && (
            <div data-testid="workbench-task-notice" role="status"
              style={{ marginTop: 10, fontSize: 12.5, color: "var(--text-muted)", background: "var(--bg-sunken)", borderRadius: "var(--radius-md)", padding: "9px 13px", lineHeight: 1.6 }}>
              {notice}
            </div>
          )}
        </div>

        {/* C. Quick actions — few and real */}
        <div style={{ marginTop: 18 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-muted)", marginBottom: 9 }}>快捷任务</div>
          <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
            {QUICK_ACTIONS.map((a) => (
              <button key={a.key} data-testid={"workbench-quick-" + a.key} onClick={() => quick(a)}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 7,
                  border: "1px solid var(--border-subtle)", background: "var(--surface-card)",
                  color: "var(--text-body)", fontFamily: "var(--font-sans)", fontWeight: 600,
                  fontSize: 13, padding: "9px 15px", borderRadius: "var(--radius-pill)", cursor: "pointer",
                  transition: "all var(--dur-fast) var(--ease-out)",
                }}>
                <Icon name={a.gotoSearch ? "sparkles" : "plus"} style={{ width: 14, height: 14, color: a.gotoSearch ? "var(--brand)" : "var(--text-faint)" }} />
                {a.label}
              </button>
            ))}
          </div>
        </div>

        {/* D. Recent tasks — local data, honestly labelled */}
        <div style={{ marginTop: 26 }} data-testid="workbench-recent">
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 9 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-muted)" }}>最近任务</div>
            <button onClick={onGoTasks} style={{ border: "none", background: "transparent", color: "var(--brand)", fontSize: 12.5, fontWeight: 600, cursor: "pointer", padding: 0 }}>
              查看全部
            </button>
          </div>
          {recent.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--text-faint)", padding: "14px 0", lineHeight: 1.6 }}>
              还没有任务。上面输入一个目标，或点一个快捷任务开始。
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {recent.map((t) => (
                <div key={t.id} style={{
                  display: "flex", alignItems: "center", gap: 12, padding: "11px 14px",
                  background: "var(--surface-card)", border: "1px solid var(--border-subtle)",
                  borderRadius: "var(--radius-md)", minWidth: 0,
                }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text-strong)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {t.title}
                    </div>
                    <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 2 }}>
                      {fmtTime(t.createdAt)} · 来源：{t.source} · 本地任务数据
                    </div>
                  </div>
                  <span style={{
                    flex: "none", fontSize: 11.5, fontWeight: 700,
                    color: t.status === "completed" ? "var(--accent-strong, #047857)" : t.status === "ready" ? "var(--brand)" : "var(--text-muted)",
                  }}>
                    {STATUS_LABEL[t.status] || t.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* E. Workbench status — must be truthful */}
        <div style={{ margin: "26px 0 34px" }} data-testid="workbench-status">
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-muted)", marginBottom: 9 }}>工作台状态</div>
          <div style={{
            background: "var(--surface-card)", border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-md)", padding: "4px 16px",
          }}>
            {STATUS_ITEMS.map((s, i) => (
              <div key={s.key} data-testid={"workbench-status-" + s.key} style={{
                display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
                padding: "11px 0", borderTop: i === 0 ? "none" : "1px solid var(--border-subtle)",
              }}>
                <span style={{ fontSize: 13, color: "var(--text-body)", fontWeight: 600 }}>{s.label}</span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 700, color: s.ok ? "var(--accent-strong, #047857)" : "var(--text-faint)" }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: s.ok ? "var(--accent)" : "var(--slate-400)" }} />
                  {s.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
