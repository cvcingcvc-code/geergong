// Gorgon — 发现 (home).
//
// PHASE 5: the feed becomes an image-card grid so a real activity photo is
// visible at a glance.
//
//   Desktop >=1200   3 columns
//   Tablet  768-1199 2 columns
//   Mobile  <768     1 column
//
// Every card is built from the SAME view model the search results and the
// detail page use, and clicking any card opens the same Desktop Detail.
(function () {
  const { SearchField, SegmentedControl, Avatar, Button, Tag } = window.GorgonDesignSystem_56aa78;
  const { useResponsive } = window.GorgonResponsive;
  const V = window.GorgonActivityView;
  const C = window.GorgonCommon;

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

  function dateSpan(list) {
    const days = [];
    (list || []).forEach((a) => {
      const m = /(\d{1,2})[.月](\d{1,2})/.exec(a.date || "");
      if (m) days.push({ mo: +m[1], d: +m[2] });
    });
    if (!days.length) return null;
    const mo = days[0].mo;
    const ds = days.filter((x) => x.mo === mo).map((x) => x.d).sort((a, b) => a - b);
    return ds[0] === ds[ds.length - 1] ? `${mo} 月 ${ds[0]} 日` : `${mo} 月 ${ds[0]}–${ds[ds.length - 1]} 日`;
  }

  /* ── Image card ──────────────────────────────────────────────────── */

  function DiscoverCard({ v, synced, onSync, onOpen }) {
    const isSynced = !!synced[v.id];
    return (
      <article className="gg-disc-card" onClick={() => onOpen(v)}>
        <div style={{ padding: 10, paddingBottom: 0 }}>
          <C.ActivityImage image={v.image} alt={v.title} ratio="16 / 10" radius="var(--radius-md)">
            <C.PlaceholderNote image={v.image} />
            <div style={{ position: "absolute", top: 8, right: 8, zIndex: 2 }}>
              <C.TrustChip status={v.trust} size="sm" withIcon={false} />
            </div>
          </C.ActivityImage>
        </div>
        <div style={{ padding: "12px 14px 14px", display: "flex", flexDirection: "column", gap: 7, flex: 1 }}>
          <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15.5, color: "var(--text-strong)", lineHeight: 1.4, margin: 0 }}>
            {v.title}
          </h3>
          <div style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.55 }}>
            {v.dateText || "日期待定"}{v.timeText ? " · " + v.timeText : ""}
          </div>
          <div style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.55 }}>
            {[v.district, v.venue].filter(Boolean).join(" · ") || "地点待定"}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: v.priceType === "free" ? "var(--accent-strong, #047857)" : "var(--text-body)" }}>{v.priceLabel}</span>
            {v.tags.slice(0, 2).map((t) => <Tag key={t} size="sm" tone="neutral">{t}</Tag>)}
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Button variant={isSynced ? "mint" : "secondary"} size="sm" onClick={(e) => { e.stopPropagation(); onSync(v); }}
              leadingIcon={<i data-lucide={isSynced ? "check" : "plus"} style={{ width: 14, height: 14 }} />}>
              {isSynced ? "已加入我的周末" : "加入我的周末"}
            </Button>
          </div>
        </div>
      </article>
    );
  }

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
            {anyFilter && <Button variant="secondary" onClick={onReset}>清除筛选</Button>}
            <Button variant="primary" onClick={onGoSmart} leadingIcon={<i data-lucide="sparkles" style={{ width: 16, height: 16 }} />}>去智能找活动</Button>
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

    const list = React.useMemo(() => activities.filter((a) => {
      if (cat !== "all" && a.category !== cat) return false;
      if (onlyFree && a.price !== "免费" && a.priceType !== "free") return false;
      if (district && (a.district || "") !== district) return false;
      return true;
    }), [activities, cat, onlyFree, district]);

    const views = React.useMemo(() => list.map((a) => V.toView(a)), [list]);

    const anyFilter = onlyFree || !!district;
    const resetFilters = () => { setOnlyFree(false); setDistrict(null); };

    const nearCount = views.filter((v) => v.district === HOME_DISTRICT).length;
    const freeCount = views.filter((v) => v.priceType === "free").length;
    const aiCount = views.filter((v) => ["ai", "hackathon", "study"].indexOf(v.category) >= 0
      || /ai|agent|大模型|智能体/i.test(v.title + " " + v.tags.join(" "))).length;
    const spans = dateSpan(list);

    React.useEffect(() => { window.lucide && window.lucide.createIcons(); }, [cat, when, showFilters, onlyFree, district]);

    const stats = (
      <div className="gg-stats">
        <div className="gg-stat"><b>{views.length}</b><span>个活动</span></div>
        <div className="gg-stat"><b style={{ color: "var(--brand)" }}>{aiCount}</b><span>个 AI / 科技</span></div>
        <div className="gg-stat"><b style={{ color: "var(--accent-strong, #047857)" }}>{freeCount}</b><span>个免费</span></div>
        <div className="gg-stat"><b>{nearCount}</b><span>个在{HOME_DISTRICT || "你附近"}</span></div>
      </div>
    );

    return (
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", scrollbarWidth: "none" }} data-gg-screen="discover">
        {isMobile && (
          <div style={{ padding: "8px var(--gg-gutter) 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 5, color: "var(--text-muted)", fontSize: 12.5, fontWeight: 500 }}>
                <i data-lucide="map-pin" style={{ width: 13, height: 13 }} />{user.campus}
                <C.ProviderBadge mode="demo" size="sm" />
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

        {!isMobile && (
          <div style={{ padding: "26px var(--gg-gutter) 18px", display: "flex", alignItems: "flex-end", gap: 32, justifyContent: "space-between", flexWrap: "wrap" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 30, color: "var(--text-strong)", letterSpacing: "-0.02em", margin: 0 }}>
                  发现你的周末
                </h1>
                <C.ProviderBadge mode="demo" />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 13.5, color: "var(--text-muted)", fontWeight: 500 }}>
                <i data-lucide="map-pin" style={{ width: 14, height: 14, color: "var(--brand)" }} />
                上海{spans ? ` · ${spans}` : ""}
                <span style={{ color: "var(--text-faint)" }}>· 本地演示数据集（非实时检索）</span>
              </div>
            </div>
            <div style={{ width: "min(420px, 100%)", flex: "0 1 420px", cursor: "pointer" }} onClick={onGoSearch} role="button" aria-label="打开搜索">
              <SearchField placeholder="搜索活动、地点、标签" readOnly style={{ cursor: "pointer" }} />
            </div>
          </div>
        )}

        {!isMobile && (
          <div style={{ padding: "0 var(--gg-gutter) 20px" }}>{stats}</div>
        )}

        {isMobile && (
          <div style={{ padding: "0 var(--gg-gutter) 14px" }} onClick={onGoSearch} role="button" aria-label="打开搜索">
            <SearchField placeholder="搜索活动、地点、标签" readOnly style={{ cursor: "pointer" }} />
          </div>
        )}

        {/* Mobile keeps the signature gradient strip */}
        <div className="gg-hero-mobile" style={{ margin: "0 var(--gg-gutter) 16px", padding: "16px 18px", borderRadius: "var(--radius-lg)", background: "var(--grad-sync)", color: "#fff", boxShadow: "var(--shadow-brand)" }}>
          <div>
            <div style={{ fontFamily: "var(--font-display)", textTransform: "uppercase", letterSpacing: "0.12em", fontSize: 11, fontWeight: 600, opacity: 0.9 }}>This Weekend</div>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 26, marginTop: 2 }}>就在你附近 {views.length} 场</div>
          </div>
          <i data-lucide="sparkles" style={{ width: 30, height: 30, opacity: 0.95 }} />
        </div>

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
              <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 22, color: "var(--text-strong)", letterSpacing: "-0.01em" }}>本周末精选推荐</div>
              <div style={{ fontSize: 14, color: "var(--text-body)", marginTop: 6 }}>{stats}</div>
            </div>
            <div style={{ flex: 1, minWidth: 16 }} />
            <Button variant="primary" onClick={onGoSmart} leadingIcon={<i data-lucide="sparkles" style={{ width: 17, height: 17 }} />}>
              用一句话找活动
            </Button>
          </div>
        </div>

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

        {views.length === 0 ? (
          <EmptyDiscover anyFilter={anyFilter} onReset={resetFilters} onGoSmart={onGoSmart} />
        ) : (
          <div style={{ padding: "0 var(--gg-gutter) 32px" }}>
            <div className="gg-section-head" style={{ marginBottom: 16 }}>
              <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18, color: "var(--text-strong)" }}>精选推荐</div>
              <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
                共 <b style={{ color: "var(--text-strong)" }}>{views.length}</b> 场活动
                {cat !== "all" ? ` · ${(window.GORGON_DATA.categories.find((c) => c.key === cat) || {}).label || ""}` : ""}
                {onlyFree ? " · 仅免费" : ""}{district ? ` · ${district}` : ""}
              </div>
            </div>

            <div className="gg-card-grid">
              {views.map((v) => (
                <DiscoverCard key={v.id} v={v} synced={synced} onSync={onSync} onOpen={onOpen} />
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  window.GorgonApp = Object.assign(window.GorgonApp || {}, { DiscoverScreen });
})();
