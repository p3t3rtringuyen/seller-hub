import Button from "@mui/material/Button";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { DemoGrid } from "../stories/DemoGrid";
import { type DemoEntity } from "../stories/entities";
import { expectSameShape } from "../stories/parity";
import { describeGridShape, findBareClips, measureGridShape } from "./shape";

const meta = {
  title: "Data grid/DataGrid",
  component: DemoGrid,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof DemoGrid>;
export default meta;
type Story = StoryObj<typeof meta>;

// ---- one story per entity tab, loaded and loading -------------------------------------------------------------

export const Campaigns: Story = { args: { entity: "campaigns", selectable: true } };
export const AdGroups: Story = { args: { entity: "adGroups", selectable: true } };
export const Keywords: Story = { args: { entity: "keywords", selectable: true } };
export const ProductTargets: Story = { args: { entity: "productTargets", selectable: true } };
export const AutoTargets: Story = { args: { entity: "autoTargets", selectable: true } };

export const CampaignsLoading: Story = {
  args: { entity: "campaigns", status: "loading", selectable: true },
};
export const KeywordsLoading: Story = {
  args: { entity: "keywords", status: "loading", selectable: true },
};

// ---- skeleton shape parity (the user's rule, UX-04) -----------------------------------------------------------
// The loaded grid and its loading twin are rendered with the same entity; the interaction test compares every
// measurable property: column count/ids/widths/alignment, header labels, row count (= pageSize), row height,
// toolbar, totals row, pager. In a real browser it also compares the measured boxes (no layout shift).

function Parity({ entity, compare }: { entity: DemoEntity["id"]; compare?: boolean }) {
  return (
    <div style={{ width: 1280 }}>
      <div data-which="loading">
        <DemoGrid
          entity={entity}
          status="loading"
          pageSize={25}
          selectable
          {...(compare ? { compare } : {})}
        />
      </div>
      <div data-which="ready" style={{ marginTop: 24 }}>
        <DemoGrid
          entity={entity}
          status="ready"
          pageSize={25}
          selectable
          {...(compare ? { compare } : {})}
        />
      </div>
    </div>
  );
}

const parity = (entity: DemoEntity["id"], compare = false): Story => ({
  args: { entity },
  render: () => <Parity entity={entity} compare={compare} />,
  play: async ({ canvasElement }) => expectSameShape(canvasElement, 25),
});

export const ShapeParityCampaigns: Story = {
  ...parity("campaigns"),
  name: "Skeleton = loaded: campaigns",
};
export const ShapeParityAdGroups: Story = {
  ...parity("adGroups"),
  name: "Skeleton = loaded: ad groups",
};
export const ShapeParityKeywords: Story = {
  ...parity("keywords"),
  name: "Skeleton = loaded: keywords",
};
export const ShapeParityProductTargets: Story = {
  ...parity("productTargets"),
  name: "Skeleton = loaded: product targets",
};
export const ShapeParityAutoTargets: Story = {
  ...parity("autoTargets"),
  name: "Skeleton = loaded: auto targets",
};
export const ShapeParityCompare: Story = {
  ...parity("campaigns", true),
  name: "Skeleton = loaded: campaigns with compare",
};

// The same grid, switched from loading to loaded in place: nothing moves.
function LoadTransition({ entity }: { entity: DemoEntity["id"] }) {
  const [status, setStatus] = useState<"loading" | "ready">("loading");
  return (
    <div style={{ width: 1280 }}>
      <Button onClick={() => setStatus("ready")}>Data arrives</Button>
      <DemoGrid entity={entity} status={status} pageSize={25} selectable />
    </div>
  );
}
export const LoadingToLoaded: Story = {
  args: { entity: "campaigns" },
  render: () => <LoadTransition entity="campaigns" />,
  play: async ({ canvasElement }) => {
    const grid = () => canvasElement.querySelector<HTMLElement>('[data-testid="datagrid"]')!;
    const before = { declared: describeGridShape(grid()), measured: measureGridShape(grid()) };
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Data arrives" }));
    await waitFor(() => expect(grid()).toHaveAttribute("data-state", "ready"));
    const after = { declared: describeGridShape(grid()), measured: measureGridShape(grid()) };
    await expect(after.declared).toEqual(before.declared);
    if (before.measured.totalHeight > 0) {
      await expect(after.measured.totalHeight).toBeCloseTo(before.measured.totalHeight, 1);
      await expect(after.measured.paginationTop).toBeCloseTo(before.measured.paginationTop, 1);
      await expect(after.measured.rowHeights).toEqual(before.measured.rowHeights);
    }
  },
};

// ---- other states ---------------------------------------------------------------------------------------------

export const Empty: Story = {
  args: {
    entity: "campaigns",
    rowCount: 0,
    emptyTitle: "Nothing has been changed in this period.",
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("status")).toHaveTextContent(
      "Nothing has been changed",
    );
    await expect(within(canvasElement).getByText(/of 0|0–0 of 0/)).toBeInTheDocument();
  },
};
export const EmptyDefaultMessage: Story = {
  args: { entity: "keywords", rowCount: 0 },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText("No records to display")).toBeInTheDocument();
  },
};
export const ErrorState: Story = {
  args: { entity: "campaigns", status: "error" },
  play: async ({ canvasElement }) => {
    const root = within(canvasElement);
    // The error card replaces the rows only: toolbar, header and pager stay (a failing table breaks no neighbour).
    await expect(root.getByTestId("error-card")).toBeInTheDocument();
    await expect(root.getByRole("columnheader", { name: /Campaign/ })).toBeInTheDocument();
    await expect(root.getByRole("button", { name: "Retry" })).toBeEnabled();
  },
};
export const WithCompare: Story = {
  args: { entity: "campaigns", compare: true },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getAllByText(/vs \$/).length).toBeGreaterThan(0);
  },
};

