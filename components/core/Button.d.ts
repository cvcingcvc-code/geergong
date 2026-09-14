import * as React from "react";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual style. @default "primary" */
  variant?: "primary" | "secondary" | "ghost" | "mint" | "inverse";
  /** Size. @default "md" */
  size?: "sm" | "md" | "lg";
  /** Full-width block button. @default false */
  block?: boolean;
  /** Disabled state. @default false */
  disabled?: boolean;
  /** Icon node rendered before the label. */
  leadingIcon?: React.ReactNode;
  /** Icon node rendered after the label. */
  trailingIcon?: React.ReactNode;
  children?: React.ReactNode;
}

/**
 * Gorgon primary action button.
 * @startingPoint section="Core" subtitle="Buttons in every variant & size" viewport="700x200"
 */
export function Button(props: ButtonProps): JSX.Element;
