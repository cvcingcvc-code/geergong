import * as React from "react";

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Icon node (e.g. Lucide <i data-lucide="heart" />). */
  children?: React.ReactNode;
  /** Size. @default "md" */
  size?: "sm" | "md" | "lg";
  /** Visual style. @default "ghost" */
  variant?: "ghost" | "soft" | "outline" | "solid";
  /** Accessible label (also the title tooltip). */
  label?: string;
  /** Active/toggled state. @default false */
  active?: boolean;
}

/** Square icon-only button for toolbars, cards, and nav. */
export function IconButton(props: IconButtonProps): JSX.Element;
