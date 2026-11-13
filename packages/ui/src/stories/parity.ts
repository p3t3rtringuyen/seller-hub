import { expect } from "storybook/test";
import { describeGridShape, measureGridShape } from "../datagrid/shape";

// Shared by the per-entity skeleton-parity stories and their Vitest runner.
export async function expectSameShape(canvasElement: HTMLElement, pageSize: number) {
  const loading = canvasElement.querySelector<HTMLElement>('[data-which="loading"]')!;
  const ready = canvasElement.querySelector<HTMLElement>('[data-which="ready"]')!;
  const a = describeGridShape(loading);
  const b = describeGridShape(ready);
  await expect(a.columnCount).toBe(b.columnCount);
  await expect(a.columnIds).toEqual(b.columnIds);
  await expect(a.columnWidths).toEqual(b.columnWidths);
  await expect(a.headerLabels).toEqual(b.headerLabels);
  await expect(a.alignments).toEqual(b.alignments);
  await expect(a.rowCount).toBe(pageSize);
  await expect(a.rowCount).toBe(b.rowCount);
  await expect(a.rowHeights).toEqual(b.rowHeights);
  await expect(new Set(a.rowHeights).size).toBe(1);
  await expect([a.hasToolbar, a.hasTotals, a.hasPagination]).toEqual([true, true, true]);
  await expect([b.hasToolbar, b.hasTotals, b.hasPagination]).toEqual([true, true, true]);
  await expect(a.totalsHeight).toBe(b.totalsHeight);
  await expect(a.headerHeight).toBe(b.headerHeight);
  // Real layout (browsers only; zeros in jsdom, so only compared when a layout engine exists).
  const ma = measureGridShape(loading);
  const mb = measureGridShape(ready);
  if (ma.tableHeight > 0) {
    await expect(ma.columnWidths).toEqual(mb.columnWidths);
    await expect(ma.rowHeights).toEqual(mb.rowHeights);
    await expect(ma.tableHeight).toBeCloseTo(mb.tableHeight, 1);
    await expect(ma.paginationTop).toBeCloseTo(mb.paginationTop, 1);
    await expect(ma.totalsHeight).toBe(mb.totalsHeight);
  }
}
