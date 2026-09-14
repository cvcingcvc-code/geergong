import * as React from "react";

export interface StatBlockProps extends React.HTMLAttributes<HTMLDivElement> {
  /** The large figure (number, price, time, distance). */
  value: React.ReactNode;
  /** Caption under the figure. */
  label: React.ReactNode;
  /** Optional sub-caption. */
  sub?: React.ReactNode;
  /** Figure color. @default "ink" */
  accent?: "ink" | "brand" | "mint";
  /** Alignment. @default "start" */
  align?: "start" | "center";
}

/** Display-figure stat block for counts, prices, times, distances. */
export function StatBlock(props: StatBlockProps): JSX.Element;
