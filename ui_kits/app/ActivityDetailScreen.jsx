// Gorgon — 活动详情 (desktop-first).
//
// PHASE 5 rebuilt this screen from a mobile sheet into a real desktop page:
//
//   Desktop (>=1024)   main column (hero / title / facts / why / about /
//                      agenda)  +  340px sticky action & source sidebar
//   Mobile  (<768)     one column; the sidebar's actions move to a sticky
//                      bottom bar and the rest flows inline
//
// Every value is rendered from the view model. Nothing is invented:
//   * a missing registrationUrl shows 暂未找到报名链接 instead of a fake link;
//   * 为什么推荐 comes from the ranking's real reasons, and the block is
//     hidden entirely when there are none;
//   * 活动流程 is rendered ONLY when the page actually published an agenda;
//   * the map area is an explicit placeholder — no fabricated metro lines or
//     "12 分钟" transit estimates.
(function () {
  const { Tag, Button } = window.GorgonDesignSystem_56aa78;
  const V = window.GorgonActivityView;
  const C = window.GorgonCommon;

  function Section({ title, kicker, children }) {
    return (
      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          {kicker && <div className="gorgon-kicker" style={{ marginBottom: 6 }}>{kicker}</div>}
          <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 17, color: "var(--text-strong)", margin: 0 }}>{title}</h2>
        </div>
        {children}
      </section>
    );
  }

  function SideCard({ title, children }) {
    return (
      <div style={{
        padding: "16px 17px", borderRadius: "var(--radius-lg)", background: "var(--surface-card)",
        border: "1px solid var(--border-subtle)", boxShadow: "var(--shadow-sm)",
      }}>
        {title && <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.04em", marginBottom: 12 }}>{title}</div>}
        {children}
      </div>
    );
  }

  function ActivityDetailScreen({ view, synced, onSync, onBack, onShowMap, onToast }) {
    const v = view;
    const [shareNote, setShareNote] = React.useState("");

    React.useEffect(() => { window.lucide && window.lucide.createIcons(); }, [v && v.id, shareNote, synced]);

    if (!v) return null;

    const shareUrl = v.sourceUrl || v.registrationUrl || null;

    const doShare = async () => {
      if (!shareUrl) { setShareNote("该活动暂无可分享的链接"); return; }
      const payload = { title: v.title, text: v.title, url: shareUrl };
      try {
        if (navigator.share) { await navigator.share(payload); return; }
        if (navigator.clipboard) { await navigator.clipboard.writeText(shareUrl); setShareNote("链接已复制"); return; }
      } catch (e) { /* user cancelled or clipboard blocked */ }
      setShareNote("已打开来源链接，请手动复制");
      window.open(shareUrl, "_blank", "noopener");
    };

    const ratio = "16 / 6";

    const facts = (
      <div className="gg-facts">
        <C.MetaTile icon="calendar" label="时间"
          value={v.dateText || "日期待定"}
          sub={v.timeText || "时间待定"} />
        <C.MetaTile icon="map-pin" label="地点"
          value={v.venue || v.district || "地点待定"}
          sub={[v.district, v.city].filter(Boolean).join(" · ") || null} />
        <C.MetaTile icon="ticket" label="票价"
          value={v.priceLabel}
          accent={v.priceType === "free" ? "var(--accent-strong, #047857)" : null}
          sub={v.registrationUrl ? "需提前报名" : "报名方式以来源为准"} />
        <C.MetaTile icon="users" label="主办方" value={v.organizer || "主办方待确认"} />
      </div>
    );

    /* ── Sidebar: actions + trust + place + sources ──────────────────── */

    const sidebar = (
      <div className="gg-detail-aside">
        <SideCard title="操作">
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            <Button block variant={synced ? "mint" : "primary"} size="lg" onClick={onSync}
              leadingIcon={<i data-lucide={synced ? "check" : "plus"} style={{ width: 17, height: 17 }} />}>
              {synced ? "已加入我的周末" : "加入我的周末"}
            </Button>

            {v.registrationUrl ? (
              <a href={v.registrationUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none", display: "block" }}>
                <Button block variant="secondary" size="lg"
                  leadingIcon={<i data-lucide="ticket" style={{ width: 17, height: 17 }} />}
                  trailingIcon={<i data-lucide="external-link" style={{ width: 15, height: 15 }} />}>
                  打开报名链接
                </Button>
              </a>
            ) : (
              <div style={{
                border: "1px dashed var(--border-strong, var(--border-subtle))", borderRadius: "var(--radius-md)",
                padding: "12px 14px", fontSize: 12.5, color: "var(--text-muted)", textAlign: "center", lineHeight: 1.55,
              }}>
                暂未找到报名链接
              </div>
            )}

            <Button block variant="ghost" size="lg" onClick={doShare}
              leadingIcon={<i data-lucide="share-2" style={{ width: 17, height: 17 }} />}>
              分享活动
            </Button>
            {shareNote && <div style={{ fontSize: 11.5, color: "var(--text-muted)", textAlign: "center" }}>{shareNote}</div>}
          </div>
        </SideCard>

        <SideCard title="可信状态">
          <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
            <C.TrustChip status={v.trust} />
            {v.trustScore != null && (
              <span style={{ fontSize: 12.5, color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>
                可信度 {v.trustScore}/100
              </span>
            )}
          </div>
          {v.trustReasonItems.length > 0 && (
            <div style={{ marginTop: 11, display: "flex", flexDirection: "column", gap: 5 }}>
              {v.trustReasonItems.map((r) => (
                <div key={r.code} style={{
                  fontSize: 12, lineHeight: 1.5,
                  color: r.risk ? "var(--danger)" : "var(--text-body)",
                }}>· {r.label}</div>
              ))}
            </div>
          )}
          {v.trust === "pending" && (
            <div style={{ marginTop: 10, fontSize: 11.5, color: "#9A6300", lineHeight: 1.55 }}>
              该活动尚未通过人工核验，信息可能不完整。
            </div>
          )}
          {v.trust === "conflict" && (
            <div style={{ marginTop: 10, fontSize: 11.5, color: "var(--danger)", lineHeight: 1.55 }}>
              多个来源之间存在信息冲突，请以官方页面为准。
            </div>
          )}
        </SideCard>

        <SideCard title="活动地点">
          <C.MapPlaceholder venue={v.venue} address={v.address} onShowMap={onShowMap} />
        </SideCard>

        <SideCard title={"信息来源" + (v.provenance.length ? "（" + v.provenance.length + "）" : "")}>
          {v.provenance.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {v.provenance.map((p, i) => <C.SourceRow key={i} item={p} />)}
            </div>
          ) : v.sourceUrl ? (
            <C.SourceRow item={{ source: v.organizer || "来源页面", title: v.title, url: v.sourceUrl, sourceTrust: "medium" }} />
          ) : (
            <div style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.6 }}>
              这条活动没有可追溯的来源链接 —— Gorgon 不会为它编造一个。
            </div>
          )}
        </SideCard>
      </div>
    );

    /* ── Main column ─────────────────────────────────────────────────── */

    return (
      <div className="gg-detail">
        {/* Desktop top bar — the mobile sheet's floating buttons are gone. */}
        <div className="gg-detail-bar">
          <button onClick={onBack} aria-label="返回"
            style={{
              display: "inline-flex", alignItems: "center", gap: 7, border: "1px solid var(--border-subtle)",
              background: "var(--surface-card)", borderRadius: "var(--radius-pill)", padding: "8px 15px",
              fontSize: 13, fontWeight: 600, color: "var(--text-body)", cursor: "pointer", fontFamily: "var(--font-sans)",
            }}>
            <i data-lucide="arrow-left" style={{ width: 16, height: 16 }} />返回
          </button>
          <div className="gg-detail-bar-title">{v.title}</div>
          <div className="gg-detail-bar-actions">
            <C.TrustChip status={v.trust} />
            <Button variant={synced ? "mint" : "primary"} size="sm" onClick={onSync}
              leadingIcon={<i data-lucide={synced ? "check" : "plus"} style={{ width: 15, height: 15 }} />}>
              {synced ? "已加入" : "加入我的周末"}
            </Button>
          </div>
        </div>

        <div className="gg-detail-scroll">
          <div className="gg-detail-2col">
            {/* ── LEFT / CENTER ─────────────────────────────────────── */}
            <div className="gg-detail-main">
              <div style={{ position: "relative" }}>
                <C.ActivityImage image={v.image} alt={v.title} ratio={ratio} radius="var(--radius-xl)">
                  <div style={{
                    position: "absolute", inset: 0,
                    background: "linear-gradient(180deg, rgba(12,13,18,0) 45%, rgba(12,13,18,0.55) 100%)",
                  }} />
                  <C.PlaceholderNote image={v.image} label={v.image.type === "placeholder" ? "暂无图片 · 分类占位图" : undefined} />
                  {v.tags.length > 0 && (
                    <div style={{ position: "absolute", left: 16, bottom: 14, display: "flex", gap: 7, flexWrap: "wrap", zIndex: 2 }}>
                      {v.tags.slice(0, 5).map((t) => <Tag key={t} tone="ink" size="sm">{t}</Tag>)}
                    </div>
                  )}
                </C.ActivityImage>
              </div>

              <header style={{ marginTop: 20 }}>
                <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 32, lineHeight: 1.22, letterSpacing: "-0.02em", color: "var(--text-strong)", margin: 0 }}>
                  {v.title}
                </h1>

                <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 13, flexWrap: "wrap" }}>
                  {v.finalScore != null && (
                    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 7 }}>
                      <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 26, color: "var(--brand)", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{v.finalScore}</span>
                      <span style={{ fontSize: 11.5, color: "var(--text-faint)" }}>推荐度</span>
                    </span>
                  )}
                  <C.TrustChip status={v.trust} />
                  {v.dataOrigin === "demo" && <C.ProviderBadge mode="demo" size="sm" />}
                  {v.locationText && (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 13, color: "var(--text-muted)" }}>
                      <i data-lucide="map-pin" style={{ width: 14, height: 14 }} />{v.locationText}
                    </span>
                  )}
                </div>

                {v.description && (
                  <p style={{ fontSize: 15, lineHeight: 1.75, color: "var(--text-body)", margin: "16px 0 0", maxWidth: 760 }}>
                    {v.description}
                  </p>
                )}

                {v.tags.length > 0 && (
                  <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 14 }}>
                    {v.tags.map((t) => <Tag key={t} size="sm" tone="neutral">{t}</Tag>)}
                  </div>
                )}
              </header>

              {facts}

              {v.reasons.length > 0 && (
                <Section title="为什么推荐">
                  <div className="gg-why-grid">
                    {v.reasons.map((r, i) => (
                      <div key={i} className="gg-why-item">
                        <i data-lucide="check" style={{ width: 15, height: 15, color: "var(--accent-strong, #00A277)", flex: "none", marginTop: 2 }} />
                        <span>{r}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 2 }}>
                    以上理由来自 Gorgon 的实际排序计算，不是预设文案。
                  </div>
                </Section>
              )}

              {v.description && (
                <Section title="活动介绍">
                  <p style={{ fontSize: 14.5, lineHeight: 1.8, color: "var(--text-body)", margin: 0, whiteSpace: "pre-wrap" }}>
                    {v.description}
                  </p>
                </Section>
              )}

              {v.agenda.length > 0 && (
                <Section title="活动流程">
                  <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                    {v.agenda.map((row, i) => (
                      <div key={i} style={{
                        display: "flex", gap: 16, padding: "11px 0",
                        borderTop: i === 0 ? "none" : "1px solid var(--border-subtle)",
                      }}>
                        <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 13.5, color: "var(--brand)", width: 118, flex: "none", fontVariantNumeric: "tabular-nums" }}>
                          {row.time || row.timeText || "时间待定"}
                        </span>
                        <span style={{ fontSize: 14, color: "var(--text-body)", lineHeight: 1.55 }}>{row.title || row.text || ""}</span>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {!v.description && (
                <Section title="活动介绍">
                  <div style={{ fontSize: 13.5, color: "var(--text-muted)", lineHeight: 1.7, padding: "14px 16px", borderRadius: "var(--radius-md)", background: "var(--bg-sunken)" }}>
                    来源页面没有提供活动介绍，Gorgon 不会替它写一段。
                    {v.sourceUrl && (<> 可以<a href={v.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: "var(--brand)", fontWeight: 600, marginLeft: 4 }}>查看原文</a>。</>)}
                  </div>
                </Section>
              )}
            </div>

            {/* ── RIGHT ────────────────────────────────────────────── */}
            {sidebar}
          </div>
        </div>

        {/* Mobile-only sticky actions (desktop uses the sidebar). */}
        <div className="gg-detail-mobilebar">
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>票价</div>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18, color: v.priceType === "free" ? "var(--accent-strong, #047857)" : "var(--text-strong)" }}>{v.priceLabel}</div>
          </div>
          <Button block variant={synced ? "mint" : "primary"} size="lg" onClick={onSync}
            leadingIcon={<i data-lucide={synced ? "check" : "plus"} style={{ width: 18, height: 18 }} />}
            style={{ flex: 1 }}>
            {synced ? "已加入我的周末" : "加入我的周末"}
          </Button>
        </div>
      </div>
    );
  }

  window.GorgonApp = Object.assign(window.GorgonApp || {}, { ActivityDetailScreen });
})();
