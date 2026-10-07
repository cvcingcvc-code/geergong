// Gorgon V1 — Lucide icons as REAL React components.
//
// The legacy app renders icons as `<i data-lucide="name">` and lets the
// window.lucide runtime swap them for <svg> nodes after the fact. That swap
// mutates DOM React does not own — the exact mechanism behind the earlier
// `removeChild` reconciliation crash (see district-picker.jsx's comment in
// the legacy app).
//
// The V1 build renders every icon through this component instead: the SVG
// is owned by React from the first frame, `window.lucide` is gone, and
// icons come from the lucide-react npm package. Callers keep the legacy
// kebab-case name, so migrating a screen is a mechanical
// `<i data-lucide="x" style={s}/>` -> `<Icon name="x" style={s}/>`.

import React from "react";
import {
  ArrowLeft, BadgeCheck, BatteryFull, Bell, Calendar, CalendarHeart, Check,
  Clock, Compass, ExternalLink, FlaskConical, GitMerge, Globe, Heart,
  HeartOff, Hexagon, ImageOff, Info, LocateFixed, Map, MapPin, MapPinOff,
  Navigation, Plus, PlugZap, Search, SearchX, Settings, Share2, ShieldAlert,
  Signal, SlidersHorizontal, Sparkles, Ticket, TrendingUp, TriangleAlert,
  Users, Wifi,
} from "lucide-react";

const ICONS = {
  "arrow-left": ArrowLeft,
  "badge-check": BadgeCheck,
  "battery-full": BatteryFull,
  "bell": Bell,
  "calendar": Calendar,
  "calendar-heart": CalendarHeart,
  "check": Check,
  "clock": Clock,
  "compass": Compass,
  "external-link": ExternalLink,
  "flask-conical": FlaskConical,
  "git-merge": GitMerge,
  "globe": Globe,
  "heart": Heart,
  "heart-off": HeartOff,
  "hexagon": Hexagon,
  "image-off": ImageOff,
  "info": Info,
  "locate-fixed": LocateFixed,
  "map": Map,
  "map-pin": MapPin,
  "map-pin-off": MapPinOff,
  "navigation": Navigation,
  "plus": Plus,
  "plug-zap": PlugZap,
  "search": Search,
  "search-x": SearchX,
  "settings": Settings,
  "share-2": Share2,
  "shield-alert": ShieldAlert,
  "signal": Signal,
  "sliders-horizontal": SlidersHorizontal,
  "sparkles": Sparkles,
  "ticket": Ticket,
  "trending-up": TrendingUp,
  "triangle-alert": TriangleAlert,
  "users": Users,
  "wifi": Wifi,
};

/**
 * <Icon name="map-pin" style={{ width: 14, height: 14, color: "..." }} />
 *
 * lucide-react renders a 24x24 stroke SVG that inherits currentColor;
 * width/height/color passed through `style` reproduce the legacy look
 * exactly (the legacy <i data-lucide> carried the same inline styles).
 */
export function Icon({ name, style, size }) {
  const Cmp = ICONS[name];
  if (!Cmp) {
    // An unknown icon is a developer error, but a missing glyph must never
    // take a screen down — render nothing and say so in the console.
    if (typeof console !== "undefined" && console.warn) {
      console.warn("[Icon] unknown lucide icon:", name);
    }
    return null;
  }
  return <Cmp size={size || 24} style={style} aria-hidden="true" />;
}
