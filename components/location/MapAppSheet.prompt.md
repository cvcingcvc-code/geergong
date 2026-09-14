Bottom sheet that hands navigation off to the user's own map app via deep links (高德 / 百度 / 腾讯 / Apple). Requires Lucide. Render inside a `position:relative` container.

```jsx
const [open, setOpen] = React.useState(false);
<MapAppSheet open={open} onClose={() => setOpen(false)}
  venue="苏州河梦清园入口" coord={{ lng: 121.43, lat: 31.24 }} />
```

Each row is a real deep-link that opens the native app if installed, else web. NOTE: coordinate systems differ per provider (Amap/Tencent GCJ-02, Baidu BD-09, Apple WGS-84) — convert before linking in production.
