import * as React from "react";

export interface FreshnessLabelProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Relative time string, e.g. "2 小时前". @default "刚刚" */
  time?: string;
  /** Show "主办方已确认" in mint instead of an update time. @default false */
  confirmed?: boolean;
}

/** Freshness / last-confirmed timestamp. */
export function FreshnessLabel(props: FreshnessLabelProps): JSX.Element;
