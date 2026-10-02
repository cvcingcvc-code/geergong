// Gorgon — unified responsive primitives.
//
// Migrated from ui_kits/app/responsive.js (window.GorgonResponsive) to a
// standard ES module. Logic UNCHANGED — `window.innerWidth` checks must not
// be scattered across screens; every layout decision that cannot be
// expressed in CSS goes through the single `useResponsive()` hook, backed
// by `matchMedia` (the same source of truth as the media queries in
// responsive.css).
//
// SINGLE SOURCE OF TRUTH FOR BREAKPOINTS
//   Mobile   < 768px
//   Tablet   768px – 1199px
//   Desktop  >= 1200px

import React from "react";

const MQ_TABLET = "(min-width: 768px)";
const MQ_DESKTOP = "(min-width: 1200px)";
const MQ_LANDSCAPE = "(orientation: landscape)";

export const BREAKPOINTS = {
  mobileMax: 767,
  tabletMin: 768,
  tabletMax: 1199,
  desktopMin: 1200,
};

export const QUERIES = { tablet: MQ_TABLET, desktop: MQ_DESKTOP };

/** Subscribe to a media query. Uses the modern API, falls back to the
 *  deprecated one for older WebKit builds. */
export function useMediaQuery(query) {
  const ref = React.useRef(null);

  const read = () => {
    if (ref.current && typeof ref.current.matches === "boolean") return ref.current.matches;
    if (typeof window.matchMedia !== "function") return false;
    ref.current = window.matchMedia(query);
    return ref.current.matches;
  };

  const [matches, setMatches] = React.useState(read);

  React.useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const mql = window.matchMedia(query);
    ref.current = mql;
    setMatches(mql.matches);
    const onChange = (e) => setMatches(!!e.matches);
    if (mql.addEventListener) {
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    }
    mql.addListener(onChange);
    return () => mql.removeListener(onChange);
  }, [query]);

  return matches;
}

/** The one hook every screen/shell uses. */
export function useResponsive() {
  const tabletUp = useMediaQuery(MQ_TABLET);
  const desktopUp = useMediaQuery(MQ_DESKTOP);
  const landscape = useMediaQuery(MQ_LANDSCAPE);

  const isMobile = !tabletUp;
  const isTablet = tabletUp && !desktopUp;
  const isDesktop = desktopUp;

  // No resize listener here on purpose: useMediaQuery already re-renders
  // exactly when a breakpoint is crossed, so the app never re-renders on
  // every pixel of a drag-resize.
  return {
    isMobile,
    isTablet,
    isDesktop,
    /** tablet or desktop — i.e. "not the phone shell" */
    isWide: tabletUp,
    isLandscape: landscape,
    /** "mobile" | "tablet" | "desktop" — handy for E2E assertions */
    breakpoint: isDesktop ? "desktop" : isTablet ? "tablet" : "mobile",
    /** sidebar is compact (icon rail) only on tablet */
    compactSidebar: isTablet,
  };
}

/** Non-React read, for the rare imperative case (E2E helpers, logging). */
export function currentBreakpoint() {
  if (typeof window.matchMedia !== "function") return "unknown";
  if (window.matchMedia(MQ_DESKTOP).matches) return "desktop";
  if (window.matchMedia(MQ_TABLET).matches) return "tablet";
  return "mobile";
}
