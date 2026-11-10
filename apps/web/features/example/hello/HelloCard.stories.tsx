import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { HelloCard } from "./HelloCard";

// EXAMPLE story: one story per state with an interaction test (BACKLOG C5).
const meta = { title: "example/HelloCard", component: HelloCard } satisfies Meta<typeof HelloCard>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = {
  args: { title: "Hello", state: "loading" },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("status")).toBeInTheDocument();
  },
};
export const Empty: Story = { args: { title: "Hello", state: "empty" } };
export const Ready: Story = { args: { title: "Hello", state: "ready", children: "content" } };
