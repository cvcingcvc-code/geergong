// Gorgon — 地区选择器 (Shanghai district picker).
//
// ONE control, used by Discover / Search / Map / 智能, so the three (four)
// surfaces cannot show three different districts. It renders as a pill —
// "上海 · 徐汇" — and opens a sheet listing 全上海 plus the districts that
// actually occur in the current dataset.
//
// The selection itself lives in App state (persisted through
// GorgonStore.setDistrict), NOT in here. This file never filters anything;
// it only reports a choice upward.
//
// Glyphs are inline SVG owned by React on purpose: a lucide `<i data-lucide>`
// is swapped for an `<svg>` by the icon library, and a node React does not
// own is exactly how the earlier `removeChild` crash happened.

(function () {
  var CHEVRON = ["m6 9 6 6 6-6"];
  var CHECK = ["M20 6 9 17l-5-5"];
  var X = ["M18 6 6 18", "m6 6 12 12"];

  /** Inline, React-owned glyph. `paths` is an array of `d` strings. */
  function Glyph({ paths, size, color, width }) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || "currentColor"}
        strokeWidth={width || 2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
        style={{ flex: "none", display: "block" }}>
        {paths.map(function (d, i) { return <path key={i} d={d} />; })}
      </svg>
    );
  }

  function PinGlyph({ size, color }) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || "currentColor"}
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
        style={{ flex: "none", display: "block" }}>
        <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
        <circle cx="12" cy="10" r="3" />
      </svg>
    );
  }

  /**
   * Renders children into <body>.
   *
   * NOT cosmetic: the sheet must escape its ancestors. On mobile the picker
   * lives inside the phone frame, which has `overflow: hidden` — that clips a
   * `position: fixed` descendant outright. On the map it lives inside the
   * legend row, which has its own `z-index` and therefore its own stacking
   * context, so the overlay would paint UNDER the map's search bar and bottom
   * card. A portal is the only thing that fixes both at once.
   */
  function Portal({ children }) {
    const RD = window.ReactDOM;
    if (!RD || !RD.createPortal || typeof document === "undefined" || !document.body) return children;
    return RD.createPortal(children, document.body);
  }

  /**
   * value      — current selection ("全上海" or a district name)
   * onChange   — (district) => void
   * activities — the CURRENT dataset (already keyword-filtered, NOT yet
   *              district-filtered): drives the option list and the per-district
   *              counts, so the sheet tells the truth before you click.
   * countOf    — optional (district) => number, when a screen can count more
   *              cheaply than by scanning `activities`.
   * showCounts — default true. Set false when there is no dataset yet (the
   *              smart screen before a search): a menu of zeros would read as
   *              "every district is empty", which is a claim we cannot make.
   * size       — "md" default, "sm" for tight headers.
   */
  function DistrictPicker({ value, onChange, activities, countOf, showCounts, size, align }) {
    const D = window.GorgonDistrict;
    const [open, setOpen] = React.useState(false);
    const withCounts = showCounts !== false;

    const list = React.useMemo(
      () => D.options(activities || [], value),
      [D, activities, value]
    );
    const counts = React.useMemo(() => D.counts(activities || []), [D, activities]);
    const total = (activities || []).length;
    const countFor = countOf || function (d) { return counts[d] || 0; };

    React.useEffect(() => {
      if (!open) return;
      const onKey = function (e) { if (e.key === "Escape") setOpen(false); };
      window.addEventListener("keydown", onKey);
      return function () { window.removeEventListener("keydown", onKey); };
    }, [open]);

    const small = size === "sm";
    const current = D.isAll(value) ? D.ALL : value;

    const choose = function (d) {
      setOpen(false);
      if (d !== value) onChange(d);
    };

    return (
      <span style={{ display: "inline-flex", minWidth: 0 }}>
        <button
          type="button"
          data-gg-region="district-picker"
          data-gg-district={value}
          aria-haspopup="dialog"
          aria-expanded={open ? "true" : "false"}
          aria-label={"地区筛选：" + D.label(value)}
          title="选择地区"
          onClick={() => setOpen(true)}
          style={{
            display: "inline-flex", alignItems: "center", gap: 7, minWidth: 0,
            border: "1px solid var(--border-subtle)", background: "var(--surface-card)",
            borderRadius: "var(--radius-pill)", cursor: "pointer",
            padding: small ? "6px 11px" : "8px 13px",
            boxShadow: "var(--shadow-sm)",
            fontFamily: "var(--font-sans)", fontWeight: 600,
            fontSize: small ? 12.5 : 13.5, color: "var(--text-body)",
            transition: "all var(--dur-fast) var(--ease-out)",
          }}>
          <PinGlyph size={small ? 13 : 15} color="var(--brand)" />
          <span className="gg-district-label" style={{ whiteSpace: "nowrap", minWidth: 0 }}>
            {"上海 · "}
            <b style={{ color: D.isAll(value) ? "var(--text-body)" : "var(--brand)", fontWeight: 700 }}>{current}</b>
          </span>
          <Glyph paths={CHEVRON} size={small ? 13 : 15} color="var(--text-faint)" />
        </button>

        {open && (
          <Portal>
          <div
            data-gg-region="district-sheet"
            onClick={() => setOpen(false)}
            style={{
              position: "fixed", inset: 0, zIndex: 60, background: "rgba(12,13,18,0.42)",
              display: "flex", alignItems: "center", justifyContent: "center", padding: 18,
            }}>
            <div
              role="dialog" aria-label="选择地区"
              onClick={(e) => e.stopPropagation()}
              style={{
                width: "min(420px, 100%)", maxHeight: "76vh", display: "flex", flexDirection: "column",
                background: "var(--surface-card)", borderRadius: "var(--radius-xl)",
                boxShadow: "var(--shadow-xl)", overflow: "hidden",
              }}>
              <div style={{ padding: "16px 18px 12px", display: "flex", alignItems: "flex-start", gap: 12, borderBottom: "1px solid var(--border-subtle)" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 17, color: "var(--text-strong)" }}>选择地区</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>
                    当前筛选：{D.label(value)}
                    {withCounts ? " · 共 " + total + " 场活动" : ""}
                  </div>
                </div>
                <div style={{ flex: 1 }} />
                <button type="button" onClick={() => setOpen(false)} aria-label="关闭"
                  style={{ flex: "none", width: 32, height: 32, borderRadius: "var(--radius-md)", border: "1px solid var(--border-subtle)", background: "var(--surface-card)", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "var(--text-muted)" }}>
                  <Glyph paths={X} size={16} />
                </button>
              </div>

              <div style={{ overflowY: "auto", padding: "8px 8px 10px" }}>
                {[D.ALL].concat(list).map(function (d) {
                  const on = d === current;
                  const n = D.isAll(d) ? total : countFor(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      data-gg-district-option={d}
                      data-gg-district-count={withCounts ? n : undefined}
                      aria-pressed={on ? "true" : "false"}
                      onClick={() => choose(d)}
                      style={{
                        width: "100%", display: "flex", alignItems: "center", gap: 10,
                        border: "none", cursor: "pointer", textAlign: "left",
                        background: on ? "var(--brand-soft)" : "transparent",
                        color: on ? "var(--brand-strong, var(--brand))" : "var(--text-body)",
                        fontFamily: "var(--font-sans)", fontWeight: on ? 700 : 500, fontSize: 14,
                        padding: "11px 12px", borderRadius: "var(--radius-md)",
                      }}>
                      <span style={{ width: 16, flex: "none", display: "inline-flex", color: "var(--brand)" }}>
                        {on ? <Glyph paths={CHECK} size={15} width={2.6} /> : null}
                      </span>
                      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {D.isAll(d) ? D.ALL : "上海 · " + d}
                      </span>
                      <span style={{ flex: 1 }} />
                      {withCounts && (
                        <span
                          data-gg-district-count-label={d}
                          style={{
                            flex: "none", fontVariantNumeric: "tabular-nums", fontSize: 12.5,
                            color: n > 0 ? "var(--text-muted)" : "var(--text-faint)",
                          }}>{n} 场</span>
                      )}
                    </button>
                  );
                })}
              </div>

              <div style={{ padding: "10px 18px 14px", borderTop: "1px solid var(--border-subtle)", fontSize: 11.5, color: "var(--text-faint)", lineHeight: 1.6 }}>
                只会显示所选区域内的活动，不会用其他区域的结果填充。
              </div>
            </div>
          </div>
          </Portal>
        )}
      </span>
    );
  }

  window.GorgonApp = Object.assign(window.GorgonApp || {}, { DistrictPicker });
})();
