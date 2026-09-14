Pill segmented control — single-select for time/view filters (本周末 / 下周末 / 全部).

```jsx
<SegmentedControl options={["本周末","下周末","全部"]} value={tab} onChange={setTab} />
```

Options can be strings or `{value,label}`. Controlled via `value` + `onChange`.
