// Gorgon — 我的周末 (desktop timeline).
//
// PHASE 5: a real schedule, not a card grid.
//
//   周六 9.19
//     14:00 ─┬─ AI Agent Builder Meetup   徐汇 · 14:00–17:00
//            │
//     19:00 ─┴─ AI Demo Night             静安 · 19:00–21:00
//
// Overlapping activities are flagged 时间冲突 in red. Non-overlapping days get
// an explicit 时间无直接冲突 line. Transit time is NEVER estimated — the app
// says 交通时间尚未计算 because no routing provider is connected.
//
// Persistence: GorgonStore keeps the full activity snapshot, so a saved search
// result is still here after a refresh.
(function () {
  const { Button, StatBlock, SegmentedControl, Tag } = window.GorgonDesignSystem_56aa78;
  const V = window.GorgonActivityView;
  const C = window.GorgonCommon;

  function DayTimeline({ label, dateText, items, conflictMap, synced, onOpen, onSync }) {
    if (!items.length) return null;
    const conflicted = items.filter((v) => conflictMap[v.id]);
    return (
      <section className="gg-weekend-day">
        <header className="gg-weekend-dayhead">
          <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 19, color: "var(--text-strong)", margin: 0 }}>{label}</h2>
          {dateText && <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{dateText}</span>}
          <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 12.5, color: "var(--text-faint)" }}>{items.length} 场</span>
            {conflicted.length > 0 ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 700, color: "var(--danger)" }}>
                <i data-lucide="triangle-alert" style={{ width: 13, height: 13 }} />时间冲突
              </span>
            ) : (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600, color: "var(--accent-strong, #047857)" }}>
                <i data-lucide="check" style={{ width: 13, height: 13 }} />时间无直接冲突
              </span>
            )}
          </span>
        </header>

        <div className="gg-timeline">
          {items.map((v) => {
            const clash = !!conflictMap[v.id];
            const isSynced = !!synced[v.id];
            return (
              <div key={v.id} className="gg-timeline-row">
                <div className="gg-timeline-time">
                  <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 14.5, color: clash ? "var(--danger)" : "var(--text-strong)", fontVariantNumeric: "tabular-nums" }}>
                    {V.clockLabel(v.startMinutes)}
                  </span>
                  {v.endMinutes != null && (
                    <span style={{ fontSize: 11, color: "var(--text-faint)", fontVariantNumeric: "tabular-nums" }}>{V.clockLabel(v.endMinutes)} 结束</span>
                  )}
                </div>

                <div className="gg-timeline-rail" aria-hidden="true">
                  <span className={"gg-timeline-dot" + (clash ? " is-clash" : "")} />
                </div>

                <div className={"gg-timeline-card" + (clash ? " is-clash" : "")}>
                  <C.ActivityImage image={v.image} alt={v.title} ratio="1 / 1"
                    style={{ width: 64, height: 64, aspectRatio: "auto", borderRadius: "var(--radius-sm)" }}>
                  </C.ActivityImage>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15, color: "var(--text-strong)", minWidth: 0 }}>{v.title}</span>
                      {clash && <span style={{ fontSize: 11, fontWeight: 700, color: "var(--danger)" }}>时间冲突</span>}
                      <C.TrustChip status={v.trust} size="sm" withIcon={false} />
                    </div>
                    <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 4, lineHeight: 1.5 }}>
                      {[v.district, v.venue].filter(Boolean).join(" · ") || "地点待定"}
                      {v.timeText ? " · " + v.timeText : ""}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, flex: "none" }}>
                    <Button variant="secondary" size="sm" onClick={() => onOpen(v)}>详情</Button>
                    <Button variant={isSynced ? "mint" : "secondary"} size="sm" onClick={() => onSync(v)}
                      leadingIcon={<i data-lucide={isSynced ? "check" : "plus"} style={{ width: 14, height: 14 }} />}>
                      {isSynced ? "已加入" : "加入"}
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    );
  }

  function EmptyWeekend({ onDiscover }) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 40, textAlign: "center" }}>
        <div style={{ width: 92, height: 92, borderRadius: "var(--radius-2xl)", background: "var(--grad-sync)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "var(--shadow-brand)", marginBottom: 20 }}>
          <i data-lucide="calendar-heart" style={{ width: 44, height: 44, color: "#fff" }} />
        </div>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 700, color: "var(--text-strong)", marginBottom: 8 }}>周末还空着</h2>
        <p style={{ fontSize: 14.5, color: "var(--text-muted)", lineHeight: 1.6, maxWidth: 300, marginBottom: 22 }}>
          去「智能」问一句话，或在「发现」里逛逛，把喜欢的活动加入这里。
        </p>
        <Button variant="primary" size="lg" onClick={onDiscover} leadingIcon={<i data-lucide="compass" style={{ width: 18, height: 18 }} />}>去发现活动</Button>
      </div>
    );
  }

  function EmptyFavorites({ onDiscover }) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 40, textAlign: "center" }}>
        <div style={{ width: 92, height: 92, borderRadius: "var(--radius-2xl)", background: "var(--bg-sunken)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 20 }}>
          <i data-lucide="heart" style={{ width: 42, height: 42, color: "var(--text-faint)" }} />
        </div>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 700, color: "var(--text-strong)", marginBottom: 8 }}>还没有收藏</h2>
        <p style={{ fontSize: 14.5, color: "var(--text-muted)", lineHeight: 1.6, maxWidth: 300, marginBottom: 22 }}>在活动详情页点右上角的 ❤️，就能把它收藏到这里。</p>
        <Button variant="primary" size="lg" onClick={onDiscover} leadingIcon={<i data-lucide="compass" style={{ width: 18, height: 18 }} />}>去发现活动</Button>
      </div>
    );
  }

  function FavRow({ v, onOpen, onRemove }) {
    return (
      <div style={{ display: "flex", gap: 12, alignItems: "center", padding: 12, borderRadius: "var(--radius-md)", border: "1px solid var(--border-subtle)", background: "var(--surface-card)" }}>
        <C.ActivityImage image={v.image} alt={v.title} ratio="1 / 1" style={{ width: 52, height: 52, aspectRatio: "auto", borderRadius: "var(--radius-sm)" }} />
        <div onClick={() => onOpen(v)} style={{ flex: 1, minWidth: 0, cursor: "pointer" }}>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 12, fontWeight: 600, color: "var(--brand)", fontVariantNumeric: "tabular-nums" }}>
            {v.dateText || "日期待定"}{v.timeText ? " · " + v.timeText : ""}
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-strong)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.title}</div>
          <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>{v.venue || v.district || "地点待定"}</div>
        </div>
        <button onClick={() => onRemove(v.id)} aria-label="取消收藏" title="取消收藏" style={{ flex: "none", width: 38, height: 38, borderRadius: "50%", border: "none", background: "var(--danger-soft)", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
          <i data-lucide="heart-off" style={{ width: 18, height: 18, color: "var(--danger)" }} />
        </button>
      </div>
    );
  }

  /**
   * weekend: { [id]: activityView }   — persisted snapshots
   * favorites: string[] of ids (resolved against the in-app dataset)
   */
  function MyWeekendScreen({ weekend, onSync, onOpen, onDiscover, favorites, onToggleFavorite }) {
    const { activities } = window.GORGON_DATA;
    const [tab, setTab] = React.useState("我的周末");

    const views = React.useMemo(
      () => Object.keys(weekend || {}).map((k) => weekend[k]).filter(Boolean),
      [weekend]);

    const favViews = React.useMemo(() => {
      const ids = favorites || [];
      return ids.map((id) => {
        const act = activities.find((a) => a.id === id);
        return act ? V.toView(act) : null;
      }).filter(Boolean);
    }, [favorites, activities]);

    const conflictMap = React.useMemo(() => V.conflictIds(views), [views]);

    const sorted = React.useMemo(() => views.slice().sort((a, b) => {
      const da = V.VIEW_DAY_ORDER[a.dayKey] != null ? V.VIEW_DAY_ORDER[a.dayKey] : 3;
      const db = V.VIEW_DAY_ORDER[b.dayKey] != null ? V.VIEW_DAY_ORDER[b.dayKey] : 3;
      if (da !== db) return da - db;
      return V.slotOf(a).start - V.slotOf(b).start;
    }), [views]);

    React.useEffect(() => { window.lucide && window.lucide.createIcons(); }, [tab, favorites, weekend]);

    const groups = [
      { key: "sat", label: "周六", items: sorted.filter((v) => v.dayKey === "sat") },
      { key: "sun", label: "周日", items: sorted.filter((v) => v.dayKey === "sun") },
      { key: "tbd", label: "时间待定", items: sorted.filter((v) => v.dayKey !== "sat" && v.dayKey !== "sun") },
    ];

    const freeCount = views.filter((v) => v.priceType === "free").length;
    const clashCount = Object.keys(conflictMap).length;
    const isFav = tab === "收藏";

    return (
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflowY: "auto", scrollbarWidth: "none" }} data-gg-screen="weekend">
        <div style={{ padding: "22px var(--gg-gutter) 14px" }}>
          <div className="gorgon-kicker" style={{ marginBottom: 5 }}>{isFav ? "Saved" : "My Weekend"}</div>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: 28, fontWeight: 700, color: "var(--text-strong)", margin: "0 0 14px", letterSpacing: "-0.02em" }}>
            {isFav ? "我的收藏" : "我的周末"}
          </h1>
          <SegmentedControl options={["我的周末", "收藏"]} value={tab} onChange={setTab} />
        </div>

        {!isFav && (views.length === 0 ? (
          <EmptyWeekend onDiscover={onDiscover} />
        ) : (
          <>
            <div style={{ margin: "0 var(--gg-gutter) 22px", padding: "16px 18px", borderRadius: "var(--radius-lg)", background: "var(--surface-card)", border: "1px solid var(--border-subtle)", boxShadow: "var(--shadow-sm)", display: "flex", justifyContent: "space-around", maxWidth: 640 }}>
              <StatBlock value={views.length} label="已加入" accent="brand" align="center" />
              <div style={{ width: 1, background: "var(--border-subtle)" }} />
              <StatBlock value={freeCount} label="免费场次" accent="mint" align="center" />
              <div style={{ width: 1, background: "var(--border-subtle)" }} />
              <StatBlock value={clashCount} label="时间冲突" accent={clashCount ? "danger" : "brand"} align="center" />
            </div>

            <div style={{ padding: "0 var(--gg-gutter) 8px" }}>
              {groups.map((g) => (
                <DayTimeline key={g.key} label={g.label}
                  dateText={(g.items[0] && g.items[0].dateText) || null}
                  items={g.items} conflictMap={conflictMap}
                  synced={weekend} onOpen={onOpen} onSync={onSync} />
              ))}
            </div>

            <div style={{ padding: "4px var(--gg-gutter) 40px" }}>
              <C.NoticeBlock icon="info" title="交通时间尚未计算" tone="neutral"
                body="Gorgon 目前没有接入路线服务，所以不会给出「来得及 / 来不及」或任何通勤时长。请以实际路线为准。" />
            </div>
          </>
        ))}

        {isFav && (favViews.length === 0 ? (
          <EmptyFavorites onDiscover={onDiscover} />
        ) : (
          <div style={{ padding: "0 var(--gg-gutter) 32px" }}>
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 10 }}>共收藏 <b style={{ color: "var(--text-strong)" }}>{favViews.length}</b> 场</div>
            <div className="gg-card-grid--two">
              {favViews.map((v) => (
                <FavRow key={v.id} v={v} onOpen={onOpen} onRemove={onToggleFavorite} />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  window.GorgonApp = Object.assign(window.GorgonApp || {}, { MyWeekendScreen });
})();
