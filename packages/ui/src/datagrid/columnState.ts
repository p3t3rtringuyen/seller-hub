import type { ColumnState, GridColumn, PinSide } from "./types";

// Pure column-layout logic behind the column chooser (UX-10): show/hide with Hide all / Show all, reorder, two
// pin positions per column (left, right; click the lit side again to unpin), Unpin all, Reset order.

type Ids = readonly Pick<GridColumn<unknown>, "id" | "hideable" | "pinnable">[];

export const emptyColumnState: ColumnState = { order: [], hidden: [], pinned: {} };

/** Ids in display order: saved order first (unknown ids dropped), then any column the saved order does not know. */
export function orderedIds(columns: Ids, state: ColumnState): string[] {
  const known = new Set(columns.map((c) => c.id));
  const saved = state.order.filter((id) => known.has(id));
  const seen = new Set(saved);
  return [...saved, ...columns.map((c) => c.id).filter((id) => !seen.has(id))];
}

export function visibleIds(columns: Ids, state: ColumnState): string[] {
  const hidden = new Set(state.hidden);
  const hideable = new Map(columns.map((c) => [c.id, c.hideable !== false]));
  return orderedIds(columns, state).filter((id) => !(hidden.has(id) && hideable.get(id)));
}

export function toggleHidden(columns: Ids, state: ColumnState, id: string): ColumnState {
  const col = columns.find((c) => c.id === id);
  if (!col || col.hideable === false) return state;
  const hidden = state.hidden.includes(id)
    ? state.hidden.filter((h) => h !== id)
    : [...state.hidden, id];
  return { ...state, order: orderedIds(columns, state), hidden };
}

export function hideAll(columns: Ids, state: ColumnState): ColumnState {
  return {
    ...state,
    order: orderedIds(columns, state),
    hidden: columns.filter((c) => c.hideable !== false).map((c) => c.id),
  };
}

export function showAll(columns: Ids, state: ColumnState): ColumnState {
  return { ...state, order: orderedIds(columns, state), hidden: [] };
}

export function moveColumn(
  columns: Ids,
  state: ColumnState,
  id: string,
  toIndex: number,
): ColumnState {
  const order = orderedIds(columns, state);
  const from = order.indexOf(id);
  if (from < 0) return state;
  const clamped = Math.max(0, Math.min(order.length - 1, toIndex));
  order.splice(from, 1);
  order.splice(clamped, 0, id);
  return { ...state, order };
}

/** Pins to `side`; pinning to the side it is already on unpins. */
export function pinColumn(
  columns: Ids,
  state: ColumnState,
  id: string,
  side: PinSide,
): ColumnState {
  const col = columns.find((c) => c.id === id);
  if (!col || col.pinnable === false) return state;
  const pinned = { ...state.pinned };
  if (pinned[id] === side) delete pinned[id];
  else pinned[id] = side;
  return { ...state, pinned };
}

export function unpinAll(state: ColumnState): ColumnState {
  return { ...state, pinned: {} };
}

/** Back to the definition order; visibility and pins are kept. */
export function resetOrder(state: ColumnState): ColumnState {
  return { ...state, order: [] };
}

/** TanStack `columnPinning` from the saved pins, keeping the display order inside each side. */
export function pinningFor(columns: Ids, state: ColumnState): { left: string[]; right: string[] } {
  const visible = visibleIds(columns, state);
  const pinnableIds = new Set(columns.filter((c) => c.pinnable !== false).map((c) => c.id));
  return {
    left: visible.filter((id) => pinnableIds.has(id) && state.pinned[id] === "left"),
    right: visible.filter((id) => pinnableIds.has(id) && state.pinned[id] === "right"),
  };
}
