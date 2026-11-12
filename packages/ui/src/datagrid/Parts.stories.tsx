import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { PermissionProvider } from "../permissions";
import { BulkActionBar, type BulkAction } from "./BulkActionBar";
import { DeltaBadge } from "./DeltaBadge";
import { FilterBar, type MetricFilter } from "./FilterBar";
import { GridPagination } from "./GridPagination";
import { SkeletonMark } from "./GridSkeleton";
import { InlineEditCell } from "./InlineEditCell";
import { TruncatedText } from "./TruncatedText";
import { ColumnChooser } from "./ColumnChooser";
import { entities } from "../stories/entities";
import { emptyColumnState } from "./columnState";
import type { ColumnState, GridColumn } from "./types";

const meta = { title: "Data grid/Parts", component: BulkActionBar } satisfies Meta<
  typeof BulkActionBar
>;
export default meta;
type Story = StoryObj<typeof meta>;

// ---- bulk bar ------------------------------------------------------------------------------------------------

const run = fn();
const actions: BulkAction[] = [
  {
    id: "pause",
    label: "Pause",
    confirm: {
      title: "Confirm Pause 3 Campaigns",
      consequence: "Paused campaigns stop delivering until enabled again.",
    },
    run,
  },
  {
    id: "archive",
    label: "Archive",
    destructive: true,
    confirm: {
      title: "Confirm Archive 3 Campaigns",
      consequence: "Archived campaigns cannot be edited.",
      irreversible: true,
    },
    run,
  },
  {
    id: "enable",
    label: "Enable",
    disabledReason: "All selected campaigns are already enabled.",
    confirm: { title: "Confirm Enable 3 Campaigns", consequence: "x" },
    run,
  },
];

export const BulkBar: Story = {
  args: { count: 3, max: 300, actions, permission: "ads.write", onClear: fn() },
  play: async ({ canvasElement }) => {
    const root = within(canvasElement);
    // A no-op action is disabled (with an explanatory tooltip on its wrapper).
    await expect(root.getByRole("button", { name: "Enable" })).toBeDisabled();
    await userEvent.click(root.getByRole("button", { name: "Archive" }));
    const dialog = await within(document.body).findByRole("alertdialog");
    await expect(dialog).toHaveTextContent("Confirm Archive 3 Campaigns");
    await expect(dialog).toHaveTextContent("This cannot be undone.");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  },
};
export const BulkBarBusy: Story = {
  args: { count: 3, actions, permission: "ads.write", busy: true, onClear: fn() },
  play: async ({ canvasElement }) => {
    for (const b of within(canvasElement).getAllByRole("button")) await expect(b).toBeDisabled();
  },
};
export const BulkBarWithoutPermission: Story = {
  args: { count: 3, actions, permission: "ads.write", onClear: fn() },
  decorators: [
    (Story) => (
      <PermissionProvider permissions={["ads.read"]}>
        <Story />
      </PermissionProvider>
    ),
  ],
  play: async ({ canvasElement }) => {
    // Without edit permission the bar does not exist (hidden, UX-12/19).
    await expect(within(canvasElement).queryByRole("toolbar")).toBeNull();
  },
};
export const BulkBarNoSelection: Story = {
  args: { count: 0, actions, onClear: fn() },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole("toolbar")).toBeNull();
  },
};

// ---- inline edit ---------------------------------------------------------------------------------------------

export const InlineEdit: StoryObj = {
  render: () => {
    const Demo = () => {
      const [saved, setSaved] = useState("10.00");
      return (
        <InlineEditCell
          ariaLabel="Budget"
          display={`$${saved}`}
          value={saved}
          kind="money"
          validate={(v) => (Number(v) < 1 ? "Minimum budget is 1.00" : null)}
          onSave={async (v) => setSaved(v)}
        />
      );
    };
    return <Demo />;
  },
  play: async ({ canvasElement }) => {
    const root = within(canvasElement);
    await userEvent.click(root.getByRole("button", { name: "Edit Budget" }));
    const input = root.getByRole("textbox", { name: "Budget" });
    await userEvent.clear(input);
    await userEvent.type(input, "0.5{Enter}");
    await expect(root.getByRole("alert")).toHaveTextContent("Minimum budget is 1.00");
    await userEvent.clear(input);
    await userEvent.type(input, "12.5{Enter}");
    await waitFor(() => expect(root.getByText("$12.5")).toBeInTheDocument());
  },
};
export const InlineEditFailureKeepsValue: StoryObj = {
  render: () => (
    <InlineEditCell
      ariaLabel="Bid"
      display="$0.35"
      value="0.35"
      kind="money"
      onSave={async () => {
        throw new Error("Amazon rejected the bid");
      }}
    />
  ),
  play: async ({ canvasElement }) => {
    const root = within(canvasElement);
    await userEvent.click(root.getByRole("button", { name: "Edit Bid" }));
    const input = root.getByRole("textbox", { name: "Bid" });
    await userEvent.clear(input);
    await userEvent.type(input, "0.99{Enter}");
    // UX-13: the typed value stays and the cell says "Not saved".
    await waitFor(() => expect(root.getByRole("alert")).toHaveTextContent("Not saved"));
    await expect(input).toHaveValue("0.99");
  },
};
export const InlineEditLocked: StoryObj = {
  render: () => (
    <InlineEditCell
      ariaLabel="Budget"
      display="$10.00"
      value="10.00"
      kind="money"
      disabled
      disabledReason="Archived campaigns cannot be edited."
      onSave={async () => {}}
    />
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole("button", { name: /Edit/ })).toBeNull();
  },
};

