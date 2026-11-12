"use client";
import { useMemo, useState } from "react";
import { DataGrid, type DataGridProps } from "../datagrid/DataGrid";
import { InlineEditCell } from "../datagrid/InlineEditCell";
import { emptyColumnState } from "../datagrid/columnState";
import type { ColumnState, GridColumn, GridSort } from "../datagrid/types";
import { entities, type DemoEntity, type DemoRow } from "./entities";

export interface DemoGridProps {
  entity: DemoEntity["id"];
  status?: "loading" | "ready" | "error";
  pageSize?: number;
  totalRows?: number;
  compare?: boolean;
  selectable?: boolean;
  maxSelection?: number;
  rowCount?: number;
  showTotals?: boolean;
  initialColumnState?: ColumnState;
  onLimitReached?: (max: number) => void;
  toolbar?: DataGridProps<DemoRow>["toolbar"];
  bulkBar?: (selected: ReadonlySet<string>, clear: () => void) => DataGridProps<DemoRow>["bulkBar"];
  emptyTitle?: string;
  density?: "compact" | "comfortable";
  /** Column ids that wrap (clamped to 2 lines) instead of truncating. */
  wrapColumnIds?: string[];
  /** Render the Budget / Bid column with the real InlineEditCell. */
  inlineEdit?: boolean;
  initialPageIndex?: number;
  /** Total unknown (first load, before any answer). */
  unknownTotal?: boolean;
}

/** A stateful harness around DataGrid: owns page, sort, selection and column state like a real screen would. */
export function DemoGrid({
  entity,
  status = "ready",
  pageSize: initialPageSize = 25,
  totalRows = 312,
  compare = false,
  selectable = false,
  maxSelection,
  rowCount,
  showTotals = true,
  initialColumnState = emptyColumnState,
  onLimitReached,
  toolbar,
  bulkBar,
  emptyTitle,
  density = "comfortable",
  wrapColumnIds = [],
  inlineEdit = false,
  initialPageIndex = 0,
  unknownTotal = false,
}: DemoGridProps) {
  const def = entities[entity];
  const [page, setPage] = useState({ pageIndex: initialPageIndex, pageSize: initialPageSize });
  const [sort, setSort] = useState<GridSort | null>(null);
  const [columnState, setColumnState] = useState<ColumnState>(initialColumnState);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const rows = useMemo(() => {
    const n =
      rowCount ?? Math.min(page.pageSize, Math.max(0, totalRows - page.pageIndex * page.pageSize));
    const made = def.makeRows(n, page.pageIndex * page.pageSize);
    if (!sort) return made;
    const dir = sort.desc ? -1 : 1;
    return [...made].sort((a, b) => {
      const x = a[sort.id];
      const y = b[sort.id];
      return (
        (typeof x === "number" && typeof y === "number"
          ? x - y
          : String(x).localeCompare(String(y))) * dir
      );
    });
  }, [def, page, rowCount, sort, totalRows]);
  const columns = useMemo<GridColumn<DemoRow>[]>(
    () =>
      def.columns.map((c) => {
        let col = c;
        if (wrapColumnIds.includes(c.id)) col = { ...col, wrap: true, skeletonLines: 2 };
        if (inlineEdit && (c.id === "budget" || c.id === "bid")) {
          col = {
            ...col,
            cell: (r) => (
              <InlineEditCell
                ariaLabel={c.header}
                display={`$${Number(r[c.id]).toFixed(2)}`}
                value={String(r[c.id])}
                kind="money"
                onSave={async () => undefined}
              />
            ),
          };
        }
        return col;
      }),
    [def, wrapColumnIds, inlineEdit],
  );
  const totals = useMemo(() => def.totals(rows), [def, rows]);

  return (
    <DataGrid<DemoRow>
      label={def.label}
      columns={columns}
      density={density}
      rows={rows}
      getRowId={(r) => r.id}
      status={status}
      page={page}
      totalRows={unknownTotal ? undefined : (rowCount ?? totalRows)}
      onPageChange={setPage}
      sort={sort}
      onSortChange={setSort}
      columnState={columnState}
      onColumnStateChange={setColumnState}
      showTotals={showTotals}
      totals={totals}
      compare={compare}
      {...(selectable
        ? {
            selection: {
              selected,
              onChange: setSelected,
              ...(maxSelection ? { max: maxSelection } : {}),
              ...(onLimitReached ? { onLimitReached } : {}),
            },
          }
        : {})}
      {...(toolbar ? { toolbar } : {})}
      {...(bulkBar ? { bulkBar: bulkBar(selected, () => setSelected(new Set())) } : {})}
      {...(emptyTitle ? { emptyTitle } : {})}
      error={{
        message: "The report could not be loaded.",
        status: 503,
        details: "request-id: demo-1234",
      }}
      onRetry={() => undefined}
    />
  );
}
