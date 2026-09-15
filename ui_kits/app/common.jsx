// Gorgon — shared presentational atoms (PHASE 5).
//
// These are the pieces the search results, the detail page, Discover and My
// Weekend all need, implemented ONCE so the three surfaces cannot drift.
//
// Design rules baked in here:
//   * every image sits in a fixed aspect-ratio box and uses object-fit:cover,
//     lazy loading and a broken-image fallback — a dead URL can never collapse
//     a card;
//   * the DEMO / REAL badge is a component, not a copy-paste, so no screen can
//     forget to declare where its data came from;
//   * a placeholder image is ALWAYS labelled, never dressed up as source art.
(function () {
  const { Tag } = window.GorgonDesignSystem_56aa78;
  const V = window.GorgonActivityView;

  const PLACEHOLDER_BASE = V.PLACEHOLDER_BASE;

  /* ── Image with a guaranteed fallback ────────────────────────────── */

  function ActivityImage({ image, alt, ratio, radius, style, children }) {
    const [stage, setStage] = React.useState(image && image.url ? 0 : 2);
    const urlRef = React.useRef(image && image.url);

    React.useEffect(() => {
      if (image && image.url !== urlRef.current) {
        urlRef.current = image && image.url;
        setStage(image && image.url ? 0 : 2);
      }
    }, [image && image.url]);

    const box = {
      position: "relative",
      aspectRatio: ratio || "16 / 10",
      borderRadius: radius || "var(--radius-md)",
      overflow: "hidden",
      background: "var(--bg-sunken)",
      flex: "none",
      ...style,
    };

    // stage 0 = source image · 1 = category placeholder · 2 = neutral fill
    if (stage === 0 && image && image.url) {
      return (
        <div style={box}>
          <img
            src={image.url}
            alt={alt || ""}
            loading="lazy"
            decoding="async"
            onError={() => setStage(1)}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
          {children}
        </div>
      );
    }

    if (stage <= 1) {
      const slug = V.placeholderSlug([alt, (image && image.slug) || ""]);
      const fallback = (image && image.type === "placeholder" && image.url)
        ? image.url
        : PLACEHOLDER_BASE + slug + ".svg";
      return (
        <div style={box}>
          <img
            src={fallback}
            alt={alt || ""}
            loading="lazy"
            decoding="async"
            onError={() => setStage(2)}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
          {children}
        </div>
      );
    }

    return (
      <div style={{ ...box, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--grad-brand)" }}>
        <i data-lucide="image-off" style={{ width: 26, height: 26, color: "rgba(255,255,255,0.9)" }} />
        {children}
      </div>
    );
  }

  /** Small corner marker so a placeholder never passes as real artwork. */
  function PlaceholderNote({ image, label }) {
    if (!image || image.type !== "placeholder") return null;
    return (
      <span style={{
        position: "absolute", left: 8, bottom: 8, zIndex: 2,
        display: "inline-flex", alignItems: "center", gap: 5,
        background: "rgba(12,13,18,0.66)", color: "#fff",
        fontSize: 10, fontWeight: 600, letterSpacing: "0.02em",
        padding: "3px 8px", borderRadius: "var(--radius-pill)",
      }}>
        <i data-lucide="image-off" style={{ width: 11, height: 11 }} />
        {label || "暂无图片"}
      </span>
    );
  }

  /* ── Trust state ─────────────────────────────────────────────────── */

  const TRUST_ICON = { confirmed: "badge-check", pending: "shield-alert", conflict: "triangle-alert" };
  const TRUST_STYLE = {
    confirmed: { bg: "var(--success-soft)", fg: "var(--accent-strong, #047857)", bd: "transparent" },
    pending: { bg: "var(--warning-soft)", fg: "#9A6300", bd: "transparent" },
    conflict: { bg: "var(--danger-soft)", fg: "var(--danger)", bd: "transparent" },
  };

  function TrustChip({ status, size, withIcon }) {
    const s = TRUST_STYLE[status] || TRUST_STYLE.pending;
    const sm = size === "sm";
    return (
      <span style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        background: s.bg, color: s.fg, border: "1px solid " + s.bd,
        fontSize: sm ? 10.5 : 12, fontWeight: 700,
        padding: sm ? "2px 8px" : "4px 10px", borderRadius: "var(--radius-pill)",
        whiteSpace: "nowrap",
      }}>
        {withIcon !== false && <i data-lucide={TRUST_ICON[status] || TRUST_ICON.pending} style={{ width: sm ? 11 : 13, height: sm ? 11 : 13 }} />}
        {V.trustLabel(status)}
      </span>
    );
  }

  /* ── Honest data-origin badge ────────────────────────────────────── */

  const MODE_STYLE = {
    real: { bg: "var(--success-soft)", fg: "var(--accent-strong, #047857)", label: "REAL SEARCH", icon: "globe" },
    hybrid: { bg: "var(--brand-soft)", fg: "var(--brand)", label: "HYBRID", icon: "git-merge" },
    demo: { bg: "var(--warning-soft)", fg: "#9A6300", label: "DEMO DATA", icon: "flask-conical" },
  };

  function ProviderBadge({ mode, size }) {
    const s = MODE_STYLE[mode] || MODE_STYLE.demo;
    const sm = size === "sm";
    return (
      <span title={mode === "real" ? "结果来自真实网页检索" : "结果来自本地演示数据"}
        style={{
          display: "inline-flex", alignItems: "center", gap: 5,
          background: s.bg, color: s.fg,
          fontSize: sm ? 9.5 : 10.5, fontWeight: 800, letterSpacing: "0.06em",
          padding: sm ? "2px 7px" : "4px 9px", borderRadius: "var(--radius-sm)",
          whiteSpace: "nowrap",
        }}>
        <i data-lucide={s.icon} style={{ width: sm ? 11 : 12, height: sm ? 11 : 12 }} />
        {s.label}
      </span>
    );
  }

  /* ── Core-info tile (detail page: 时间 / 地点 / 票价 / 主办方) ─────── */

  function MetaTile({ icon, label, value, sub, accent }) {
    return (
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6 }}>
          <i data-lucide={icon} style={{ width: 15, height: 15, color: "var(--brand)" }} />
          <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-faint)", letterSpacing: "0.04em" }}>{label}</span>
        </div>
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 16, color: accent || "var(--text-strong)", lineHeight: 1.35, overflowWrap: "anywhere" }}>
          {value || "待定"}
        </div>
        {sub && <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3, lineHeight: 1.5 }}>{sub}</div>}
      </div>
    );
  }

  /* ── Provenance row (detail: 信息来源) ─────────────────────────────── */

  const TRUST_TONE = { high: "高可信", medium: "中可信", low: "低可信" };

  function SourceRow({ item, onOpen }) {
    const url = V.resolveUrl(item.url);
    const trusted = TRUST_TONE[item.sourceTrust] || "中可信";
    const tone = item.sourceTrust === "high" ? "var(--accent-strong, #047857)"
      : item.sourceTrust === "low" ? "var(--text-muted)" : "#9A6300";
    return (
      <div style={{
        padding: "13px 14px", borderRadius: "var(--radius-md)",
        border: "1px solid var(--border-subtle)", background: "var(--surface-card)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-strong)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {item.source || "未标注来源"}
          </span>
          <span style={{ flex: "none", fontSize: 10.5, fontWeight: 700, color: tone }}>{trusted}</span>
        </div>
        <div style={{ fontSize: 12.5, color: "var(--text-body)", lineHeight: 1.5, marginBottom: 8 }}>
          {item.title || "（来源未提供标题）"}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {url ? (
            <a href={url} target="_blank" rel="noopener noreferrer"
              style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 700, color: "var(--brand)", textDecoration: "none" }}>
              <i data-lucide="external-link" style={{ width: 13, height: 13 }} />查看原文
            </a>
          ) : (
            <span style={{ fontSize: 12, color: "var(--text-faint)" }}>来源未提供链接</span>
          )}
          {item.retrievedAt && (
            <span style={{ fontSize: 11, color: "var(--text-faint)" }}>抓取于 {String(item.retrievedAt).slice(0, 10)}</span>
          )}
        </div>
      </div>
    );
  }

  /* ── Map placeholder (no route provider yet — say so) ─────────────── */

  function MapPlaceholder({ venue, address, onShowMap }) {
    return (
      <div>
        <div style={{
          height: 168, borderRadius: "var(--radius-lg)", position: "relative", overflow: "hidden",
          background: "linear-gradient(135deg,#e8ebf3,#dde3ef)", border: "1px solid var(--border-subtle)",
        }}>
          <div style={{
            position: "absolute", inset: 0,
            backgroundImage: "linear-gradient(var(--slate-200) 1px,transparent 1px),linear-gradient(90deg,var(--slate-200) 1px,transparent 1px)",
            backgroundSize: "26px 26px", opacity: 0.7,
          }} />
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 7 }}>
            <i data-lucide="map-pin" style={{ width: 26, height: 26, color: "var(--brand)" }} />
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", color: "var(--text-faint)" }}>MAP PLACEHOLDER</span>
          </div>
        </div>
        {venue && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-strong)" }}>{venue}</div>
            {address && <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 3, lineHeight: 1.5 }}>{address}</div>}
          </div>
        )}
        <div style={{ marginTop: 10, fontSize: 12, color: "var(--text-faint)", lineHeight: 1.55 }}>
          {onShowMap ? (
            <button onClick={onShowMap} style={{
              display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid var(--border-subtle)",
              background: "var(--surface-card)", borderRadius: "var(--radius-pill)", padding: "7px 13px",
              fontSize: 12.5, fontWeight: 600, color: "var(--text-body)", cursor: "pointer", fontFamily: "var(--font-sans)",
            }}>
              <i data-lucide="map" style={{ width: 14, height: 14 }} />在地图中查看
            </button>
          ) : (
            <span>地图能力尚未接入。</span>
          )}
        </div>
        <div style={{ marginTop: 6, fontSize: 11.5, color: "var(--text-faint)", lineHeight: 1.55 }}>
          交通时间尚未计算 —— Gorgon 目前没有接入路线服务，不会给出预估通勤时间。
        </div>
      </div>
    );
  }

  /* ── Empty / notice block ────────────────────────────────────────── */

  function NoticeBlock({ icon, title, body, tone, action }) {
    const bg = tone === "warning" ? "var(--warning-soft)" : tone === "danger" ? "var(--danger-soft)" : "var(--bg-sunken)";
    const fg = tone === "warning" ? "#9A6300" : tone === "danger" ? "var(--danger)" : "var(--text-muted)";
    return (
      <div style={{ padding: "18px 18px", borderRadius: "var(--radius-lg)", background: bg, display: "flex", gap: 13, alignItems: "flex-start" }}>
        <i data-lucide={icon} style={{ width: 20, height: 20, color: fg, flex: "none", marginTop: 1 }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 14.5, color: "var(--text-strong)" }}>{title}</div>
          {body && <div style={{ fontSize: 13, color: "var(--text-body)", lineHeight: 1.65, marginTop: 5, overflowWrap: "anywhere" }}>{body}</div>}
          {action && <div style={{ marginTop: 11 }}>{action}</div>}
        </div>
      </div>
    );
  }

  window.GorgonCommon = {
    ActivityImage, PlaceholderNote, TrustChip, ProviderBadge, MetaTile, SourceRow,
    MapPlaceholder, NoticeBlock,
  };
})();