// ---- filters -------------------------------------------------------------------------------------------------

export const Filters: StoryObj = {
  render: () => {
    const Demo = () => {
      const [filters, setFilters] = useState<MetricFilter[]>([]);
      const [chips, setChips] = useState<string[]>([]);
      const [q, setQ] = useState("");
      return (
        <FilterBar
          currency="USD"
          metrics={[
            { id: "spend", label: "Spend", kind: "money" },
            { id: "clicks", label: "Clicks", kind: "integer" },
            { id: "acos", label: "ACOS", kind: "percent" },
          ]}
          filters={filters}
          onFiltersChange={setFilters}
          quickChips={[
            { id: "oob", label: "Out of budget" },
            { id: "noclicks", label: "Impressions without clicks" },
          ]}
          activeChips={chips}
          onChipsChange={setChips}
          search={{ value: q, onSearch: setQ }}
        />
      );
    };
    return <Demo />;
  },
  play: async ({ canvasElement }) => {
    const root = within(canvasElement);
    await userEvent.click(root.getByRole("button", { name: "Out of budget" }));
    await expect(root.getByRole("button", { name: "Out of budget" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await userEvent.click(root.getByRole("button", { name: "Add filter" }));
    const body = within(document.body);
    await userEvent.type(await body.findByLabelText("Value"), "x1e5.50");
    await expect(body.getByLabelText("Value")).toHaveValue("15.50");
    await userEvent.click(body.getByRole("button", { name: "Apply filter" }));
    await waitFor(() => expect(root.getByText(/Spend greater than 15.50/)).toBeInTheDocument());
  },
};

// ---- pagination ----------------------------------------------------------------------------------------------

export const Pagination: StoryObj = {
  render: () => {
    const Demo = () => {
      const [p, setP] = useState({ pageIndex: 0, pageSize: 25 });
      return <GridPagination {...p} totalRows={312} loading={false} onChange={setP} />;
    };
    return <Demo />;
  },
  play: async ({ canvasElement }) => {
    const root = within(canvasElement);
    await expect(root.getByText("1–25 of 312")).toBeInTheDocument();
    await userEvent.click(root.getByRole("button", { name: "Next page" }));
    await expect(root.getByText("26–50 of 312")).toBeInTheDocument();
  },
};
export const PaginationLoading: StoryObj = {
  render: () => (
    <GridPagination pageIndex={0} pageSize={25} totalRows={undefined} loading onChange={() => {}} />
  ),
  play: async ({ canvasElement }) => {
    // The static words are there while the counts load.
    await expect(within(canvasElement).getByText("Rows per page")).toBeInTheDocument();
    await expect(within(canvasElement).getByRole("button", { name: "Next page" })).toBeDisabled();
  },
};

// ---- column chooser (standalone) -------------------------------------------------------------------------------

export const ColumnChooserStandalone: StoryObj = {
  render: () => {
    const Demo = () => {
      const [state, setState] = useState<ColumnState>(emptyColumnState);
      return (
        <ColumnChooser
          columns={entities.campaigns.columns as readonly GridColumn<never>[]}
          state={state}
          onChange={setState}
        />
      );
    };
    return <Demo />;
  },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Columns" }));
    const dialog = await within(document.body).findByRole("dialog", { name: "Columns" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Hide all" }));
    await expect(within(dialog).getByRole("checkbox", { name: "Show Spend" })).not.toBeChecked();
    await userEvent.click(within(dialog).getByRole("button", { name: "Show all" }));
    await expect(within(dialog).getByRole("checkbox", { name: "Show Spend" })).toBeChecked();
  },
};

// ---- primitives ------------------------------------------------------------------------------------------------

export const Delta: StoryObj = {
  render: () => (
    <div style={{ display: "flex", gap: 16 }}>
      <DeltaBadge delta="+12.4%" direction="up" good />
      <DeltaBadge delta="+8.0%" direction="up" good={false} />
      <DeltaBadge delta="-3.1%" direction="down" good={false} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText("+12.4%")).toBeInTheDocument();
  },
};
export const Truncated: StoryObj = {
  render: () => (
    <div style={{ width: 160 }}>
      <TruncatedText text="A very long campaign name that cannot fit in the column">
        A very long campaign name that cannot fit in the column
      </TruncatedText>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const el = canvasElement.querySelector<HTMLElement>("[data-truncate]")!;
    await expect(el.style.textOverflow).toBe("ellipsis");
    await expect(el.style.whiteSpace).toBe("nowrap");
  },
};
export const Wrapping: StoryObj = {
  render: () => (
    <div style={{ width: 160 }}>
      <TruncatedText wrap>
        A column that must wrap declares it and wraps instead of truncating
      </TruncatedText>
    </div>
  ),
  play: async ({ canvasElement }) => {
    await expect(
      canvasElement.querySelector<HTMLElement>("[data-truncate]")!.dataset.truncate,
    ).toBe("wrap");
  },
};
export const SkeletonShapes: StoryObj = {
  render: () => (
    <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
      {(["checkbox", "switch", "text", "number", "disc", "chip"] as const).map((s) => (
        <SkeletonMark key={s} shape={s} />
      ))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    for (const s of ["checkbox", "switch", "text", "number", "disc", "chip"]) {
      await expect(canvasElement.querySelector(`[data-skeleton="${s}"]`)).not.toBeNull();
    }
  },
};
