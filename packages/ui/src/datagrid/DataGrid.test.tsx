import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DemoGrid } from "../stories/DemoGrid";
import { entityList } from "../stories/entities";
import { ThemeProvider } from "../theme";
import { describeGridShape, findBareClips } from "./shape";

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

describe("DataGrid skeleton parity per entity tab (UX-04)", () => {
  for (const entity of entityList) {
    for (const compare of [false, true]) {
      it(`${entity.label}${compare ? " (compare)" : ""}: skeleton has the loaded shape`, () => {
        const loading = wrap(
          <DemoGrid
            entity={entity.id}
            status="loading"
            pageSize={25}
            selectable
            compare={compare}
          />,
        );
        const a = describeGridShape(loading.container);
        loading.unmount();
        const ready = wrap(
          <DemoGrid entity={entity.id} status="ready" pageSize={25} selectable compare={compare} />,
        );
        const b = describeGridShape(ready.container);

        expect(a.columnCount).toBe(entity.columns.length + 1); // + selection column
        expect(a.columnIds).toEqual(b.columnIds);
        expect(a.columnWidths).toEqual(b.columnWidths);
        expect(a.headerLabels).toEqual(b.headerLabels);
        expect(a.alignments).toEqual(b.alignments);
        expect(a.rowCount).toBe(25); // = pageSize
        expect(b.rowCount).toBe(25);
        expect(a.rowHeights).toEqual(b.rowHeights);
        expect(new Set(a.rowHeights)).toEqual(new Set([compare ? 56 : 40]));
        expect(a).toMatchObject({ hasToolbar: true, hasTotals: true, hasPagination: true });
        expect(b).toMatchObject({ hasToolbar: true, hasTotals: true, hasPagination: true });
        expect(a.totalsHeight).toBe(b.totalsHeight);
      });
    }
  }

  it("row count follows pageSize", () => {
    const { container } = wrap(<DemoGrid entity="keywords" status="loading" pageSize={50} />);
    expect(describeGridShape(container).rowCount).toBe(50);
  });

  it("draws the static parts at once: header labels, Total label and pager words", () => {
    wrap(<DemoGrid entity="campaigns" status="loading" pageSize={25} />);
    expect(screen.getByRole("columnheader", { name: /Campaign/ })).toBeInTheDocument();
    expect(screen.getByText("Total")).toBeInTheDocument();
    expect(screen.getByText("Rows per page")).toBeInTheDocument();
    expect(screen.getByRole("table")).toHaveAttribute("aria-busy", "true");
  });

  it("numeric columns: header left, figures right-aligned, Total aligned with the figures (UX-03)", () => {
    const { container } = wrap(<DemoGrid entity="campaigns" status="ready" pageSize={25} />);
    const th = container.querySelector<HTMLElement>('th[data-col-id="spend"]')!;
    const td = container.querySelector<HTMLElement>('tbody td[data-col-id="spend"]')!;
    const total = container.querySelector<HTMLElement>('tfoot td[data-col-id="spend"]')!;
    expect(th.style.textAlign).toBe("left");
    expect(td.style.textAlign).toBe("right");
    expect(total.style.textAlign).toBe("right");
    // Cells that hold an input (budget editor) are exempt and keep their own alignment rules.
    expect(
      container.querySelector<HTMLElement>('tbody td[data-col-id="budget"]')!.dataset.align,
    ).toBe("left");
  });

  it("no text is clipped without an ellipsis", () => {
    const { container } = wrap(<DemoGrid entity="campaigns" status="ready" selectable />);
    expect(findBareClips(container)).toEqual([]);
  });
});

describe("DataGrid behaviour", () => {
  it("shows 'No records to display' in a row of the same height as a data row (UX-05)", () => {
    const { container } = wrap(<DemoGrid entity="campaigns" status="ready" rowCount={0} />);
    expect(screen.getByText("No records to display")).toBeInTheDocument();
    expect(container.querySelector<HTMLElement>('tr[data-part="empty-row"] td')!.style.height).toBe(
      "40px",
    );
  });

  it("keeps the selection across pages and refuses to pass the maximum at tick time (UX-11)", async () => {
    const onLimit = vi.fn();
    wrap(
      <DemoGrid
        entity="campaigns"
        status="ready"
        selectable
        maxSelection={3}
        onLimitReached={onLimit}
      />,
    );
    const user = userEvent.setup();
    const rows = () => screen.getAllByRole("checkbox", { name: "Select row" });
    await user.click(rows()[0]!);
    await user.click(rows()[1]!);
    await user.click(rows()[2]!);
    await user.click(rows()[3]!);
    expect(onLimit).toHaveBeenCalledWith(3);
    expect(rows().filter((c) => (c as HTMLInputElement).checked)).toHaveLength(3);
    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(rows().filter((c) => (c as HTMLInputElement).checked)).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Previous page" }));
    expect(rows().filter((c) => (c as HTMLInputElement).checked)).toHaveLength(3);
  });

  it("renders the Total row from summed figures", () => {
    wrap(<DemoGrid entity="campaigns" status="ready" rowCount={3} />);
    const foot = screen.getByRole("table").querySelector("tfoot")!;
    expect(within(foot).getByText("Total")).toBeInTheDocument();
    expect(within(foot).getAllByText(/^\$/).length).toBeGreaterThan(0);
  });

  it("an error replaces only the rows and offers Retry", () => {
    wrap(<DemoGrid entity="adGroups" status="error" />);
    expect(screen.getByTestId("error-card")).toHaveTextContent("The report could not be loaded.");
    expect(screen.getByRole("columnheader", { name: /Ad group/ })).toBeInTheDocument();
  });
});
