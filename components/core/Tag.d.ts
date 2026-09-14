import * as React from "react";

export interface TagProps extends React.HTMLAttributes<HTMLSpanElement> {
  children?: React.ReactNode;
  /** Color tone. @default "neutral" */
  tone?: "neutral" | "brand" | "mint" | "warning" | "danger" | "solid" | "ink";
  /** Size. @default "md" */
  size?: "sm" | "md";
  /** Optional leading status dot color (e.g. a --cat-* value). */
  dotColor?: string | null;
  /** Optional leading icon node. */
  leadingIcon?: React.ReactNode;
}

/** Pill tag / chip for labels, filters, and metadata. */
export function Tag(props: TagProps): JSX.Element;
