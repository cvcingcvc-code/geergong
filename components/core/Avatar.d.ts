import * as React from "react";

export interface AvatarProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Image URL. Falls back to initials if absent. */
  src?: string | null;
  /** Display name (used for initials + alt). */
  name?: string;
  /** Size. @default "md" */
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  /** Show a brand ring around the avatar. @default false */
  ring?: boolean;
}

/** User avatar with image or initials fallback. */
export function Avatar(props: AvatarProps): JSX.Element;
