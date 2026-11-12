// @seller-hub/ui — the design system (ADR-0003). Source-only package; apps/web and Storybook import this barrel.
export * from "./tokens";
export { ThemeProvider, theme } from "./theme";
export * from "./messages";
export * from "./permissions";
export * from "./icons";

export * from "./fields/sanitize";
export { MoneyField, IntegerField, PercentField } from "./fields/NumericFields";
export type { MoneyFieldProps, PercentFieldProps } from "./fields/NumericFields";
export { SearchField } from "./fields/SearchField";
export type { SearchFieldProps } from "./fields/SearchField";
export { MultiSelect } from "./fields/MultiSelect";
export type { MultiSelectProps, SelectOption } from "./fields/MultiSelect";
export { StatusChip, toneFor } from "./fields/StatusChip";
export type { StatusChipProps, StatusTone } from "./fields/StatusChip";

export { EmptyState } from "./feedback/EmptyState";
export type { EmptyStateProps } from "./feedback/EmptyState";
export { ErrorCard } from "./feedback/ErrorCard";
export type { ErrorCardProps } from "./feedback/ErrorCard";
export { ToastProvider, useToast, useBulkResultToast } from "./feedback/Toast";
export type { ToastInput, BulkResult } from "./feedback/Toast";
export { ConfirmDialog, Modal } from "./feedback/Dialogs";
export type { ConfirmDialogProps, ModalProps } from "./feedback/Dialogs";

export * from "./datagrid/types";
export * from "./datagrid/columnState";
export { DataGrid } from "./datagrid/DataGrid";
export type { DataGridProps, DataGridError } from "./datagrid/DataGrid";
export { ColumnChooser } from "./datagrid/ColumnChooser";
export { BulkActionBar } from "./datagrid/BulkActionBar";
export type { BulkAction, BulkActionBarProps } from "./datagrid/BulkActionBar";
export { InlineEditCell } from "./datagrid/InlineEditCell";
export type { InlineEditCellProps } from "./datagrid/InlineEditCell";
export { FilterBar } from "./datagrid/FilterBar";
export type {
  FilterBarProps,
  MetricFilter,
  MetricFilterSpec,
  FilterOp,
  QuickChip,
} from "./datagrid/FilterBar";
export { GridPagination } from "./datagrid/GridPagination";
export { DeltaBadge } from "./datagrid/DeltaBadge";
export { TruncatedText } from "./datagrid/TruncatedText";
export { SkeletonMark } from "./datagrid/GridSkeleton";
export { describeGridShape, measureGridShape, findBareClips } from "./datagrid/shape";
export type { GridShape, MeasuredShape } from "./datagrid/shape";

export * from "./dates/dates";
export { DateRangeCompare, defaultPresets } from "./dates/DateRangeCompare";
export type { DateRangeCompareProps } from "./dates/DateRangeCompare";

export { KpiCard } from "./charts/KpiCard";
export type { KpiCardProps } from "./charts/KpiCard";
export { TimeSeriesChart } from "./charts/TimeSeriesChart";
export type { ChartPoint, ChartSeries, TimeSeriesChartProps } from "./charts/TimeSeriesChart";

export * from "./url/urlState";

export { AppShell } from "./shell/AppShell";
export type { AppShellProps, Crumb, ShellNavItem, ShellNavSection } from "./shell/AppShell";
export { ContextSwitcher } from "./shell/ContextSwitcher";
export type {
  ContextOption,
  ContextSwitcherProps,
  ShellContextOptions,
  ShellContextValue,
} from "./shell/ContextSwitcher";
export { ThemeToggle } from "./shell/ThemeToggle";
