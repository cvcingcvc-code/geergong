The signature Gorgon card — one weekend activity in the discover feed. Full-bleed cover (or category-tinted gradient), category dot + date/time, title, location/distance, price, and a sync toggle that pops to mint "已同步 ✓".

```jsx
<ActivityCard
  title="夜跑·苏州河滨"
  category="sport" date="周六 6.15" time="19:30"
  location="上海·普陀" distance="1.2km" price="免费"
  tags={["新手友好","5km"]} synced={s} onSync={setS} hot
/>
<ActivityCard compact title="独立音乐现场" category="music" />
```

Requires Lucide on the page. Use `compact` for list rows (My Weekend, search results), default vertical card for the feed.
