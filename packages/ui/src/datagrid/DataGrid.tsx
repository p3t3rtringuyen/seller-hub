"use client";
import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import Tooltip from "@mui/material/Tooltip";
import { getCoreRowModel, useReactTable, type ColumnDef, type Header } from "@tanstack/react-table";
import { useMemo, type CSSProperties, type ReactNode } from "react";
import { EmptyState } from "../feedback/EmptyState";
import { ErrorCard } from "../feedback/ErrorCard";
import { useMessages } from "../messages";
import { grid, type Density } from "../tokens";
import { ColumnChooser } from "./ColumnChooser";
import { emptyColumnState, pinningFor, visibleIds } from "./columnState";
import { DeltaBadge } from "./DeltaBadge";
import { GridPagination } from "./GridPagination";
import { SkeletonMark } from "./GridSkeleton";
import { TruncatedText } from "./TruncatedText";
import type {
  ColumnState,
  CompareValue,
  GridColumn,
  GridSelection,
  GridSort,
  PageState,
} from "./types";

export interface DataGridError {
  message: string;
  status?: string | number;
  details?: string;
}

export interface DataGridProps<Row> {
  /** Accessible name of the table (entity tab). */
  label: string;
  columns: readonly GridColumn<Row>[];
  rows: readonly Row[];
  getRowId: (row: Row) => string;
  status: "loading" | "ready" | "error";
  error?: DataGridError;
  onRetry?: () => void;

  page: PageState;
  /** Known total across pages; may stay undefined only before the first answer. */
  totalRows?: number | undefined;
  pageSizeOptions?: readonly number[];
  onPageChange: (next: PageState) => void;

  sort?: GridSort | null;
  onSortChange?: (next: GridSort | null) => void;

  columnState?: ColumnState;
  onColumnStateChange?: (next: ColumnState) => void;

  selection?: GridSelection;

  /** Total row: present while loading (label + bars) and when ready (`totals` by column id). */
  showTotals?: boolean;
  totals?: Readonly<Record<string, ReactNode>>;
  totalsCompare?: Readonly<Record<string, CompareValue>>;
  totalLabel?: string;

  /** Compare mode: every row grows a second line with the previous period. */
  compare?: boolean;
  density?: Density;

  /** Static toolbar parts (filters, date range, search); rendered at once, loading or not. */
  toolbar?: ReactNode;
  /** Rendered under the toolbar when rows are selected. */
  bulkBar?: ReactNode;
  /** Specific per screen: "Nothing has been changed in this period." */
  emptyTitle?: string;
  emptyDescription?: string;
  /** Scroll-area max height (px); the header sticks. */
  maxHeight?: number;
}

const cellPad = grid.cellPaddingX;

interface ColMeta {
  def: GridColumn<never>;
}

/**
 * The one data table (UX-02..UX-12, UX-22). Server-side paging, sorting and filtering are the caller's: it passes the
 * current page of rows and reacts to `onPageChange` / `onSortChange`. Loading draws a skeleton of the *same* table:
 * same columns, widths, alignment, row height, header, toolbar, totals row and pager; the rows count equals
 * `pageSize`; nothing changes size when data arrives (UX-04).
 */
