import * as React from "react";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Field label. */
  label?: React.ReactNode;
  /** Helper or error text below the field. */
  hint?: React.ReactNode;
  /** Leading icon node. */
  leadingIcon?: React.ReactNode;
  /** Error state. @default false */
  invalid?: boolean;
}

/** Labeled text input with indigo focus ring. */
export function Input(props: InputProps): JSX.Element;
