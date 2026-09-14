import * as React from "react";

export interface SearchFieldProps extends React.HTMLAttributes<HTMLDivElement> {
  placeholder?: string;
  value?: string;
  onChange?: React.ChangeEventHandler<HTMLInputElement>;
  /** Size. @default "md" */
  size?: "md" | "lg";
}

/**
 * Pill search field — the discovery entry point.
 * @startingPoint section="Core" subtitle="Search & primitives" viewport="700x140"
 */
export function SearchField(props: SearchFieldProps): JSX.Element;
