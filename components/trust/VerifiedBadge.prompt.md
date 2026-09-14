Trust-level badge for a host or activity listing. Requires Lucide on the page.

```jsx
<VerifiedBadge level="verified" />        {/* 已认证 — mint */}
<VerifiedBadge level="official" />        {/* 官方 — indigo */}
<VerifiedBadge level="aggregated" size="sm" />  {/* 聚合来源 — grey */}
<VerifiedBadge level="unverified" />      {/* 待核实 — amber */}
```

Levels map to the brand semantic colors: verified→mint (reward), unverified→amber (warning). Use `showLabel={false}` for an icon-only chip.
