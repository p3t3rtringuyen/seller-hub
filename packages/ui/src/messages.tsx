"use client";
import { createContext, useContext, useMemo, type ReactNode } from "react";

// UX-22 / conventions §9: copy lives in data, not in JSX. These are the English defaults of the design system's
// own wording; an app overrides any key through <UiMessagesProvider messages={...}> (apps/web merges its catalogue).

export const defaultMessages = {
  "common.cancel": "Cancel",
  "common.close": "Close",
  "common.apply": "Apply",
  "common.retry": "Retry",
  "common.clear": "Clear",
  "common.save": "Save",
  "common.search": "Search",
  "common.noOptions": "No options",
  "common.selectAll": "Select all",
  "common.loading": "Loading",
  "grid.noRecords": "No records to display",
  "grid.total": "Total",
  "grid.rowsPerPage": "Rows per page",
  "grid.range": "{from}–{to} of {total}",
  "grid.previousPage": "Previous page",
  "grid.nextPage": "Next page",
  "grid.selectRow": "Select row",
  "grid.selectPage": "Select all rows on this page",
  "grid.selectionLimit": "You can select at most {max} rows.",
  "grid.selected": "{count} selected",
  "grid.previousPeriod": "vs {value}",
  "grid.columns": "Columns",
  "grid.columns.showAll": "Show all",
  "grid.columns.hideAll": "Hide all",
  "grid.columns.unpinAll": "Unpin all",
  "grid.columns.reset": "Reset order",
  "grid.columns.pinLeft": "Pin {column} left",
  "grid.columns.pinRight": "Pin {column} right",
  "grid.columns.moveUp": "Move {column} up",
  "grid.columns.moveDown": "Move {column} down",
  "grid.columns.toggle": "Show {column}",
  "grid.sortedAscending": "sorted ascending",
  "grid.sortedDescending": "sorted descending",
  "bulk.clear": "Clear selection",
  "bulk.irreversible": "This cannot be undone.",
  "bulk.working": "Working…",
  "filters.add": "Add filter",
  "filters.metric": "Metric",
  "filters.operator": "Condition",
  "filters.value": "Value",
  "filters.apply": "Apply filter",
  "filters.clearAll": "Clear all",
  "filters.op.gt": "greater than",
  "filters.op.gte": "at least",
  "filters.op.lt": "less than",
  "filters.op.lte": "at most",
  "filters.op.eq": "equal to",
  "dates.title": "Date range",
  "dates.from": "From",
  "dates.to": "To",
  "dates.compare": "Compare to another period",
  "dates.compareFrom": "Compare from",
  "dates.compareTo": "Compare to",
  "dates.preset.today": "Today",
  "dates.preset.yesterday": "Yesterday",
  "dates.preset.last7": "Last 7 days",
  "dates.preset.last14": "Last 14 days",
  "dates.preset.last30": "Last 30 days",
  "dates.preset.last90": "Last 90 days",
  "dates.preset.thisWeek": "This week",
  "dates.preset.lastWeek": "Last week",
  "dates.preset.thisMonth": "This month",
  "dates.preset.lastMonth": "Last month",
  "dates.preset.thisYear": "This year",
  "dates.preset.lifetime": "Life time",
  "dates.preset.custom": "Custom",
  "dates.timeZone": "Dates use the {zone} time zone.",
  "dates.endBeforeStart": "End date must not be before the start date.",
  "state.emptyTitle": "Nothing here yet",
  "state.errorTitle": "Something went wrong",
  "state.copyError": "Copy error content",
  "state.copied": "Copied",
  "state.status": "Status {status}",
  "toast.partial": "{ok} successful, {failed} failed",
  "toast.success": "{ok} successful",
  "toast.failed": "{failed} failed",
  "toast.details": "Details",
  "edit.edit": "Edit",
  "edit.notSaved": "Not saved",
  "edit.saving": "Saving…",
  "kpi.noData": "—",
  "chart.noData": "No data for this period",
  "chart.previous": "{series} (previous period)",
  "shell.skipToContent": "Skip to content",
  "shell.expandMenu": "Expand menu",
  "shell.collapseMenu": "Collapse menu",
  "shell.mainNavigation": "Main navigation",
  "shell.breadcrumbs": "Breadcrumbs",
  "shell.theme": "Theme",
  "shell.theme.light": "Light",
  "shell.theme.dark": "Dark",
  "shell.theme.system": "System",
  "shell.tenant": "Tenant",
  "shell.sellerAccount": "Seller account",
  "shell.marketplace": "Marketplace",
  "shell.switching": "Switching…",
  "shell.noAccess": "You do not have access to this page.",
  "shell.accessLoading": "Checking your access…",
} as const;

export type MessageKey = keyof typeof defaultMessages;
export type UiMessages = Record<MessageKey, string>;

const MessagesContext = createContext<Partial<UiMessages>>({});

export function UiMessagesProvider({
  messages,
  children,
}: {
  messages: Partial<Record<string, string>>;
  children: ReactNode;
}) {
  return (
    <MessagesContext.Provider value={messages as Partial<UiMessages>}>
      {children}
    </MessagesContext.Provider>
  );
}

export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

export function format(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, name: string) =>
    name in vars ? String(vars[name]) : m,
  );
}

export function useMessages(): Translate {
  const overrides = useContext(MessagesContext);
  return useMemo<Translate>(
    () => (key, vars) => format(overrides[key] ?? defaultMessages[key], vars),
    [overrides],
  );
}
