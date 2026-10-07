// Gorgon Workbench — SettingsScreen (Phase 1 shell only).
//
// Shows application info, version, backend API address and run mode.
// Truthfully displays "AI Provider: Not configured". Deliberately NO model
// key inputs and NO provider integration (OpenAI / DeepSeek / Claude /
// Gemini) — the model layer is Phase 4.

import React from "react";
import { Icon } from "../components/Icon.jsx";

// Single source for the displayed backend address: the API layer already
// owns the real URL resolution; the shell only mirrors it.
function backendLabel() {
  try {
    const env = (typeof import.meta !== "undefined" && import.meta.env) || {};
    return env.VITE_API_BASE_URL || "/api（同源代理）";
  } catch (e) {
    return "/api（同源代理）";
  }
}

export function SettingsScreen() {
  const rows = [
    { k: "应用", v: "Gorgon Workbench（戈尔贡智能工作台）" },
    { k: "版本", v: "Phase 1 · Workbench Shell" },
    { k: "后端 API 地址", v: backendLabel() },
    { k: "运行模式", v: "本地演示（浏览器内运行，无后端任务引擎）" },
    { k: "AI Provider", v: "Not configured（将在 Phase 4 接入）", muted: true },
    { k: "任务引擎", v: "Not connected（将在 Phase 2 接入）", muted: true },
  ];

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }} data-gg-screen="workbench-settings">
      <div style={{ padding: "28px 16px 40px", maxWidth: 860, margin: "0 auto", width: "100%" }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 24, color: "var(--text-strong)", margin: 0 }}>
          模型与设置
        </h1>
        <p style={{ fontSize: 13, color: "var(--text-faint)", lineHeight: 1.7, margin: "8px 0 18px" }}>
          当前阶段仅展示应用信息。模型接入与密钥配置将在后续阶段提供。
        </p>

        <div style={{
          background: "var(--surface-card)", border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-md)", padding: "4px 16px", maxWidth: 640,
        }} data-testid="workbench-settings-list">
          {rows.map((r, i) => (
            <div key={r.k} data-testid={"workbench-setting-" + (r.v.indexOf("Not ") === 0 ? "not-ready" : "info")} style={{
              display: "flex", alignItems: "baseline", gap: 14, padding: "12px 0",
              borderTop: i === 0 ? "none" : "1px solid var(--border-subtle)",
            }}>
              <span style={{ flex: "none", width: 110, fontSize: 12.5, fontWeight: 700, color: "var(--text-muted)" }}>
                {r.k}
              </span>
              <span style={{
                minWidth: 0, fontSize: 13, lineHeight: 1.6,
                color: r.muted ? "var(--text-faint)" : "var(--text-strong)", fontWeight: r.muted ? 500 : 600,
              }}>
                {r.v}
              </span>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 16, maxWidth: 640, display: "flex", gap: 9, alignItems: "flex-start", background: "var(--bg-sunken)", borderRadius: "var(--radius-md)", padding: "11px 14px" }}>
          <Icon name="info" style={{ width: 15, height: 15, color: "var(--text-faint)", flex: "none", marginTop: 2 }} />
          <span style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.65 }}>
            出于安全考虑，任何模型密钥都不会在浏览器中存储或输入。模型层的接入方式将在 Phase 4 设计并另行说明。
          </span>
        </div>
      </div>
    </div>
  );
}
