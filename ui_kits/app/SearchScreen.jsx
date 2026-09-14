// Gorgon — Search & filters.
// Demo MVP: real search across title / description / tags / category / venue / district / price,
// case-insensitive, with an empty state.
(function(){
const { SearchField, ActivityCard, Tag } = window.GorgonDesignSystem_56aa78;

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

function EmptyResults({ q }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "48px 24px", textAlign: "center" }}>
      <div style={{ width: 84, height: 84, borderRadius: "var(--radius-2xl)", background: "var(--bg-sunken)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 18 }}>
        <i data-lucide="search-x" style={{ width: 38, height: 38, color: "var(--text-faint)" }} />
      </div>
      <h2 style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 700, color: "var(--text-strong)", marginBottom: 8 }}>没有找到相关活动</h2>
      <p style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.6, maxWidth: 250 }}>
        换个关键词试试，比如「AI」「黑客松」「免费」「徐汇」。
      </p>
      <div style={{ fontSize: 12.5, color: "var(--text-faint)", marginTop: 12 }}>当前搜索：「{q}」</div>
    </div>
  );
}

function SearchScreen({ synced, onSync, onOpen }) {
  const { activities } = window.GORGON_DATA;
  const [q, setQ] = React.useState("");
  const results = q.trim() ? activities.filter((a) => matches(a, q)) : activities.slice(0, 3);

  React.useEffect(() => { window.lucide && window.lucide.createIcons(); }, [q]);

  return (
    <div style={{ flex: 1, overflowY: "auto", scrollbarWidth: "none" }}>
      <div style={{ padding: "8px 20px 16px", position: "sticky", top: 0, background: "var(--bg-base)", zIndex: 2 }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: 26, fontWeight: 700, color: "var(--text-strong)", marginBottom: 12 }}>搜索</h1>
        <SearchField value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索活动、地点、标签" size="lg" />
      </div>

      {!q && (
        <div style={{ padding: "0 20px" }}>
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
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9, marginBottom: 24 }}>
            {TRENDING.map((tr, i) => (
              <button key={tr.t} onClick={() => setQ(tr.t)} style={{ display: "flex", alignItems: "center", gap: 10, border: "1px solid var(--border-subtle)", background: "var(--surface-card)", borderRadius: "var(--radius-md)", padding: "11px 13px", cursor: "pointer", textAlign: "left" }}>
                <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 16, color: i < 2 ? "var(--brand)" : "var(--text-faint)", width: 16 }}>{i + 1}</span>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: `var(--cat-${tr.c})`, flex: "none" }} />
                <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text-body)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tr.t}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {q && results.length === 0 && <EmptyResults q={q} />}

      <div style={{ padding: "0 20px 24px" }}>
        {q && results.length > 0 && <div style={{ fontSize: 13, color: "var(--text-muted)", margin: "2px 0 12px" }}>找到 <b style={{ color: "var(--text-strong)" }}>{results.length}</b> 场相关活动</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {results.map((a) => (
            <div key={a.id} onClick={() => onOpen(a)} style={{ cursor: "pointer" }}>
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
