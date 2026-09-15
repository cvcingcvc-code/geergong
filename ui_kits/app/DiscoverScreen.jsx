// Gorgon — Discover feed (home).
// Demo MVP: live count, category filter, free filter, district filter, tap-to-detail.
//
// PHASE 4.1 — responsive:
//   Mobile        page header + gradient hero + 1-column card list (unchanged)
//   Tablet        wide page header + summary card + 2-column grid
//   Desktop       wide page header + summary card + 3-column grid
// The screen is ONE component; only the `<div className="gg-hero-*">` treatment
// and the grid template (both driven by responsive.css) differ.
(function(){
const { ActivityCard, SearchField, SegmentedControl, Avatar, Button } = window.GorgonDesignSystem_56aa78;
const { useResponsive } = window.GorgonResponsive;

const HOME_DISTRICT = (window.GORGON_DATA.user.campus || "").split("·")[1] || "";

function pillStyle(on) {
  return {
    flex: "none", display: "inline-flex", alignItems: "center", gap: 7,
    border: on ? "1px solid var(--brand)" : "1px solid var(--border-subtle)",
    background: on ? "var(--brand)" : "var(--surface-card)",
    color: on ? "#fff" : "var(--text-body)",
    fontFamily: "var(--font-sans)", fontWeight: 600, fontSize: 13.5,
    padding: "9px 15px", borderRadius: "var(--radius-pill)", cursor: "pointer",
    transition: "all var(--dur-fast) var(--ease-out)",
  };
}

function CategoryRail({ value, onChange }) {
  const cats = window.GORGON_DATA.categories;
  return (
    <div style={{ display: "flex", gap: 8, overflowX: "auto", padding: "0 var(--gg-gutter) 2px", scrollbarWidth: "none" }}>
      {cats.map((c) => {
        const on = c.key === value;
        return (
          <button key={c.key} onClick={() => onChange(c.key)} style={pillStyle(on)}>
            {c.key !== "all" && <span style={{ width: 8, height: 8, borderRadius: "50%", background: on ? "#fff" : `var(--cat-${c.key})` }} />}
            {c.label}
          </button>
        );
      })}
    </div>
  );
}

/** "9 月 19–26 日" — derived from the visible activities, never hard-coded
 *  to a specific demo date. */
function dateSpan(list) {
  const days = [];
  (list || []).forEach((a) => {
    const m = /(\d{1,2})\.(\d{1,2})/.exec(a.date || "");
    if (m) days.push({ mo: +m[1], d: +m[2] });
  });
  if (!days.length) return null;
  const mo = days[0].mo;
  const ds = days.filter((x) => x.mo === mo).map((x) => x.d).sort((a, b) => a - b);
  return ds[0] === ds[ds.length - 1] ? `${mo} 月 ${ds[0]} 日` : `${mo} 月 ${ds[0]}–${ds[ds.length - 1]} 日`;
}

/** STEP 14 — a zero-result screen must never be a white page. */
function EmptyDiscover({ onReset, onGoSmart, anyFilter }) {
  const tips = [anyFilter ? "清除筛选条件" : "切换到「全部」兴趣分类", "看看下周末的安排", "使用「智能」告诉 Gorgon 你想找什么"];
  return (
    <div className="gg-empty" style={{ padding: "40px var(--gg-gutter) 48px", display: "flex", justifyContent: "center" }}>
      <div style={{ maxWidth: 460, width: "100%", textAlign: "center" }}>
        <div style={{ width: 76, height: 76, borderRadius: "var(--radius-2xl)", background: "var(--bg-sunken)", display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: 18 }}>
          <i data-lucide="search-x" style={{ width: 34, height: 34, color: "var(--text-faint)" }} />
        </div>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 21, fontWeight: 700, color: "var(--text-strong)", marginBottom: 10 }}>暂时没有符合条件的活动</h2>
        <div style={{ fontSize: 13.5, color: "var(--text-muted)", lineHeight: 1.8, marginBottom: 20 }}>
          <div style={{ marginBottom: 6 }}>试试：</div>
          {tips.map((t, i) => (
            <div key={i} style={{ display: "flex", gap: 7, justifyContent: "center", alignItems: "baseline" }}>
              <span style={{ color: "var(--text-faint)" }}>•</span><span>{t}</span>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
          {anyFilter && (
            <Button variant="secondary" onClick={onReset}>清除筛选</Button>
          )}
          <Button variant="primary" onClick={onGoSmart} leadingIcon={<i data-lucide="sparkles" style={{ width: 16, height: 16 }} />}>
            去智能搜索
          </Button>
        </div>
      </div>
    </div>
  );
}

function DiscoverScreen({ synced, onSync, onOpen, onGoSearch, onGoSmart }) {
  const { user, activities } = window.GORGON_DATA;
  const { isMobile } = useResponsive();
  const [cat, setCat] = React.useState("all");
  const [when, setWhen] = React.useState("本周末");
  const [showFilters, setShowFilters] = React.useState(false);
  const [onlyFree, setOnlyFree] = React.useState(false);
  const [district, setDistrict] = React.useState(null);

  const districts = React.useMemo(() => {
    const s = [];
    activities.forEach((a) => { const d = a.district || (a.location || "").split("·")[1]; if (d && s.indexOf(d) < 0) s.push(d); });
    return s;
  }, [activities]);

  const list = activities.filter((a) => {
    if (cat !== "all" && a.category !== cat) return false;
    if (onlyFree && a.price !== "免费") return false;
    if (district && (a.district || "") !== district) return false;
    return true;
  });

  const anyFilter = onlyFree || !!district;
  const resetFilters = () => { setOnlyFree(false); setDistrict(null); };

  // Weekend summary figures (data-driven, no magic numbers).
  const nearCount = list.filter((a) => (a.district || "") === HOME_DISTRICT).length;
  const freeCount = list.filter((a) => a.price === "免费").length;
  const span = dateSpan(list);

  React.useEffect(() => { window.lucide && window.lucide.createIcons(); }, []);

  const feedMeta = (
    <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
      共 <b style={{ color: "var(--text-strong)" }}>{list.length}</b> 场活动
      {cat !== "all" ? ` · ${(window.GORGON_DATA.categories.find((c) => c.key === cat) || {}).label || ""}` : ""}
      {onlyFree ? " · 仅免费" : ""}{district ? ` · ${district}` : ""}
    </div>
  );

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", scrollbarWidth: "none" }}>
      {/* ── Mobile page header (unchanged) ─────────────────────────── */}
      {isMobile && (
        <div style={{ padding: "8px var(--gg-gutter) 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 5, color: "var(--text-muted)", fontSize: 12.5, fontWeight: 500 }}>
              <i data-lucide="map-pin" style={{ width: 13, height: 13 }} />{user.campus}
              <span style={{ marginLeft: 4, padding: "1px 7px", borderRadius: "var(--radius-pill)", background: "var(--warning-soft)", color: "#9A6300", fontSize: 10, fontWeight: 700, letterSpacing: "0.04em" }}>DEMO</span>
            </div>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 23, color: "var(--text-strong)", letterSpacing: "-0.01em", marginTop: 3 }}>
              周末好，{user.name} 👋
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <button style={{ position: "relative", width: 42, height: 42, borderRadius: "var(--radius-md)", border: "1px solid var(--border-subtle)", background: "var(--surface-card)", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
              <i data-lucide="bell" style={{ width: 20, height: 20, color: "var(--text-body)" }} />
              <span style={{ position: "absolute", top: 9, right: 10, width: 8, height: 8, borderRadius: "50%", background: "var(--danger)", boxShadow: "0 0 0 2px var(--surface-card)" }} />
            </button>
            <Avatar name={user.name} size="md" ring />
          </div>
        </div>
      )}

      {/* ── Tablet / desktop page header ───────────────────────────── */}
      {!isMobile && (
        <div style={{ padding: "26px var(--gg-gutter) 18px", display: "flex", alignItems: "flex-end", gap: 32, justifyContent: "space-between", flexWrap: "wrap" }}>
          <div style={{ minWidth: 0 }}>
            <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 30, color: "var(--text-strong)", letterSpacing: "-0.02em", margin: 0 }}>
              发现你的周末
            </h1>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 7, fontSize: 13.5, color: "var(--text-muted)", fontWeight: 500 }}>
              <i data-lucide="map-pin" style={{ width: 14, height: 14, color: "var(--brand)" }} />
              上海{span ? ` · ${span}` : ""}
              <span style={{ padding: "1px 7px", borderRadius: "var(--radius-pill)", background: "var(--warning-soft)", color: "#9A6300", fontSize: 10, fontWeight: 700, letterSpacing: "0.04em" }}>DEMO</span>
            </div>
          </div>
          <div style={{ width: "min(420px, 100%)", flex: "0 1 420px", cursor: "pointer" }} onClick={onGoSearch} role="button" aria-label="打开搜索">
            <SearchField placeholder="搜索活动、地点、标签" readOnly style={{ cursor: "pointer" }} />
          </div>
        </div>
      )}

      {/* ── Search (mobile: tap → search tab) ──────────────────────── */}
      {isMobile && (
        <div style={{ padding: "0 var(--gg-gutter) 14px" }} onClick={onGoSearch} role="button" aria-label="打开搜索">
          <SearchField placeholder="搜索活动、地点、标签" readOnly style={{ cursor: "pointer" }} />
        </div>
      )}

      {/* ── Hero: weekend summary ──────────────────────────────────── */}
      {/* Mobile — signature gradient strip (unchanged) */}
      <div className="gg-hero-mobile" style={{ margin: "0 var(--gg-gutter) 16px", padding: "16px 18px", borderRadius: "var(--radius-lg)", background: "var(--grad-sync)", color: "#fff", boxShadow: "var(--shadow-brand)" }}>
        <div>
          <div style={{ fontFamily: "var(--font-display)", textTransform: "uppercase", letterSpacing: "0.12em", fontSize: 11, fontWeight: 600, opacity: 0.9 }}>This Weekend</div>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 26, marginTop: 2 }}>就在你附近 {list.length} 场</div>
        </div>
        <i data-lucide="sparkles" style={{ width: 30, height: 30, opacity: 0.95 }} />
      </div>

      {/* Tablet / desktop — a real summary card that uses the width */}
      <div className="gg-hero-wide" style={{ margin: "0 var(--gg-gutter) 22px" }}>
        <div style={{
          padding: "22px 24px", borderRadius: "var(--radius-lg)", background: "var(--surface-card)",
          border: "1px solid var(--border-subtle)", boxShadow: "var(--shadow-sm)",
          display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap",
        }}>
          <span style={{ width: 52, height: 52, borderRadius: "var(--radius-md)", background: "var(--grad-sync)", flex: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", boxShadow: "var(--shadow-brand)" }}>
            <i data-lucide="sparkles" style={{ width: 26, height: 26, color: "#fff" }} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 22, color: "var(--text-strong)", letterSpacing: "-0.01em" }}>本周末</div>
            <div style={{ fontSize: 14, color: "var(--text-body)", marginTop: 5 }}>
              <b style={{ fontSize: 17, color: "var(--text-strong)" }}>{list.length}</b> 个值得关注的活动
              <span style={{ color: "var(--text-faint)", margin: "0 9px" }}>·</span>
              <b style={{ fontSize: 17, color: "var(--text-strong)" }}>{nearCount}</b> 个就在{HOME_DISTRICT || "你附近"}
              <span style={{ color: "var(--text-faint)", margin: "0 9px" }}>·</span>
              <b style={{ fontSize: 17, color: "var(--accent-strong)" }}>{freeCount}</b> 个免费
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 16 }} />
          <Button variant="primary" onClick={onGoSmart} leadingIcon={<i data-lucide="sparkles" style={{ width: 17, height: 17 }} />}>
            用一句话找活动
          </Button>
        </div>
      </div>

      {/* ── Interest categories ────────────────────────────────────── */}
      {!isMobile && (
        <div style={{ padding: "0 var(--gg-gutter) 10px", fontSize: 12.5, fontWeight: 700, color: "var(--text-muted)" }}>兴趣分类</div>
      )}
      <div style={{ marginBottom: 14 }}><CategoryRail value={cat} onChange={setCat} /></div>

      <div style={{ padding: "0 var(--gg-gutter) 14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <SegmentedControl options={["本周末", "下周末", "全部"]} value={when} onChange={setWhen} />
        <button onClick={() => setShowFilters((v) => !v)} style={{ display: "inline-flex", alignItems: "center", gap: 5, border: "none", background: "transparent", color: (showFilters || anyFilter) ? "var(--brand)" : "var(--text-muted)", fontSize: 13, fontWeight: 600, cursor: "pointer", flex: "none" }}>
          <i data-lucide="sliders-horizontal" style={{ width: 16, height: 16 }} />筛选{anyFilter ? " ·" + (district ? 1 : 0) + (onlyFree ? 1 : 0) : ""}
        </button>
      </div>

      {/* Filter panel */}
      {showFilters && (
        <div style={{ padding: "0 var(--gg-gutter) 14px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => setOnlyFree((v) => !v)} style={pillStyle(onlyFree)}>
              <i data-lucide="ticket" style={{ width: 14, height: 14 }} />只看免费
            </button>
            {districts.map((d) => (
              <button key={d} onClick={() => setDistrict(district === d ? null : d)} style={pillStyle(district === d)}>{d}</button>
            ))}
          </div>
          {anyFilter && (
            <button onClick={resetFilters} style={{ alignSelf: "flex-start", border: "none", background: "transparent", color: "var(--brand)", fontSize: 13, fontWeight: 600, cursor: "pointer", padding: 0 }}>
              清除筛选
            </button>
          )}
        </div>
      )}

      {/* ── Feed ───────────────────────────────────────────────────── */}
      {list.length === 0 ? (
        <EmptyDiscover anyFilter={anyFilter} onReset={resetFilters} onGoSmart={onGoSmart} />
      ) : (
        <div style={{ padding: "0 var(--gg-gutter) 32px" }}>
          {!isMobile && (
            <div className="gg-section-head" style={{ marginBottom: 16 }}>
              <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18, color: "var(--text-strong)" }}>推荐活动</div>
              {feedMeta}
            </div>
          )}
          {isMobile && <div style={{ fontSize: 13, color: "var(--text-muted)", margin: "-4px 0 14px" }}>共 <b style={{ color: "var(--text-strong)" }}>{list.length}</b> 场活动
            {cat !== "all" ? ` · ${(window.GORGON_DATA.categories.find((c) => c.key === cat) || {}).label || ""}` : ""}
            {onlyFree ? " · 仅免费" : ""}{district ? ` · ${district}` : ""}
          </div>}

          {/* 1 column (mobile) → 2 (tablet) → 3 (desktop) via responsive.css */}
          <div className="gg-card-grid">
            {list.map((a) => (
              <div key={a.id} onClick={() => onOpen(a)} style={{ cursor: "pointer", display: "flex" }}>
                <ActivityCard
                  style={{ flex: 1 }}
                  title={a.title} category={a.category} date={a.date} time={a.time}
                  location={a.location} distance={a.distance} price={a.price}
                  tags={a.tags} hot={a.hot} image={a.image} synced={!!synced[a.id]}
                  onSync={() => onSync(a.id)}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

window.GorgonApp = Object.assign(window.GorgonApp || {}, { DiscoverScreen });
})();
