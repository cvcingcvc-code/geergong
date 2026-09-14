// Gorgon — Activity detail.
(function(){
const { Tag, Avatar, Button, CategoryDot, VerifiedBadge, SourceTag, TrustBanner, FreshnessLabel, ReportSheet, RoutePlanner, MapAppSheet } = window.GorgonDesignSystem_56aa78;
const _CATS = window.GorgonDesignSystem_56aa78.CATEGORIES;

function InfoLine({ icon, label, children }) {
  return (
    <div style={{ display: "flex", gap: 11, alignItems: "flex-start" }}>
      <i data-lucide={icon} style={{ width: 17, height: 17, color: "var(--text-muted)", flex: "none", marginTop: 2 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", fontWeight: 500 }}>{label}</span>
        <div style={{ fontSize: "var(--text-base)", color: "var(--text-strong)", fontWeight: 600, marginTop: 2 }}>{children}</div>
      </div>
    </div>
  );
}

function MetaRow({ icon, label, value, accent }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <span style={{ width: 38, height: 38, borderRadius: "var(--radius-sm)", background: "var(--bg-sunken)", display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
        <i data-lucide={icon} style={{ width: 18, height: 18, color: "var(--brand)" }} />
      </span>
      <div>
        <div style={{ fontSize: 11.5, color: "var(--text-muted)", fontWeight: 500 }}>{label}</div>
        <div style={{ fontSize: 14.5, color: accent || "var(--text-strong)", fontWeight: 700, fontFamily: "var(--font-sans)" }}>{value}</div>
      </div>
    </div>
  );
}

function ActivityDetailScreen({ activity, synced, onSync, onBack }) {
  const a = activity;
  const cat = _CATS[a.category];
  const [reportOpen, setReportOpen] = React.useState(false);
  const [navOpen, setNavOpen] = React.useState(false);
  const u = (window.GORGON_DATA && window.GORGON_DATA.user) || {};
  const transit = a.transit || [];
  const full = a.spotsLeft === 0;
  const trust = a.trust || (a.host ? "verified" : "aggregated");
  const bannerState = trust === "verified" || trust === "official" ? "confirmed" : "unverified";
  const cover = { background: `linear-gradient(150deg, color-mix(in oklch, ${cat.color} 90%, #fff) 0%, color-mix(in oklch, ${cat.color} 60%, var(--indigo-800)) 100%)` };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ flex: 1, overflowY: "auto", scrollbarWidth: "none" }}>
        {/* Hero */}
        <div style={{ position: "relative", height: 300, ...cover }}>
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(12,13,18,0.30) 0%, rgba(12,13,18,0) 30%, rgba(12,13,18,0.55) 100%)" }} />
          <div style={{ position: "absolute", top: 14, left: 16, right: 16, display: "flex", justifyContent: "space-between" }}>
            <button onClick={onBack} style={{ width: 42, height: 42, borderRadius: "50%", border: "none", background: "rgba(255,255,255,0.92)", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer", backdropFilter: "blur(6px)" }}>
              <i data-lucide="arrow-left" style={{ width: 20, height: 20, color: "var(--ink)" }} />
            </button>
            <div style={{ display: "flex", gap: 8 }}>
              <button style={{ width: 42, height: 42, borderRadius: "50%", border: "none", background: "rgba(255,255,255,0.92)", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                <i data-lucide="share-2" style={{ width: 19, height: 19, color: "var(--ink)" }} />
              </button>
              <button style={{ width: 42, height: 42, borderRadius: "50%", border: "none", background: "rgba(255,255,255,0.92)", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                <i data-lucide="heart" style={{ width: 19, height: 19, color: "var(--ink)" }} />
              </button>
            </div>
          </div>
          <div style={{ position: "absolute", bottom: 16, left: 18, display: "flex", gap: 7 }}>
            <Tag tone="ink" dotColor={cat.color}>{cat.label}</Tag>
            {a.hot && <Tag tone="danger">🔥 热门</Tag>}
            <Tag tone="ink">{a.distance} 内</Tag>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: "20px 20px 16px", display: "flex", flexDirection: "column", gap: 18 }}>
          <div>
            <TrustBanner state={bannerState} action={bannerState === "unverified" ? "查看来源" : undefined} style={{ marginBottom: 14 }} />
            <h1 style={{ fontSize: 25, fontWeight: 800, fontFamily: "var(--font-sans)", color: "var(--text-strong)", lineHeight: 1.25, letterSpacing: "-0.01em" }}>{a.title}</h1>
            <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 12 }}>
              <Avatar name={a.host} size="sm" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-strong)" }}>{a.host}</span>
                  <VerifiedBadge level={trust} size="sm" />
                </div>
                <div style={{ marginTop: 4 }}>
                  <FreshnessLabel time={a.updated || "3 小时前"} confirmed={bannerState === "confirmed"} />
                </div>
              </div>
              <Button variant="secondary" size="sm">关注</Button>
            </div>
            <div style={{ marginTop: 12 }}>
              <SourceTag source={a.source || "Gorgon 官方"} href="#" />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, padding: "16px 0", borderTop: "1px solid var(--border-subtle)", borderBottom: "1px solid var(--border-subtle)" }}>
            <MetaRow icon="calendar" label="日期" value={a.date} />
            <MetaRow icon="clock" label="时间" value={`${a.time}–${a.end}`} />
            <MetaRow icon="map-pin" label="地点" value={a.venue} />
            <MetaRow icon="ticket" label="票价" value={a.price} accent={a.price === "免费" ? "var(--accent-strong)" : null} />
          </div>

          <div>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text-strong)", marginBottom: 8 }}>关于这场活动</h3>
            <p style={{ fontSize: 14.5, lineHeight: 1.7, color: "var(--text-body)" }}>{a.desc}</p>
            <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 12 }}>
              {a.tags.map((t) => <Tag key={t} tone="neutral" size="sm">#{t}</Tag>)}
            </div>
          </div>

          {/* Capacity */}
          {a.capacity != null && (
            <div style={{ padding: "14px 16px", borderRadius: "var(--radius-md)", background: "var(--bg-sunken)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 9 }}>
                <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text-strong)" }}>报名名额</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: full ? "var(--danger)" : a.spotsLeft <= 5 ? "var(--warning)" : "var(--accent-strong)" }}>
                  {full ? "已满" : `仅剩 ${a.spotsLeft} 个名额`}
                </span>
              </div>
              <div style={{ height: 8, borderRadius: 999, background: "var(--slate-200)", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${Math.round((a.going / a.capacity) * 100)}%`, background: full ? "var(--danger)" : "var(--grad-sync)", borderRadius: 999 }} />
              </div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 7, fontVariantNumeric: "tabular-nums" }}>{a.going} / {a.capacity} 人已报名</div>
            </div>
          )}

          {/* Need to know */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text-strong)" }}>参加须知</h3>
            {a.bring && a.bring.length > 0 && (
              <InfoLine icon="backpack" label="需要携带">
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 5 }}>
                  {a.bring.map((b) => <Tag key={b} tone="brand" size="sm">{b}</Tag>)}
                </div>
              </InfoLine>
            )}
            {a.notes && <InfoLine icon="info" label="温馨提示"><span style={{ fontWeight: 500, color: "var(--text-body)", lineHeight: 1.6 }}>{a.notes}</span></InfoLine>}
            {a.refund && <InfoLine icon="rotate-ccw" label="退款政策"><span style={{ fontWeight: 500, color: "var(--text-body)", lineHeight: 1.6 }}>{a.refund}</span></InfoLine>}
            {a.contact && <InfoLine icon="message-circle" label="联系方式"><span style={{ fontWeight: 500, color: "var(--text-body)" }}>{a.contact}</span></InfoLine>}
          </div>

          {/* Location + route */}
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text-strong)" }}>到达方式</h3>
              <span style={{ fontFamily: "var(--font-display)", fontSize: 12.5, fontWeight: 600, color: "var(--brand)", fontVariantNumeric: "tabular-nums" }}>距你 {a.distance}</span>
            </div>

            {a.address && (
              <div style={{ display: "flex", gap: 9, alignItems: "flex-start", padding: "11px 13px", borderRadius: "var(--radius-md)", background: "var(--bg-sunken)", marginBottom: 12 }}>
                <i data-lucide="map-pin" style={{ width: 17, height: 17, color: "var(--accent-strong)", flex: "none", marginTop: 1 }} />
                <span style={{ fontSize: 13.5, color: "var(--text-body)", lineHeight: 1.5 }}>{a.address}</span>
              </div>
            )}

            {/* Map snippet */}
            <div style={{ height: 128, borderRadius: "var(--radius-lg)", position: "relative", overflow: "hidden", background: "linear-gradient(135deg,#e8ebf3,#dde3ef)", border: "1px solid var(--border-subtle)", marginBottom: 14 }}>
              <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(var(--slate-200) 1px,transparent 1px),linear-gradient(90deg,var(--slate-200) 1px,transparent 1px)", backgroundSize: "26px 26px", opacity: 0.7 }} />
              <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-100%)" }}>
                <span style={{ width: 30, height: 30, borderRadius: "50% 50% 50% 0", background: "var(--brand)", transform: "rotate(-45deg)", display: "inline-flex", alignItems: "center", justifyContent: "center", boxShadow: "var(--shadow-md)" }}>
                  <i data-lucide="map-pin" style={{ width: 15, height: 15, color: "#fff", transform: "rotate(45deg)" }} />
                </span>
              </div>
              <div style={{ position: "absolute", bottom: 10, left: 12, fontSize: 13, fontWeight: 600, color: "var(--text-body)", background: "rgba(255,255,255,0.9)", padding: "5px 10px", borderRadius: "var(--radius-pill)" }}>{a.venue}</div>
            </div>

            {transit.length > 0 && (
              <RoutePlanner
                from={`我的位置 · ${u.campus || "上海"}`}
                venue={a.venue}
                distance={a.distance}
                transit={transit}
                onNavigate={() => setNavOpen(true)}
              />
            )}
          </div>

          {/* Going */}
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ display: "flex" }}>
              {["阿哲", "Mei", "Lin", "周"].map((n, i) => (
                <span key={n} style={{ marginLeft: i ? -10 : 0 }}><Avatar name={n} size="sm" style={{ boxShadow: "0 0 0 2px var(--surface-card)" }} /></span>
              ))}
            </div>
            <div style={{ fontSize: 13.5, color: "var(--text-body)" }}><b style={{ color: "var(--text-strong)" }}>{a.going} 人</b> 已加入</div>
          </div>

          {/* Report error */}
          <button onClick={() => setReportOpen(true)} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", border: "1px solid var(--border-subtle)", background: "var(--surface-card)", borderRadius: "var(--radius-md)", padding: "12px", cursor: "pointer", color: "var(--text-muted)", fontFamily: "var(--font-sans)", fontWeight: 600, fontSize: 13.5 }}>
            <i data-lucide="flag" style={{ width: 16, height: 16 }} />信息有误?报错反馈
          </button>
        </div>
      </div>

      <ReportSheet open={reportOpen} onClose={() => setReportOpen(false)} />
      <MapAppSheet open={navOpen} onClose={() => setNavOpen(false)} venue={a.venue} coord={a.coord} />
      {/* Sticky CTA */}
      <div style={{ flex: "none", padding: "14px 20px 22px", borderTop: "1px solid var(--border-subtle)", background: "var(--surface-card)", display: "flex", alignItems: "center", gap: 14 }}>
        <div>
          <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>票价</div>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 22, color: a.price === "免费" ? "var(--accent-strong)" : "var(--text-strong)" }}>{a.price}</div>
        </div>
        <Button block variant={synced ? "mint" : "primary"} size="lg" onClick={onSync}
          leadingIcon={<i data-lucide={synced ? "check" : "calendar-plus"} style={{ width: 18, height: 18 }} />}
          style={{ flex: 1 }}>
          {synced ? "已同步到我的周末" : "同步到我的周末"}
        </Button>
      </div>
    </div>
  );
}

window.GorgonApp = Object.assign(window.GorgonApp || {}, { ActivityDetailScreen });
})();
