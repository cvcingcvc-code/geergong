import * as React from "react";

export type CategoryKey = "sport" | "music" | "art" | "food" | "outdoor" | "study";

export interface CategoryDotProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Activity category. @default "sport" */
  category?: CategoryKey;
  /** Show the Chinese category label next to the dot. @default false */
  showLabel?: boolean;
  /** Dot diameter in px. @default 10 */
  size?: number;
}

/** Colored dot mapping an activity to its category hue (the brand's primary category signal). */
export function CategoryDot(props: CategoryDotProps): JSX.Element;
export const CATEGORIES: Record<CategoryKey, { color: string; label: string }>;
