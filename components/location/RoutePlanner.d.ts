import * as React from "react";

export type TransitMode = "metro" | "bus" | "bike" | "walk" | "drive" | "taxi";

export interface TransitOption {
  /** Travel mode (drives the icon). */
  mode: TransitMode;
  /** Primary line / label, e.g. "地铁 13 号线". */
  line?: string;
  /** Secondary detail, e.g. "江宁路站 2 号口步行 5 分钟". */
  detail?: string;
  /** ETA string, e.g. "18 分钟". */
  time: string;
  /** Optional cost label, e.g. "¥4". */
  cost?: string;
  /** Highlight this option as recommended. */
  recommended?: boolean;
}

export interface RoutePlannerProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Origin label. @default "我的位置" */
  from?: string;
  /** Destination venue label. */
  venue?: string;
  /** Straight-line distance label, e.g. "2.0km". */
  distance?: string;
  /** Transit options to list. */
  transit?: TransitOption[];
  /** Called when "用导航软件打开" is tapped (open a MapAppSheet). */
  onNavigate?: () => void;
}

/** From→venue route planner with transit options and a navigate hand-off button. */
export function RoutePlanner(props: RoutePlannerProps): JSX.Element;
