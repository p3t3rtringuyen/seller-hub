import { grid, type Density } from "../tokens";

// Row height and skeleton row count are computed in one place from what the loaded table will contain, so the
// skeleton and the loaded rows can never disagree (UX-04: same row height, same row count, no layout shift).

/** Height of one wrapped text line in a cell (px). Wrapped text is clamped to a declared number of lines. */
export const LINE_HEIGHT = 18;
/** Vertical room around cell content (px): 6 + 6 padding and the 1 px row border. */
export const CELL_VERTICAL = 13;
/** Previous-period line shown under the figure in compare mode (px). */
export const COMPARE_LINE = 20;

/**
 * Row height. A grid without wrapping columns uses the density token (single-line rows; every control that can sit in
 * a cell — small checkbox, icon button, chip — is sized to fit it). A grid with wrapping columns budgets for the
 * declared number of lines, because the text is clamped to exactly that many lines (see TruncatedText `lines`).
 */
export function rowHeightFor(density: Density, compare: boolean, wrapLines: number): number {
  const base = (compare ? grid.compareRowHeight : grid.rowHeight)[density];
  if (wrapLines <= 1) return base;
  return Math.max(base, wrapLines * LINE_HEIGHT + (compare ? COMPARE_LINE : 0) + CELL_VERTICAL);
}

/**
 * Body rows to draw while loading: the rows the page will really have when the total is known (the last page of
 * 312 rows at page size 25 has 12), the page size before the first answer.
 */
export function skeletonRowCount(
  pageSize: number,
  pageIndex: number,
  totalRows: number | undefined,
): number {
  if (totalRows === undefined || totalRows < 1) return pageSize;
  const remaining = totalRows - pageIndex * pageSize;
  return Math.max(1, Math.min(pageSize, remaining));
}
