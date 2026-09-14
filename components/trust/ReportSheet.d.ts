import * as React from "react";

export interface ReportSheetProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Whether the sheet is shown. @default false */
  open?: boolean;
  /** Close handler (scrim tap / close button). */
  onClose?: () => void;
  /** Submit handler, called with the picked reason key. */
  onSubmit?: (reason: string | null) => void;
}

/**
 * Report-inaccurate-info bottom sheet (the community trust signal).
 * Mount inside a position:relative container (e.g. the phone frame).
 */
export function ReportSheet(props: ReportSheetProps): JSX.Element | null;
