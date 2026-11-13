import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { MultiSelect } from "./MultiSelect";
import { SearchField } from "./SearchField";
import { StatusChip } from "./StatusChip";

const meta = {
  title: "Fields/Search, multi-select, status",
  component: SearchField,
} satisfies Meta<typeof SearchField>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Search: Story = {
  args: { value: "", onSearch: fn(), debounceMs: 20 },
  play: async ({ canvasElement, args }) => {
    const box = within(canvasElement).getByRole("searchbox");
    await userEvent.type(box, "bottle");
    await waitFor(() => expect(args.onSearch).toHaveBeenCalledWith("bottle"));
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Clear" }));
    await waitFor(() => expect(args.onSearch).toHaveBeenLastCalledWith(""));
  },
};

const options = [
  { value: "US", label: "United States" },
  { value: "CA", label: "Canada" },
  { value: "MX", label: "Mexico" },
];

function MultiSelectDemo({ max }: { max?: number }) {
  const [value, setValue] = useState<string[]>([]);
  return (
    <MultiSelect
      label="Marketplaces"
      options={options}
      value={value}
      onChange={setValue}
      {...(max ? { max } : {})}
    />
  );
}

export const MultiSelectMax: StoryObj = {
  render: () => <MultiSelectDemo max={2} />,
  play: async ({ canvasElement }) => {
    const root = within(canvasElement);
    await userEvent.click(root.getByRole("combobox"));
    const body = within(document.body);
    await userEvent.click(await body.findByRole("option", { name: "United States" }));
    await userEvent.click(await body.findByRole("option", { name: "Canada" }));
    // The maximum is enforced at tick time: the third option is disabled.
    await expect(await body.findByRole("option", { name: "Mexico" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  },
};

export const Statuses: StoryObj = {
  render: () => (
    <div style={{ display: "flex", gap: 8 }}>
      {["enabled", "paused", "archived", "failed", "scheduled"].map((s) => (
        <StatusChip key={s} status={s} />
      ))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    const root = within(canvasElement);
    await expect(root.getByText("enabled").closest("[data-tone]")).toHaveAttribute(
      "data-tone",
      "success",
    );
    await expect(root.getByText("failed").closest("[data-tone]")).toHaveAttribute(
      "data-tone",
      "error",
    );
    await expect(root.getByText("archived").closest("[data-tone]")).toHaveAttribute(
      "data-tone",
      "neutral",
    );
  },
};
