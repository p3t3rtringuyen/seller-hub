// Probes for the two table rules we measure instead of argue about:
//  - UX-04: the skeleton of an entity tab has the same shape as its loaded state.
//  - UX-02: no text is clipped without an ellipsis.
// `describeGridShape` reads the sizes the grid writes on its elements (works in jsdom, which has no layout);
// `measureGridShape` reads real layout boxes (use it in a browser: Storybook, Playwright).

export interface GridShape {
  /** Columns in the colgroup (selection column included). */
  columnCount: number;
  columnIds: string[];
  columnWidths: number[];
  headerLabels: string[];
  /** `numeric` or `left`, per data column, from the header row's body twin. */
  alignments: string[];
  /** Body rows (skeleton or data). */
  rowCount: number;
  rowHeights: number[];
  hasToolbar: boolean;
  hasTotals: boolean;
  totalsHeight: number | null;
  hasPagination: boolean;
  headerHeight: number | null;
}

const num = (v: string | null | undefined): number => (v ? Number(v) : Number.NaN);

export function describeGridShape(root: HTMLElement): GridShape {
  const grid = root.matches('[data-testid="datagrid"]')
    ? root
    : root.querySelector<HTMLElement>('[data-testid="datagrid"]');
  if (!grid) throw new Error("no datagrid in the given root");
  const cols = [...grid.querySelectorAll<HTMLElement>("colgroup > col")];
  const rows = [
    ...grid.querySelectorAll<HTMLElement>(
      'tbody > tr[data-part="row"], tbody > tr[data-part="skeleton-row"]',
    ),
  ];
  const firstRow = rows[0];
  const totals = grid.querySelector<HTMLElement>('[data-part="totals"] tr');
  const headerRow = grid.querySelector<HTMLElement>('thead[data-part="header"]');
  return {
    columnCount: cols.length,
    columnIds: cols.map((c) => c.dataset.colId ?? ""),
    columnWidths: cols.map((c) => num(c.dataset.colWidth)),
    headerLabels: [...grid.querySelectorAll<HTMLElement>("thead th[data-col-id]")].map(
      (th) => th.textContent?.trim() ?? "",
    ),
    alignments: firstRow
      ? [...firstRow.querySelectorAll<HTMLElement>("td[data-col-id]")].map(
          (td) => td.dataset.align ?? "",
        )
      : [],
    rowCount: rows.length,
    rowHeights: rows.map((r) => num(r.dataset.rowHeight)),
    hasToolbar: Boolean(grid.querySelector('[data-part="toolbar"]')),
    hasTotals: Boolean(totals),
    totalsHeight: totals ? num(totals.dataset.rowHeight) : null,
    hasPagination: Boolean(grid.querySelector('[data-part="pagination"]')),
    headerHeight: headerRow ? num(headerRow.style.height.replace("px", "")) : null,
  };
}

export interface MeasuredShape {
  columnWidths: number[];
  rowHeights: number[];
  headerHeight: number;
  totalsHeight: number | null;
  paginationTop: number;
  tableHeight: number;
  totalHeight: number;
}

/** Real layout boxes (browser only; all zeros in jsdom). */
export function measureGridShape(root: HTMLElement): MeasuredShape {
  const grid = root.matches('[data-testid="datagrid"]')
    ? root
    : root.querySelector<HTMLElement>('[data-testid="datagrid"]');
  if (!grid) throw new Error("no datagrid in the given root");
  const rect = (el: Element | null) => el?.getBoundingClientRect();
  const origin = rect(grid)?.top ?? 0;
  const rows = [
    ...grid.querySelectorAll('tbody > tr[data-part="row"], tbody > tr[data-part="skeleton-row"]'),
  ];
  return {
    columnWidths: [...grid.querySelectorAll("thead th")].map(
      (th) => Math.round((rect(th)?.width ?? 0) * 100) / 100,
    ),
    rowHeights: rows.map((r) => Math.round((rect(r)?.height ?? 0) * 100) / 100),
    headerHeight: rect(grid.querySelector("thead"))?.height ?? 0,
    totalsHeight: rect(grid.querySelector('[data-part="totals"]'))?.height ?? null,
    paginationTop: (rect(grid.querySelector('[data-part="pagination"]'))?.top ?? 0) - origin,
    tableHeight: rect(grid.querySelector("table"))?.height ?? 0,
    totalHeight: rect(grid)?.height ?? 0,
  };
}

/**
 * UX-02 probe: elements inside `root` that hide overflow without an ellipsis (and are not a wrapping text).
 * In a browser it also requires the text to be really cut (`scrollWidth > clientWidth`) so only real clipping
 * is reported; in jsdom (no layout) every hidden-overflow, non-ellipsis, non-wrapping element is reported.
 */
export function findBareClips(root: HTMLElement): HTMLElement[] {
  const hasLayout = (() => {
    const probe = root.querySelector("*");
    return probe
      ? probe.getBoundingClientRect().width > 0 || probe.getBoundingClientRect().height > 0
      : false;
  })();
  const bad: HTMLElement[] = [];
  for (const el of root.querySelectorAll<HTMLElement>("*")) {
    const cs = getComputedStyle(el);
    const hidden = cs.overflowX === "hidden" || cs.overflow === "hidden";
    if (!hidden) continue;
    const ellipsis = cs.textOverflow === "ellipsis";
    const wraps = cs.whiteSpace === "normal" || cs.whiteSpace === "pre-wrap";
    if (ellipsis || wraps) continue;
    // Only elements that hold text themselves can clip it; wrappers that round a border and the visually-hidden
    // helper text (`data-visually-hidden`) are not text clips.
    if (el.closest("[data-visually-hidden]")) continue;
    const ownText = [...el.childNodes].some(
      (n) => n.nodeType === 3 && (n.textContent ?? "").trim() !== "",
    );
    if (!ownText) continue;
    if (hasLayout && el.scrollWidth <= el.clientWidth) continue;
    bad.push(el);
  }
  return bad;
}
