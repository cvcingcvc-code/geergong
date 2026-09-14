Route planner block for an activity detail — from→venue summary, transit options (地铁/公交/骑行/步行/驾车), and a "用导航软件打开" button. Requires Lucide.

```jsx
<RoutePlanner
  from="我的位置 · 杨浦"
  venue="苏州河梦清园入口"
  distance="2.0km"
  transit={[
    { mode: "metro", line: "地铁 13 号线", detail: "江宁路站 2 号口步行 5 分钟", time: "18 分钟", cost: "¥4", recommended: true },
    { mode: "bike", line: "共享单车", detail: "沿苏州河骑行", time: "9 分钟" },
    { mode: "walk", line: "步行", detail: "1.2km", time: "16 分钟" },
  ]}
  onNavigate={() => setSheetOpen(true)}
/>
```

The first option (or any with `recommended:true`) is highlighted. Pair `onNavigate` with `MapAppSheet` to deep-link into the user's map app.
