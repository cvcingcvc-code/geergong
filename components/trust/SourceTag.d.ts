import * as React from "react";

export interface SourceTagProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  /** Source name, e.g. a WeChat account or venue site. */
  source?: string;
  /** Original listing URL. */
  href?: string;
  /** Leading Lucide icon name. @default "link" */
  icon?: string;
}

/** Linkable source-attribution chip for aggregated listings. */
export function SourceTag(props: SourceTagProps): JSX.Element;
