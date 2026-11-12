import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import { DateRangeCompare } from "./DateRangeCompare";
import type { CompareValueRange, RangeValue } from "./dates";

const meta = { title: "Dates/DateRangeCompare", component: DateRangeCompare } satisfies Meta<
  typeof DateRangeCompare
>;
export default meta;
type Story = StoryObj<typeof meta>;

const TODAY = "2026-11-12";

function Demo({ presets }: { presets?: RangeValue["preset"][] }) {
  const [value, setValue] = useState<RangeValue>({
    from: "2026-11-06",
    to: TODAY,
    preset: "last7",
  });
  const [compare, setCompare] = useState<CompareValueRange>({ enabled: false });
  return (
    <div>
      <DateRangeCompare
        value={value}
        compare={compare}
        today={TODAY}
        timeZone="America/Los_Angeles"
        {...(presets ? { presets } : {})}
        onChange={(v, c) => {
          setValue(v);
          setCompare(c);
        }}
      />
      <pre data-testid="state">{JSON.stringify({ value, compare })}</pre>
    </div>
  );
}

export const Default: Story = {
  args: {
    value: { from: "2026-11-06", to: TODAY, preset: "last7" },
    compare: { enabled: false },
    today: TODAY,
    onChange: () => {},
  },
  render: () => <Demo />,
  play: async ({ canvasElement }) => {
    const root = within(canvasElement);
    await userEvent.click(root.getByRole("button", { name: /Last 7 days/ }));
    const body = within(document.body);
    await userEvent.click(await body.findByRole("menuitem", { name: "Last 30 days" }));
    await userEvent.click(body.getByRole("checkbox", { name: "Compare to another period" }));
    // Compare defaults to the previous period of the same length.
    await expect(body.getByLabelText("Compare from")).toHaveValue("2026-09-14");
    await expect(body.getByLabelText("Compare to")).toHaveValue("2026-10-13");
    await expect(
      body.getByText("Dates use the America/Los_Angeles time zone."),
    ).toBeInTheDocument();
    await userEvent.click(body.getByRole("button", { name: "Apply" }));
    await expect(root.getByTestId("state")).toHaveTextContent('"preset":"last30"');
    await expect(root.getByTestId("state")).toHaveTextContent(
      '"compare":{"enabled":true,"from":"2026-09-14","to":"2026-10-13"}',
    );
  },
};
export const CustomOnly: Story = {
  args: {
    value: { from: "2026-11-01", to: "2026-11-12", preset: "custom" },
    compare: { enabled: false },
    today: TODAY,
    onChange: () => {},
  },
  render: () => <Demo presets={["custom"]} />,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: /Last 7 days/ }));
    await expect(await within(document.body).findAllByRole("menuitem")).toHaveLength(1);
  },
};
export const FutureDaysBlocked: Story = {
  args: {
    value: { from: "2026-11-06", to: TODAY, preset: "last7" },
    compare: { enabled: false },
    today: TODAY,
    onChange: () => {},
  },
  render: () => <Demo />,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: /Last 7 days/ }));
    // The calendar ceiling is today in the marketplace zone.
    await expect(await within(document.body).findByLabelText("To")).toHaveAttribute("max", TODAY);
  },
};
