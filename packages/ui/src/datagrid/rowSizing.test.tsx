import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DemoGrid } from "../stories/DemoGrid";
import { ThemeProvider } from "../theme";
import { rowHeightFor, skeletonRowCount } from "./rowSizing";
import { describeGridShape } from "./shape";

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

// Review M1-M3. jsdom has no layout, so these assert the numbers and styles the grid derives; the same
// configurations are measured with getBoundingClientRect by `pnpm --filter @seller-hub/ui run measure`
// (stories "Skeleton = loaded: compact / wrapping column / last page ...").

describe("row height budget (M1, M2)", () => {
  it("single-line rows use the density token", () => {
    expect(rowHeightFor("comfortable", false, 1)).toBe(40);
    expect(rowHeightFor("compact", false, 1)).toBe(32);
    expect(rowHeightFor("compact", true, 1)).toBe(48);
  });
  it("a wrapping column budgets for the lines it is clamped to", () => {
    expect(rowHeightFor("comfortable", false, 2)).toBe(49);
    expect(rowHeightFor("compact", false, 2)).toBe(49);
    expect(rowHeightFor("compact", true, 2)).toBe(69);
    expect(rowHeightFor("comfortable", false, 3)).toBe(67);
  });
});

describe("skeleton row count (M3, UX-04 'or the known count')", () => {
  it("draws the rows the page will have when the total is known", () => {
    expect(skeletonRowCount(25, 12, 312)).toBe(12);
    expect(skeletonRowCount(25, 0, 312)).toBe(25);
    expect(skeletonRowCount(25, 0, 7)).toBe(7);
  });
  it("draws the page size before the first answer", () => {
    expect(skeletonRowCount(25, 0, undefined)).toBe(25);
    expect(skeletonRowCount(25, 0, 0)).toBe(25);
  });
});

describe("grid uses the same sizing in both states", () => {
  const shape = (status: "loading" | "ready", props: Record<string, unknown>) => {
    const r = wrap(<DemoGrid entity="campaigns" status={status} selectable {...props} />);
    const s = describeGridShape(r.container);
    r.unmount();
    return s;
  };
  for (const [label, props, rows, height] of [
    ["compact", { density: "compact" }, 25, 32],
    ["compact + inline edit", { density: "compact", inlineEdit: true }, 25, 32],
    ["wrap", { wrapColumnIds: ["name"] }, 25, 49],
    [
      "wrap + compact + compare",
      { wrapColumnIds: ["name"], density: "compact", compare: true },
      25,
      69,
    ],
    ["last page", { initialPageIndex: 12 }, 12, 40],
  ] as const) {
    it(`${label}: skeleton and loaded rows have the same count and height`, () => {
      const a = shape("loading", props);
      const b = shape("ready", props);
      expect(a.rowCount).toBe(rows);
      expect(b.rowCount).toBe(rows);
      expect(new Set(a.rowHeights)).toEqual(new Set([height]));
      expect(a.rowHeights).toEqual(b.rowHeights);
      expect(a.totalsHeight).toBe(b.totalsHeight);
    });
  }

  it("wrapped text is clamped to the lines the skeleton draws", () => {
    const { container } = wrap(
      <DemoGrid entity="campaigns" status="ready" wrapColumnIds={["name"]} />,
    );
    const text = container.querySelector<HTMLElement>(
      'td[data-col-id="name"] [data-truncate="wrap"]',
    )!;
    expect(text.style.webkitLineClamp).toBe("2");
    expect(text.style.overflow).toBe("hidden");
    const skeleton = wrap(
      <DemoGrid entity="campaigns" status="loading" wrapColumnIds={["name"]} />,
    );
    expect(
      skeleton.container.querySelectorAll(
        'tbody tr:first-child td[data-col-id="name"] [data-skeleton="text"]',
      ),
    ).toHaveLength(2);
  });

  it("only a known total shrinks the skeleton", () => {
    const { container } = wrap(
      <DemoGrid entity="campaigns" status="loading" initialPageIndex={12} unknownTotal />,
    );
    expect(describeGridShape(container).rowCount).toBe(25);
  });
});

describe("accessibility names (QA)", () => {
  it("the page-size select has an accessible name, and two grids do not share ids", () => {
    const { container } = wrap(
      <>
        <DemoGrid entity="campaigns" status="ready" />
        <DemoGrid entity="keywords" status="ready" />
      </>,
    );
    const selects = screen.getAllByRole("combobox", { name: "Rows per page" });
    expect(selects).toHaveLength(2);
    const ids = [...container.querySelectorAll("[id]")].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("every row and header checkbox has a name", () => {
    wrap(<DemoGrid entity="campaigns" status="ready" selectable rowCount={3} />);
    expect(
      screen.getByRole("checkbox", { name: "Select all rows on this page" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox", { name: "Select row" })).toHaveLength(3);
  });
});
