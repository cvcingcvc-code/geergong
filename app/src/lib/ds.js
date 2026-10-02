// Gorgon V1 — design-system bridge.
//
// The legacy app builds window.GorgonDesignSystem_56aa78 at RUNTIME by
// fetching the component sources and Babel-transforming them in the browser
// (_ds_bundle.js). The V1 build cannot do that (no Babel Standalone), so it
// imports the SAME untouched component sources directly — Vite compiles
// them at build time. This module is the single import site, so every
// screen pulls DS primitives from here.
//
// Two components (SearchField, ActivityCard) contain `<i data-lucide>`
// placeholders that only the legacy window.lucide runtime can render. The
// screens import their build-safe copies from src/components/ds/ instead —
// see that folder's header comment for why they are vendored rather than
// edited in place.

export { Button } from "../../../components/core/Button.jsx";
export { IconButton } from "../../../components/core/IconButton.jsx";
export { Tag } from "../../../components/core/Tag.jsx";
export { Avatar } from "../../../components/core/Avatar.jsx";
export { Badge } from "../../../components/core/Badge.jsx";
export { Input } from "../../../components/core/Input.jsx";
export { SegmentedControl } from "../../../components/core/SegmentedControl.jsx";
export { StatBlock } from "../../../components/core/StatBlock.jsx";
export { Switch } from "../../../components/core/Switch.jsx";
export { CategoryDot, CATEGORIES } from "../../../components/core/CategoryDot.jsx";
