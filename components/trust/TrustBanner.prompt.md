Full-width trust status banner for the top of an activity detail. Requires Lucide.

```jsx
<TrustBanner state="confirmed" />
<TrustBanner state="unverified" action="查看来源" onAction={openSource} />
<TrustBanner state="cancelled" />
```

States: `confirmed` (mint) · `unverified` / `changed` (amber) · `cancelled` (coral). Each ships sensible default 中文 copy; override with `title`/`desc`.
