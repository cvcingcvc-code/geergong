import React from "react";

const REASONS = [
  { key: "time", label: "时间/地点有误", icon: "calendar-x" },
  { key: "cancelled", label: "活动已取消", icon: "x-circle" },
  { key: "price", label: "票价不符", icon: "ticket" },
  { key: "duplicate", label: "重复活动", icon: "copy" },
  { key: "spam", label: "虚假/广告", icon: "shield-alert" },
  { key: "other", label: "其他问题", icon: "more-horizontal" },
];

/**
 * Report-an-error bottom sheet. Lets a student flag inaccurate listing info —
 * the community signal that keeps aggregated data honest. Render conditionally
 * (when `open`); it includes its own scrim.
 */
export function ReportSheet({ open = false, onClose, onSubmit, style = {}, ...rest }) {
  const [picked, setPicked] = React.useState(null);
  const [done, setDone] = React.useState(false);
  if (!open) return null;

  const submit = () => {
    setDone(true);
    onSubmit && onSubmit(picked);
    setTimeout(() => { setDone(false); setPicked(null); onClose && onClose(); }, 1400);
  };

  return (
    <div
      onClick={onClose}
      style={{ position: "absolute", inset: 0, zIndex: "var(--z-modal)", background: "rgba(12,13,18,0.45)", display: "flex", alignItems: "flex-end", backdropFilter: "blur(2px)" }}
      {...rest}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", background: "var(--surface-card)", borderRadius: "var(--radius-2xl) var(--radius-2xl) 0 0", padding: "12px 20px 26px", boxShadow: "0 -8px 30px rgba(28,20,78,0.18)", ...style }}
      >
        <div style={{ width: 40, height: 5, borderRadius: 3, background: "var(--slate-300)", margin: "0 auto 16px" }} />

        {done ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "24px 0 12px", textAlign: "center" }}>
            <span style={{ width: 64, height: 64, borderRadius: "50%", background: "var(--accent-soft)", display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
              <i data-lucide="check" style={{ width: 32, height: 32, color: "var(--accent-strong)" }} />
            </span>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "var(--text-lg)", color: "var(--text-strong)" }}>谢谢你的反馈</div>
            <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", marginTop: 4 }}>我们会尽快核实这条信息。</div>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
              <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "var(--text-xl)", color: "var(--text-strong)" }}>这条信息有误?</h3>
              <button onClick={onClose} style={{ border: "none", background: "var(--bg-sunken)", width: 34, height: 34, borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                <i data-lucide="x" style={{ width: 18, height: 18, color: "var(--text-muted)" }} />
              </button>
            </div>
            <p style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", marginBottom: 16 }}>帮我们一起让周末信息更靠谱。</p>

            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 18 }}>
              {REASONS.map((r) => {
                const on = picked === r.key;
                return (
                  <button
                    key={r.key}
                    onClick={() => setPicked(r.key)}
                    style={{
                      display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left",
                      border: on ? "1.5px solid var(--brand)" : "1px solid var(--border-subtle)",
                      background: on ? "var(--brand-soft)" : "var(--surface-card)",
                      borderRadius: "var(--radius-md)", padding: "13px 14px", cursor: "pointer",
                      transition: "all var(--dur-fast) var(--ease-out)",
                    }}
                  >
                    <span style={{ width: 36, height: 36, borderRadius: "var(--radius-sm)", background: on ? "var(--surface-card)" : "var(--bg-sunken)", display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                      <i data-lucide={r.icon} style={{ width: 18, height: 18, color: on ? "var(--brand)" : "var(--text-muted)" }} />
                    </span>
                    <span style={{ flex: 1, fontSize: "var(--text-base)", fontWeight: "var(--weight-semibold)", color: "var(--text-strong)" }}>{r.label}</span>
                    {on && <i data-lucide="check" style={{ width: 18, height: 18, color: "var(--brand)" }} />}
                  </button>
                );
              })}
            </div>

            <button
              disabled={!picked}
              onClick={submit}
              style={{
                width: "100%", border: "none", borderRadius: "var(--radius-md)", padding: "15px",
                fontFamily: "var(--font-sans)", fontWeight: "var(--weight-semibold)", fontSize: "var(--text-md)",
                background: "var(--brand)", color: "#fff", cursor: picked ? "pointer" : "not-allowed",
                opacity: picked ? 1 : 0.45, boxShadow: picked ? "var(--shadow-brand)" : "none",
              }}
            >
              提交反馈
            </button>
          </>
        )}
      </div>
    </div>
  );
}
