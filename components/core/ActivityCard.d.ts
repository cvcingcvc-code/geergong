import * as React from "react";

export type CategoryKey = "sport" | "music" | "art" | "food" | "outdoor" | "study";

export interface ActivityCardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "onSync"> {
  /** Activity title. */
  title?: string;
  /** Category (drives the accent color + label). @default "music" */
  category?: CategoryKey;
  /** Date label, e.g. "周六 6.15". */
  date?: string;
  /** Time label, e.g. "19:30". */
  time?: string;
  /** Location label, e.g. "上海·静安". */
  location?: string;
  /** Distance label, e.g. "2.1km". */
  distance?: string | null;
  /** Price label; "免费" renders in mint. @default "免费" */
  price?: string;
  /** Cover image URL; falls back to a category-tinted gradient. */
  image?: string | null;
  /** Metadata chips. */
  tags?: string[];
  /** Synced state — flips the button to mint "已同步". @default false */
  synced?: boolean;
  /** Show a 热门 (hot) flag. @default false */
  hot?: boolean;
  /** Called with next synced boolean when the sync button is pressed. */
  onSync?: (next: boolean) => void;
  /** Horizontal compact row layout. @default false */
  compact?: boolean;
}

/**
 * Signature Gorgon activity card.
 * @startingPoint section="App" subtitle="The feed's activity card" viewport="380x420"
 */
export function ActivityCard(props: ActivityCardProps): JSX.Element;
