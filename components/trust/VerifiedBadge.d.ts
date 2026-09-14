import * as React from "react";

export type TrustLevel = "verified" | "official" | "aggregated" | "unverified";

export interface VerifiedBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Trust level. @default "verified" */
  level?: TrustLevel;
  /** Size. @default "md" */
  size?: "sm" | "md";
  /** Show the text label next to the icon. @default true */
  showLabel?: boolean;
  /** Override the default level label. */
  label?: string;
}

/** Host/listing trust badge — verified (mint), official (indigo), aggregated (grey), unverified (amber). */
export function VerifiedBadge(props: VerifiedBadgeProps): JSX.Element;
