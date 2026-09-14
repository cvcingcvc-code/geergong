Bottom-sheet flow for reporting inaccurate listing info — the community signal that keeps aggregated data honest. Requires Lucide. Render inside a `position:relative` container.

```jsx
const [open, setOpen] = React.useState(false);
<ReportSheet open={open} onClose={() => setOpen(false)} onSubmit={(reason) => log(reason)} />
```

Reasons: 时间/地点有误 · 活动已取消 · 票价不符 · 重复活动 · 虚假/广告 · 其他. Shows a thank-you state, then auto-closes.