export const NoBareClipping: Story = {
  args: { entity: "campaigns", selectable: true },
  name: "No cell clips text without an ellipsis (UX-02 probe)",
  play: async ({ canvasElement }) => {
    await expect(findBareClips(canvasElement).map((e) => e.outerHTML.slice(0, 160))).toEqual([]);
    // A long campaign name is truncated with the ellipsis style and still readable through its tooltip text.
    const cell = canvasElement.querySelector<HTMLElement>(
      'td[data-col-id="name"] [data-truncate="ellipsis"]',
    )!;
    await expect(cell.style.textOverflow).toBe("ellipsis");
  },
};

export const SortAndPage: Story = {
  args: { entity: "campaigns" },
  play: async ({ canvasElement }) => {
    const root = within(canvasElement);
    await userEvent.click(root.getByRole("button", { name: "Spend" }));
    await expect(root.getByRole("columnheader", { name: /Spend/ })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
    await userEvent.click(root.getByRole("button", { name: /Spend, sorted ascending/ }));
    await expect(root.getByRole("columnheader", { name: /Spend/ })).toHaveAttribute(
      "aria-sort",
      "descending",
    );
    await userEvent.click(root.getByRole("button", { name: "Next page" }));
    await expect(root.getByText("26–50 of 312")).toBeInTheDocument();
  },
};

export const SelectionAcrossPages: Story = {
  args: {
    entity: "campaigns",
    selectable: true,
    maxSelection: 30,
    pageSize: 25,
    onLimitReached: fn(),
  },
  play: async ({ canvasElement, args }) => {
    const root = within(canvasElement);
    await userEvent.click(root.getByRole("checkbox", { name: "Select all rows on this page" }));
    await expect(
      root
        .getAllByRole("checkbox", { name: "Select row" })
        .filter((c) => (c as HTMLInputElement).checked),
    ).toHaveLength(25);
    await userEvent.click(root.getByRole("button", { name: "Next page" }));
    // Selection survives paging; the maximum (30) is enforced at tick time.
    await userEvent.click(root.getByRole("checkbox", { name: "Select all rows on this page" }));
    await expect(args.onLimitReached).toHaveBeenCalledWith(30);
    await expect(root.getByRole("status", { name: "" })).toBeDefined();
    await userEvent.click(root.getByRole("button", { name: "Previous page" }));
    await expect(
      root.getByRole("checkbox", { name: "Select all rows on this page" }),
    ).toBeChecked();
  },
};

export const PinnedAndHiddenColumns: Story = {
  args: {
    entity: "campaigns",
    initialColumnState: {
      order: [],
      hidden: ["orders", "type"],
      pinned: { name: "left", acos: "right" },
    },
  },
  play: async ({ canvasElement }) => {
    const grid = canvasElement.querySelector<HTMLElement>('[data-testid="datagrid"]')!;
    const shape = describeGridShape(grid);
    await expect(shape.columnIds).not.toContain("orders");
    await expect(shape.columnIds).not.toContain("type");
    const nameHeader = grid.querySelector<HTMLElement>('th[data-col-id="name"]')!;
    await expect(nameHeader.style.position).toBe("sticky");
    await expect(nameHeader.style.left).toBe("0px");
  },
};

export const ColumnChooserFlow: Story = {
  args: { entity: "campaigns" },
  play: async ({ canvasElement }) => {
    const root = within(canvasElement);
    await userEvent.click(root.getByRole("button", { name: "Columns" }));
    const dialog = await within(document.body).findByRole("dialog", { name: "Columns" });
    // The popover is modal, so the table behind it is aria-hidden: query it with { hidden: true }.
    await expect(
      root.getByRole("columnheader", { name: /^Clicks/, hidden: true }),
    ).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("checkbox", { name: "Show Clicks" }));
    await expect(root.queryByRole("columnheader", { name: /^Clicks/, hidden: true })).toBeNull();
    await userEvent.click(within(dialog).getByRole("button", { name: "Pin Impressions left" }));
    await expect(
      within(dialog).getByRole("button", { name: "Pin Impressions left" }),
    ).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(within(dialog).getByRole("button", { name: "Show all" }));
    await expect(
      root.getByRole("columnheader", { name: /^Clicks/, hidden: true }),
    ).toBeInTheDocument();
  },
};
