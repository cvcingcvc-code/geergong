// Gorgon — unified responsive primitives (PHASE 4.1).
//
// WHY THIS EXISTS
//   `window.innerWidth` checks must not be scattered across screens. Every
//   layout decision that cannot be expressed in CSS goes through the single
//   `useResponsive()` hook defined here, which is backed by `matchMedia`
//   (the same source of truth as the media queries in responsive.css).
//
// SINGLE SOURCE OF TRUTH FOR BREAKPOINTS
//   Mobile   < 768px
//   Tablet   768px – 1199px
//   Desktop  >= 1200px
//
// `responsive.css` owns sizing/spacing/columns. This file only answers
// "which shell am I in?" so the app renders ONE component tree with the
// right chrome (phone frame vs. sidebar + header).
(function () {
  var MQ_TABLET = "(min-width: 768px)";
  var MQ_DESKTOP = "(min-width: 1200px)";
  var MQ_LANDSCAPE = "(orientation: landscape)";

  var BREAKPOINTS = {
    mobileMax: 767,
    tabletMin: 768,
    tabletMax: 1199,
    desktopMin: 1200,
  };

  /** Subscribe to a media query. Uses the modern API, falls back to the
   *  deprecated one for older WebKit builds. */
  function useMediaQuery(query) {
    var React = window.React;
    var ref = React.useRef(null);

    var read = function () {
      if (ref.current && typeof ref.current.matches === "boolean") return ref.current.matches;
      if (typeof window.matchMedia !== "function") return false;
      ref.current = window.matchMedia(query);
      return ref.current.matches;
    };

    var pair = React.useState(read);
    var matches = pair[0];
    var setMatches = pair[1];

    React.useEffect(function () {
      if (typeof window.matchMedia !== "function") return undefined;
      var mql = window.matchMedia(query);
      ref.current = mql;
      setMatches(mql.matches);
      var onChange = function (e) { setMatches(!!e.matches); };
      if (mql.addEventListener) {
        mql.addEventListener("change", onChange);
        return function () { mql.removeEventListener("change", onChange); };
      }
      mql.addListener(onChange);
      return function () { mql.removeListener(onChange); };
    }, [query]);

    return matches;
  }

  /** The one hook every screen/shell uses. */
  function useResponsive() {
    var tabletUp = useMediaQuery(MQ_TABLET);
    var desktopUp = useMediaQuery(MQ_DESKTOP);
    var landscape = useMediaQuery(MQ_LANDSCAPE);

    var isMobile = !tabletUp;
    var isTablet = tabletUp && !desktopUp;
    var isDesktop = desktopUp;

    // No resize listener here on purpose: useMediaQuery already re-renders
    // exactly when a breakpoint is crossed, so the app never re-renders on
    // every pixel of a drag-resize.
    return {
      isMobile: isMobile,
      isTablet: isTablet,
      isDesktop: isDesktop,
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
  function currentBreakpoint() {
    if (typeof window.matchMedia !== "function") return "unknown";
    if (window.matchMedia(MQ_DESKTOP).matches) return "desktop";
    if (window.matchMedia(MQ_TABLET).matches) return "tablet";
    return "mobile";
  }

  window.GorgonResponsive = {
    useResponsive: useResponsive,
    useMediaQuery: useMediaQuery,
    currentBreakpoint: currentBreakpoint,
    BREAKPOINTS: BREAKPOINTS,
    QUERIES: { tablet: MQ_TABLET, desktop: MQ_DESKTOP },
  };
})();
