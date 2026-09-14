import * as React from "react";

export type TrustState = "confirmed" | "unverified" | "changed" | "cancelled";

export interface TrustBannerProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Trust state. @default "confirmed" */
  state?: TrustState;
  /** Override the default title. */
  title?: string;
  /** Override the default description. */
  desc?: string;
  /** Optional inline action label (e.g. "查看来源"). */
  action?: string;
  /** Action handler. */
  onAction?: () => void;
}

/** Activity-header status banner: confirmed (mint), unverified/changed (amber), cancelled (coral). */
export function TrustBanner(props: TrustBannerProps): JSX.Element;
