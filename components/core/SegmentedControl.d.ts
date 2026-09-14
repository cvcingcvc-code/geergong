import * as React from "react";

export interface SegmentedOption { value: string; label: React.ReactNode; }

export interface SegmentedControlProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange"> {
  /** Options as strings or {value,label} objects. */
  options: (string | SegmentedOption)[];
  /** Selected value. */
  value?: string;
  /** Called with the next value. */
  onChange?: (next: string) => void;
}

/** Pill segmented control for view/filter switching (本周末 / 下周末 / 全部). */
export function SegmentedControl(props: SegmentedControlProps): JSX.Element;
