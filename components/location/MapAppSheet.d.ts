import * as React from "react";

export interface MapApp {
  /** Provider key: amap | baidu | tencent | apple. */
  key: string;
  /** Display name. */
  name: string;
  /** Sub-label. */
  sub?: string;
  /** Brand color for the icon tile. */
  color: string;
  /** Lucide icon name. */
  icon: string;
}

export interface MapAppSheetProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Whether the sheet is shown. @default false */
  open?: boolean;
  /** Close handler (scrim / cancel). */
  onClose?: () => void;
  /** Destination coordinate { lng, lat }. */
  coord?: { lng?: number; lat?: number };
  /** Destination name. @default "目的地" */
  venue?: string;
  /** Override the default app list. */
  apps?: MapApp[];
}

/**
 * Map-app hand-off sheet — deep-links navigation to 高德 / 百度 / 腾讯 / Apple Maps.
 * Mount inside a position:relative container.
 */
export function MapAppSheet(props: MapAppSheetProps): JSX.Element | null;
