// Gorgon — Search & filters.
// Demo MVP: real search across title / description / tags / category / venue / district / price,
// case-insensitive, with an empty state.
//
// PHASE 5.1: the district filter is a real, shared filter here too. Keyword and
// district are combined with AND — 徐汇 + AI means "AI activities IN 徐汇", never
// the union of the two. The list, the stated count and the empty state all come
// from the same filtered array, so they cannot disagree.
(function(){
const { SearchField, ActivityCard, Tag } = window.GorgonDesignSystem_56aa78;
const D = window.GorgonDistrict;
const DistrictPicker = (window.GorgonApp && window.GorgonApp.DistrictPicker) || function () { return null; };

const RECENT = ["AI", "黑客松", "Livehouse", "免费"];

const TRENDING = [
  { t: "AI", c: "ai" }, { t: "黑客松", c: "hackathon" }, { t: "展览", c: "exhibition" },
  { t: "Livehouse", c: "music" }, { t: "市集", c: "market" }, { t: "公益", c: "charity" },
];

function catLabel(key) {
  const c = window.GORGON_DATA.categories.find((x) => x.key === key);
  return c ? c.label : key;
}

/** Build the searchable haystack for one activity. */
function haystack(a) {
  return [
    a.title, a.desc, a.venue, a.location, a.district, a.address, a.host,
    a.price, catLabel(a.category), (a.tags || []).join(" "),
  ].filter(Boolean).join(" ").toLowerCase();
}

function matches(a, q) {
  const needle = q.trim().toLowerCase();
  if (!needle) return false;
  // "免费" should also match the price field even though it's already in the haystack
  if (needle === "免费" && a.price === "免费") return true;
  return haystack(a).indexOf(needle) >= 0;
}

function EmptyResults({ q, title, district, onClearDistrict }) {
  return (
    <div data-gg-region="search-empty" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "48px 24px", textAlign: "center" }}>
      <div style={{ width: 84, height: 84, borderRadius: "var(--radius-2xl)", background: "var(--bg-sunken)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 18 }}>
        <i data-lucide="search-x" style={{ width: 38, height: 38, color: "var(--text-faint)" }} />
      </div>
      <h2 data-gg-empty-title style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 700, color: "var(--text-strong)", marginBottom: 8 }}>{title}</h2>
      <p style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.6, maxWidth: 280 }}>
        换个关键词试试，比如「AI」「黑客松」「免费」「徐汇」。
      </p>
      {q ? <div style={{ fontSize: 12.5, color: "var(--text-faint)", marginTop: 12 }}>当前搜索：「{q}」</div> : null}
      {!D.isAll(district) && onClearDistrict ? (
        <button onClick={onClearDistrict} className="gg-chip" style={{ marginTop: 14 }}>
          在整个上海范围内搜索
        </button>
      ) : null}
    </div>
  );
}

