import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { KpiCard } from "./KpiCard";
import { TimeSeriesChart, type ChartPoint } from "./TimeSeriesChart";

const meta = { title: "Charts/KPI cards and chart", component: KpiCard } satisfies Meta<
  typeof KpiCard
>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {
  args: {
    label: "Ad spend",
    value: "$12,430.55",
    definition: "Total cost of clicks in the period.",
    compare: { previous: "$11,020.10", delta: "+12.8%", direction: "up", good: false },
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("group", { name: "Ad spend" })).toHaveTextContent(
      "$12,430.55",
    );
  },
};
export const Loading: Story = { args: { label: "Ad spend", value: null, loading: true } };
export const NoData: Story = {
  args: { label: "TACoS", value: null },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("group", { name: "TACoS" })).toHaveTextContent(
      "—",
    );
  },
};
export const CardIsSameBoxLoadingOrReady: Story = {
  args: { label: "Orders", value: "1,204" },
  render: (args) => (
    <div style={{ display: "flex", gap: 16 }}>
      <div data-which="loading">
        <KpiCard {...args} value={null} loading />
      </div>
      <div data-which="ready">
        <KpiCard
          {...args}
          compare={{ previous: "1,100", delta: "+9.5%", direction: "up", good: true }}
        />
      </div>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const [a, b] = ["loading", "ready"].map((w) =>
      canvasElement
        .querySelector(`[data-which="${w}"] [data-testid="kpi-card"]`)!
        .getBoundingClientRect(),
    );
    await expect(a!.height).toBe(b!.height);
    await expect(a!.width).toBe(b!.width);
  },
};

const data: ChartPoint[] = Array.from({ length: 14 }, (_, i) => ({
  date: `2026-10-${String(i + 1).padStart(2, "0")}`,
  sales: i === 6 ? null : 100 + i * 9 + (i % 3) * 14,
  "sales:prev": 90 + i * 7,
  spend: 20 + i * 2,
}));

export const Chart: StoryObj = {
  render: () => (
    <TimeSeriesChart
      label="Sales and ad spend, last 14 days"
      series={[
        { id: "sales", label: "Sales" },
        { id: "spend", label: "Ad spend" },
      ]}
      compare={["sales"]}
      data={data}
      width={720}
    />
  ),
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole("img", { name: /Sales and ad spend/ }),
    ).toHaveAttribute("data-state", "ready");
  },
};
export const ChartLoading: StoryObj = {
  render: () => (
    <TimeSeriesChart label="Sales" series={[{ id: "sales", label: "Sales" }]} data={[]} loading />
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId("chart-skeleton")).toBeInTheDocument();
  },
};
export const ChartEmpty: StoryObj = {
  render: () => (
    <TimeSeriesChart label="Sales" series={[{ id: "sales", label: "Sales" }]} data={[]} />
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText("No data for this period")).toBeInTheDocument();
  },
};
