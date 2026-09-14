import * as React from "react";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  children?: React.ReactNode;
  /** Color tone. @default "brand" */
  tone?: "brand" | "mint" | "danger" | "amber" | "neutral";
  /** Render as a bare notification dot (ignores children). @default false */
  dot?: boolean;
}

/** Count / status badge, or a notification dot. */
export function Badge(props: BadgeProps): JSX.Element;
