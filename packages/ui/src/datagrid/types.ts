import type { ReactNode } from "react";

/** Shape of the placeholder a cell draws while its data is in transit (UX-04). */
export type SkeletonShape = "text" | "number" | "checkbox" | "switch" | "disc" | "chip" | "none";

export interface CompareValue {
  /** Previous-period figure, already formatted. */
  previous: string;
  /** Change versus the previous period, already formatted ("+12.4%"); empty when not computable. */
  delta?: string;
  direction?: "up" | "down" | "flat";
  /** Whether the change is an improvement for this metric (cost going down is good). Drives colour only. */
  good?: boolean;
}

export interface GridColumn<Row> {
  id: string;
  /** Header text from the message catalogue. */
  header: string;
  /** Metric definition or column help; shown as a tooltip on the header. */
  headerTooltip?: string;
  /** Initial width in px. Skeleton and loaded rows read the same value. */
  width: number;
  /** Numeric: header aligned left like text; figures right-align with each other and with the Total (UX-03). */
  numeric?: boolean;
  /** A column that must wrap declares it; everything else truncates with ellipsis + tooltip (UX-02). */
  wrap?: boolean;
  sortable?: boolean;
  /** Default true. */
  hideable?: boolean;
  /** Default true. */
  pinnable?: boolean;
  /** Placeholder shape while loading. Default: `number` for numeric columns, `text` otherwise. */
  skeleton?: SkeletonShape;
  /** Bars drawn for a wrapping column while loading. */
  skeletonLines?: number;
  /** The Total row has a figure for this column (the Total row exists while loading, with bars). */
  hasTotal?: boolean;
  /** Cell holds an input (budget or bid editor): exempt from numeric alignment, keeps its own width (UX-03). */
  exempt?: boolean;
  cell: (row: Row) => ReactNode;
  /** Plain text of the cell, used for the truncation tooltip. */
  text?: (row: Row) => string;
  /** Compare mode: second line in the cell. */
  compareCell?: (row: Row) => CompareValue | null | undefined;
}

export type PinSide = "left" | "right";

/** User-saved column layout. The saved order wins; "Reset order" returns to the definition order (UX-10). */
export interface ColumnState {
  order: string[];
  hidden: string[];
  pinned: Record<string, PinSide>;
}

export interface GridSort {
  id: string;
  desc: boolean;
}

export interface GridSelection {
  /** Owner state is the source of truth; it survives paging (UX-11). */
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  /** Maximum enforced at tick time (campaigns 300, child tabs 100, export-selected 1000). */
  max?: number;
  onLimitReached?: (max: number) => void;
}

export interface PageState {
  pageIndex: number;
  pageSize: number;
}
