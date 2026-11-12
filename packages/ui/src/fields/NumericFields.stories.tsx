import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import { IntegerField, MoneyField, PercentField } from "./NumericFields";

// UX-01: type "1e5E.3-+x.9" -> money keeps 15.39, whole number keeps 15.
const meta = { title: "Fields/Numeric fields", component: MoneyField } satisfies Meta<
  typeof MoneyField
>;
export default meta;
type Story = StoryObj<typeof meta>;

function Controlled({ kind }: { kind: "money" | "integer" | "percent" }) {
  const [value, setValue] = useState("");
  if (kind === "money")
    return <MoneyField label="Bid" value={value} onChange={setValue} currency="USD" />;
  if (kind === "integer")
    return <IntegerField label="Impressions" value={value} onChange={setValue} />;
  return <PercentField label="Placement adjustment" value={value} onChange={setValue} max={900} />;
}

const TYPED = "1e5E.3-+x.9";

export const Money: Story = {
  args: { label: "Bid", value: "", onChange: () => {}, currency: "USD" },
  render: () => <Controlled kind="money" />,
  play: async ({ canvasElement }) => {
    const input = within(canvasElement).getByLabelText("Bid");
    await userEvent.type(input, TYPED);
    await expect(input).toHaveValue("15.39");
    await expect(input).toHaveAttribute("type", "text");
  },
};
export const WholeNumber: Story = {
  args: { label: "Impressions", value: "", onChange: () => {}, currency: "USD" },
  render: () => <Controlled kind="integer" />,
  play: async ({ canvasElement }) => {
    const input = within(canvasElement).getByLabelText("Impressions");
    // A pasted value keeps its integer part (typing the dot, then digits, is covered by sanitize.test.ts).
    await userEvent.click(input);
    await userEvent.paste(TYPED);
    await expect(input).toHaveValue("15");
  },
};
export const PercentCapped: Story = {
  args: { label: "Placement adjustment", value: "", onChange: () => {}, currency: "USD" },
  render: () => <Controlled kind="percent" />,
  play: async ({ canvasElement }) => {
    const input = within(canvasElement).getByLabelText("Placement adjustment");
    await userEvent.type(input, "9999");
    // Capped while typing (max 900): the keystroke that would reach 999 is refused.
    await expect(input).toHaveValue("99");
  },
};
export const Disabled: Story = {
  args: { label: "Bid", value: "0.35", onChange: () => {}, currency: "JPY", disabled: true },
};
export const WithError: Story = {
  args: {
    label: "Bid",
    value: "0.01",
    onChange: () => {},
    currency: "USD",
    error: true,
    helperText: "Minimum bid is 0.02",
  },
};
