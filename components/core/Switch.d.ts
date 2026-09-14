import * as React from "react";

export interface SwitchProps {
  /** On/off state. @default false */
  checked?: boolean;
  /** Called with the next boolean. */
  onChange?: (next: boolean) => void;
  disabled?: boolean;
  /** Size. @default "md" */
  size?: "sm" | "md";
  style?: React.CSSProperties;
}

/** Toggle switch — turns mint when on. */
export function Switch(props: SwitchProps): JSX.Element;