export function DataGrid<Row>(props: DataGridProps<Row>) {
  const t = useMessages();
  const {
    columns,
    rows,
    getRowId,
    status,
    page,
    totalRows,
    sort,
    selection,
    showTotals,
    totals,
    totalsCompare,
    compare = false,
    density = "comfortable",
  } = props;
  const columnState = props.columnState ?? emptyColumnState;
  const loading = status === "loading";
  const rowHeight = (compare ? grid.compareRowHeight : grid.rowHeight)[density];
  const selectable = Boolean(selection);

  const tanColumns = useMemo<ColumnDef<Row>[]>(
    () =>
      columns.map((c) => ({
        id: c.id,
        header: c.header,
        size: c.width,
        minSize: grid.minColumnWidth,
        enableSorting: Boolean(c.sortable),
        enableHiding: c.hideable !== false,
        enablePinning: c.pinnable !== false,
        accessorFn: () => null,
        meta: { def: c } satisfies ColMeta,
      })),
    [columns],
  );
  const visible = visibleIds(columns, columnState);
  const hiddenIds = columns.filter((c) => !visible.includes(c.id)).map((c) => c.id);

  const table = useReactTable<Row>({
    data: rows as Row[],
    columns: tanColumns,
    getRowId,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    manualPagination: true,
    state: {
      sorting: sort ? [{ id: sort.id, desc: sort.desc }] : [],
      columnVisibility: Object.fromEntries(hiddenIds.map((id) => [id, false])),
      columnOrder: visible,
      columnPinning: pinningFor(columns, columnState),
    },
  });

  const leafColumns = table.getVisibleLeafColumns();
  const selW = selectable ? grid.selectionWidth : 0;
  const tableWidth = selW + leafColumns.reduce((n, c) => n + c.getSize(), 0);
  const pageIds = rows.map(getRowId);
  const selectedOnPage = selection ? pageIds.filter((id) => selection.selected.has(id)).length : 0;

  const stickyStyle = (columnId: string | null, z: number): CSSProperties => {
    if (columnId === null) return { position: "sticky", left: 0, zIndex: z };
    const col = table.getColumn(columnId);
    const pin = col?.getIsPinned();
    if (!col || !pin) return {};
    return pin === "left"
      ? { position: "sticky", left: selW + col.getStart("left"), zIndex: z }
      : { position: "sticky", right: col.getAfter("right"), zIndex: z };
  };

  const toggleSelection = (id: string) => {
    if (!selection) return;
    const next = new Set(selection.selected);
    if (next.has(id)) next.delete(id);
    else if (selection.max !== undefined && next.size >= selection.max) {
      selection.onLimitReached?.(selection.max);
      return;
    } else next.add(id);
    selection.onChange(next);
  };
  const togglePage = () => {
    if (!selection) return;
    const next = new Set(selection.selected);
    if (selectedOnPage === pageIds.length && pageIds.length > 0) {
      for (const id of pageIds) next.delete(id);
    } else {
      for (const id of pageIds) {
        if (next.has(id)) continue;
        if (selection.max !== undefined && next.size >= selection.max) {
          selection.onLimitReached?.(selection.max);
          break;
        }
        next.add(id);
      }
    }
    selection.onChange(next);
  };

  const nextSort = (id: string) => {
    if (!props.onSortChange) return;
    if (sort?.id !== id) props.onSortChange({ id, desc: false });
    else if (!sort.desc) props.onSortChange({ id, desc: true });
    else props.onSortChange(null);
  };

  const dataRowCount = status === "loading" ? page.pageSize : rows.length;
  const colSpan = leafColumns.length + (selectable ? 1 : 0);

  const renderHeader = (header: Header<Row, unknown>) => {
    const def = (header.column.columnDef.meta as ColMeta).def;
    const sorted = sort?.id === def.id ? (sort.desc ? "descending" : "ascending") : "none";
    const label_ = (
      <TruncatedText text={def.header}>
        {def.header}
        {sorted !== "none" ? (
          <span aria-hidden="true">{sorted === "ascending" ? " ▲" : " ▼"}</span>
        ) : null}
      </TruncatedText>
    );
    const inner = def.sortable ? (
      <button
        type="button"
        onClick={() => nextSort(def.id)}
        style={{ all: "unset", cursor: "pointer", display: "block", width: "100%", minWidth: 0 }}
        aria-label={
          sorted === "none"
            ? def.header
            : `${def.header}, ${t(sorted === "ascending" ? "grid.sortedAscending" : "grid.sortedDescending")}`
        }
      >
        {label_}
      </button>
    ) : (
      label_
    );
    return (
      <Box
        component="th"
        key={header.id}
        scope="col"
        data-col-id={def.id}
        data-align="left"
        aria-sort={sorted}
        sx={{
          bgcolor: "background.paper",
          borderBottom: 1,
          borderColor: "divider",
          fontWeight: 600,
          textAlign: "left",
        }}
        style={{
          height: grid.headerHeight,
          padding: `0 ${cellPad}px`,
          boxSizing: "border-box",
          textAlign: "left",
          top: 0,
          ...stickyStyle(def.id, 3),
          position: "sticky",
        }}
      >
        {def.headerTooltip ? (
          <Tooltip title={def.headerTooltip} placement="top-start">
            <span style={{ display: "block", minWidth: 0 }}>{inner}</span>
          </Tooltip>
        ) : (
          inner
        )}
      </Box>
    );
  };

  const bodyCell = (def: GridColumn<Row>, content: ReactNode, key: string, skeleton = false) => {
    const pinStyle = stickyStyle(def.id, 1);
    return (
      <Box
        component="td"
        key={key}
        data-col-id={def.id}
        data-align={def.numeric && !def.exempt ? "numeric" : "left"}
        sx={{
          bgcolor: "background.paper",
          borderBottom: 1,
          borderColor: "divider",
          verticalAlign: "middle",
        }}
        style={{
          height: rowHeight,
          padding: `0 ${cellPad}px`,
          boxSizing: "border-box",
          textAlign: def.numeric && !def.exempt ? "right" : "left",
          ...pinStyle,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: def.numeric && !def.exempt ? "flex-end" : "flex-start",
            gap: 2,
            minWidth: 0,
            height: "100%",
          }}
          data-cell={skeleton ? "skeleton" : "value"}
        >
          {content}
        </div>
      </Box>
    );
  };

  const skeletonFor = (def: GridColumn<Row>) => {
    const shape = def.skeleton ?? (def.numeric ? "number" : "text");
    return (
      <>
        <SkeletonMark shape={shape} lines={def.wrap ? (def.skeletonLines ?? 2) : 1} />
        {compare && def.compareCell ? <SkeletonMark shape="number" /> : null}
      </>
    );
  };

  const valueFor = (def: GridColumn<Row>, row: Row) => {
    const text = def.text?.(row);
    const cmp = compare ? def.compareCell?.(row) : null;
    const node = def.cell(row);
    const align = def.numeric && !def.exempt ? "right" : "left";
    return (
      <>
        {def.exempt ? (
          node
        ) : (
          <TruncatedText text={text} wrap={def.wrap ?? false} align={align}>
            {node}
          </TruncatedText>
        )}
        {cmp ? (
          <TruncatedText
            align={align}
            text={`${t("grid.previousPeriod", { value: cmp.previous })} ${cmp.delta ?? ""}`}
          >
            <Box component="span" sx={{ color: "text.secondary", fontSize: 12 }}>
              {t("grid.previousPeriod", { value: cmp.previous })}{" "}
              <DeltaBadge
                {...(cmp.delta ? { delta: cmp.delta } : {})}
                {...(cmp.direction ? { direction: cmp.direction } : {})}
                {...(cmp.good !== undefined ? { good: cmp.good } : {})}
              />
            </Box>
          </TruncatedText>
        ) : null}
      </>
    );
  };

  const selectionCell = (key: string, node: ReactNode, head = false) => (
    <Box
      component={head ? "th" : "td"}
      key={key}
      data-part="selection"
      sx={{
        bgcolor: "background.paper",
        borderBottom: 1,
        borderColor: "divider",
        textAlign: "center",
      }}
      style={{
        width: grid.selectionWidth,
        height: head ? grid.headerHeight : rowHeight,
        padding: 0,
        boxSizing: "border-box",
        ...stickyStyle(null, head ? 4 : 2),
        ...(head ? { top: 0, position: "sticky" } : {}),
      }}
    >
      {node}
    </Box>
  );

  const totalLabelFirstId = leafColumns[0]?.id;

  return (
    <Box
      data-testid="datagrid"
      data-state={status}
      data-density={density}
      data-compare={compare ? "on" : "off"}
      sx={{
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
        bgcolor: "background.paper",
        overflow: "hidden",
      }}
    >
      <Box
        data-part="toolbar"
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          p: 1,
          minHeight: 52,
          flexWrap: "wrap",
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flex: 1, flexWrap: "wrap" }}>
          {props.toolbar}
        </Box>
        {props.onColumnStateChange ? (
          <ColumnChooser
            columns={columns as readonly GridColumn<never>[]}
            state={columnState}
            onChange={props.onColumnStateChange}
          />
        ) : null}
      </Box>
      {props.bulkBar}
      <Box
        data-part="scroll"
        sx={{ overflow: "auto", ...(props.maxHeight ? { maxHeight: props.maxHeight } : {}) }}
      >
        <table
          aria-label={props.label}
          aria-busy={loading}
          data-part="table"
          style={{
            tableLayout: "fixed",
            borderCollapse: "separate",
            borderSpacing: 0,
            width: tableWidth,
            minWidth: "100%",
          }}
        >
          <colgroup>
            {selectable ? (
              <col
                data-col-id="__select"
                data-col-width={grid.selectionWidth}
                style={{ width: grid.selectionWidth }}
              />
            ) : null}
            {leafColumns.map((c) => (
              <col
                key={c.id}
                data-col-id={c.id}
                data-col-width={c.getSize()}
                style={{ width: c.getSize() }}
              />
            ))}
          </colgroup>
          <thead data-part="header" style={{ height: grid.headerHeight }}>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {selectable
                  ? selectionCell(
                      "sel-h",
                      <Checkbox
                        size="small"
                        disabled={loading || pageIds.length === 0}
                        checked={pageIds.length > 0 && selectedOnPage === pageIds.length}
                        indeterminate={selectedOnPage > 0 && selectedOnPage < pageIds.length}
                        onChange={togglePage}
                        inputProps={{ "aria-label": t("grid.selectPage") }}
                      />,
                      true,
                    )
                  : null}
                {hg.headers.map(renderHeader)}
              </tr>
            ))}
          </thead>
          <tbody data-part="body">
            {status === "error" ? (
              <tr data-part="error-row">
                <td colSpan={colSpan} style={{ padding: 12 }}>
                  <ErrorCard
                    message={props.error?.message ?? ""}
                    {...(props.error?.status !== undefined ? { status: props.error.status } : {})}
                    {...(props.error?.details ? { details: props.error.details } : {})}
                    {...(props.onRetry ? { onRetry: props.onRetry } : {})}
                  />
                </td>
              </tr>
            ) : status === "ready" && rows.length === 0 ? (
              <tr data-part="empty-row">
                <Box
                  component="td"
                  colSpan={colSpan}
                  sx={{ borderBottom: 1, borderColor: "divider" }}
                  style={{ height: rowHeight, padding: 0 }}
                >
                  {props.emptyTitle || props.emptyDescription ? (
                    <EmptyState
                      title={props.emptyTitle ?? t("grid.noRecords")}
                      {...(props.emptyDescription ? { description: props.emptyDescription } : {})}
                    />
                  ) : (
                    <Box
                      role="status"
                      sx={{
                        position: "sticky",
                        left: 0,
                        width: "100%",
                        maxWidth: "100vw",
                        textAlign: "center",
                        color: "text.secondary",
                      }}
                    >
                      {t("grid.noRecords")}
                    </Box>
                  )}
                </Box>
              </tr>
            ) : (
              Array.from({ length: dataRowCount }, (_, i) => {
                const row = loading ? undefined : table.getRowModel().rows[i];
                const id = row?.id ?? `skeleton-${i}`;
                const checked = Boolean(row && selection?.selected.has(row.id));
                return (
                  <tr
                    key={id}
                    data-part={loading ? "skeleton-row" : "row"}
                    data-row-id={row?.id}
                    data-row-height={rowHeight}
                    aria-selected={selectable && !loading ? checked : undefined}
                    style={{ height: rowHeight }}
                  >
                    {selectable
                      ? selectionCell(
                          `${id}-sel`,
                          row ? (
                            <Checkbox
                              size="small"
                              checked={checked}
                              onChange={() => toggleSelection(row.id)}
                              inputProps={{ "aria-label": t("grid.selectRow") }}
                            />
                          ) : (
                            <SkeletonMark shape="checkbox" />
                          ),
                        )
                      : null}
                    {leafColumns.map((c) => {
                      const def = (c.columnDef.meta as ColMeta).def as unknown as GridColumn<Row>;
                      return row
                        ? bodyCell(def, valueFor(def, row.original), `${id}-${c.id}`)
                        : bodyCell(def, skeletonFor(def), `${id}-${c.id}`, true);
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
          {showTotals ? (
            <tfoot data-part="totals">
              <tr data-row-height={grid.totalsHeight} style={{ height: grid.totalsHeight }}>
                {selectable ? selectionCell("tot-sel", null) : null}
                {leafColumns.map((c) => {
                  const def = (c.columnDef.meta as ColMeta).def as unknown as GridColumn<Row>;
                  const isLabel = c.id === totalLabelFirstId;
                  const figure = totals?.[def.id];
                  const cmp = compare ? totalsCompare?.[def.id] : undefined;
                  const align = def.numeric ? "right" : "left";
                  return (
                    <Box
                      component="td"
                      key={c.id}
                      data-col-id={def.id}
                      data-align={def.numeric && !def.exempt ? "numeric" : "left"}
                      sx={{
                        bgcolor: "background.paper",
                        borderTop: 1,
                        borderColor: "divider",
                        fontWeight: 600,
                      }}
                      style={{
                        height: grid.totalsHeight,
                        padding: `0 ${cellPad}px`,
                        boxSizing: "border-box",
                        textAlign: align,
                        ...stickyStyle(def.id, 1),
                      }}
                    >
                      {isLabel && !def.hasTotal ? (
                        <TruncatedText>{props.totalLabel ?? t("grid.total")}</TruncatedText>
                      ) : def.hasTotal ? (
                        loading ? (
                          <div
                            style={{
                              display: "flex",
                              justifyContent: def.numeric ? "flex-end" : "flex-start",
                            }}
                          >
                            <SkeletonMark shape={def.numeric ? "number" : "text"} />
                          </div>
                        ) : (
                          <TruncatedText align={align}>
                            {figure}
                            {cmp ? (
                              <DeltaBadge
                                {...(cmp.delta ? { delta: cmp.delta } : {})}
                                {...(cmp.direction ? { direction: cmp.direction } : {})}
                                {...(cmp.good !== undefined ? { good: cmp.good } : {})}
                              />
                            ) : null}
                          </TruncatedText>
                        )
                      ) : null}
                    </Box>
                  );
                })}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </Box>
      <GridPagination
        pageIndex={page.pageIndex}
        pageSize={page.pageSize}
        totalRows={totalRows}
        loading={loading}
        {...(props.pageSizeOptions ? { pageSizeOptions: props.pageSizeOptions } : {})}
        onChange={props.onPageChange}
      />
      {selection ? (
        <Box
          role="status"
          aria-live="polite"
          data-visually-hidden
          sx={{
            position: "absolute",
            width: 1,
            height: 1,
            overflow: "hidden",
            clip: "rect(0 0 0 0)",
          }}
        >
          {t("grid.selected", { count: selection.selected.size })}
        </Box>
      ) : null}
    </Box>
  );
}