function SearchScreen({ synced, onSync, onOpen, district, onDistrictChange }) {
  const { activities } = window.GORGON_DATA;
  const [q, setQ] = React.useState("");

  const keyword = q.trim();

  // The keyword pool (before the district filter) drives the picker's counts,
  // so the numbers in the sheet describe THIS search, not the whole dataset.
  const keywordPool = React.useMemo(
    () => (keyword ? activities.filter((a) => matches(a, q)) : activities),
    [activities, q, keyword]
  );

  // AND: keyword first, then district. `scoped` is the one list everything
  // below renders from.
  const scoped = React.useMemo(() => D.filter(keywordPool, district), [keywordPool, district]);

  const results = keyword ? scoped : scoped.slice(0, 3);

  React.useEffect(() => { window.lucide && window.lucide.createIcons(); }, [q, district]);

  const empty = results.length === 0;

  return (
    <div data-gg-screen="search" style={{ flex: 1, minHeight: 0, overflowY: "auto", scrollbarWidth: "none" }}>
      <div style={{ padding: "8px var(--gg-gutter) 16px", position: "sticky", top: 0, background: "var(--bg-base)", zIndex: 2 }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: 26, fontWeight: 700, color: "var(--text-strong)", marginBottom: 12 }}>搜索</h1>
        <SearchField value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索活动、地点、标签" size="lg" />
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
          <DistrictPicker value={district} onChange={onDistrictChange} activities={keywordPool} />
          <span style={{ fontSize: 12.5, color: "var(--text-faint)" }}>
            {D.isAll(district) ? "搜索范围：整个上海" : "只搜索 " + district + " 区域内的活动"}
          </span>
        </div>
      </div>

      {!q && (
        <div style={{ padding: "0 var(--gg-gutter)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "6px 0 10px" }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-strong)" }}>最近搜索</span>
            <button onClick={() => setQ("")} style={{ border: "none", background: "transparent", color: "var(--text-muted)", fontSize: 12.5, cursor: "pointer" }}>清除</button>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 22 }}>
            {RECENT.map((r) => (
              <button key={r} onClick={() => setQ(r)} style={{ display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid var(--border-subtle)", background: "var(--surface-card)", borderRadius: "var(--radius-pill)", padding: "8px 13px", fontSize: 13, color: "var(--text-body)", fontWeight: 500, cursor: "pointer" }}>
                <i data-lucide="clock" style={{ width: 13, height: 13, color: "var(--text-faint)" }} />{r}
              </button>
            ))}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 7, margin: "0 0 12px" }}>
            <i data-lucide="trending-up" style={{ width: 17, height: 17, color: "var(--brand)" }} />
            <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-strong)" }}>本周热搜</span>
          </div>
          {/* 2 columns; 3 on desktop */}
          <div className="gg-grid-3" style={{ marginBottom: 24 }}>
            {TRENDING.map((tr, i) => (
              <button key={tr.t} onClick={() => setQ(tr.t)} style={{ display: "flex", alignItems: "center", gap: 10, border: "1px solid var(--border-subtle)", background: "var(--surface-card)", borderRadius: "var(--radius-md)", padding: "11px 13px", cursor: "pointer", textAlign: "left", minWidth: 0 }}>
                <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 16, color: i < 2 ? "var(--brand)" : "var(--text-faint)", width: 16, flex: "none" }}>{i + 1}</span>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: `var(--cat-${tr.c})`, flex: "none" }} />
                <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text-body)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tr.t}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 只有地区筛选（没有关键词）时，区域为空就是空 —— 不拿别的区凑数 */}
      {empty && (
        <EmptyResults q={q} district={district}
          title={D.emptyTitle(district, !!keyword)}
          onClearDistrict={onDistrictChange ? () => onDistrictChange(D.ALL) : null} />
      )}

      <div style={{ padding: "0 var(--gg-gutter) 32px" }}>
        {!empty && keyword && (
          <div style={{ fontSize: 13, color: "var(--text-muted)", margin: "2px 0 14px" }}>
            找到 <b style={{ color: "var(--text-strong)" }}>{results.length}</b> 场相关活动
            {D.isAll(district) ? "" : ` · 范围：${district}`}
          </div>
        )}
        {!empty && !keyword && !D.isAll(district) && (
          <div style={{ fontSize: 13, color: "var(--text-muted)", margin: "2px 0 14px" }}>
            {district} 共 <b style={{ color: "var(--text-strong)" }}>{scoped.length}</b> 场活动
          </div>
        )}
        {/* 1 column on mobile, 2 from tablet up */}
        <div className="gg-card-grid--two">
          {results.map((a) => (
            <div key={a.id} onClick={() => onOpen(a)} style={{ cursor: "pointer" }} data-gg-card-district={D.districtOf(a) || ""}>
              <ActivityCard compact title={a.title} category={a.category} date={a.date} time={a.time} location={a.location} distance={a.distance} image={a.image} synced={!!synced[a.id]} onSync={() => onSync(a.id)} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

window.GorgonApp = Object.assign(window.GorgonApp || {}, { SearchScreen });
})();
