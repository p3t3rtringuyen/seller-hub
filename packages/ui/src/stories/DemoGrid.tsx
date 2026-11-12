"use client";
import { useMemo, useState } from "react";
import { DataGrid, type DataGridProps } from "../datagrid/DataGrid";
import { emptyColumnState } from "../datagrid/columnState";
import type { ColumnState, GridSort } from "../datagrid/types";
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
}: DemoGridProps) {
  const def = entities[entity];
  const [page, setPage] = useState({ pageIndex: 0, pageSize: initialPageSize });
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
  const totals = useMemo(() => def.totals(rows), [def, rows]);

  return (
    <DataGrid<DemoRow>
      label={def.label}
      columns={def.columns}
      rows={rows}
      getRowId={(r) => r.id}
      status={status}
      page={page}
      totalRows={status === "loading" ? undefined : (rowCount ?? totalRows)}
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
