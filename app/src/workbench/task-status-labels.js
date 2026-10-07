// Gorgon Workbench — shared status labels (Phase 2).
// Single small module so every screen renders the same Chinese labels for
// the formal state-machine vocabulary, without importing React code.

export const STATUS_LABELS = {
  created: "已创建",
  planning: "规划中",
  ready: "等待执行",
  running: "执行中",
  review_required: "待审核",
  completed: "已完成",
  failed: "失败",
};
