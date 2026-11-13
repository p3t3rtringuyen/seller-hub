import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import { PermissionGate } from "../permissions";
import { AppShell } from "./AppShell";
import { ContextSwitcher, type ShellContextValue } from "./ContextSwitcher";
import { ThemeToggle } from "./ThemeToggle";

const meta = {
  title: "Shell/AppShell",
  component: AppShell,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof AppShell>;
export default meta;
type Story = StoryObj<typeof meta>;

const sections = [
  {
    id: "ads",
    label: "Advertising",
    items: [
      { id: "ads.campaigns", label: "Campaigns", href: "/ads/campaigns" },
      { id: "ads.reports", label: "Reports", href: "/ads/reports" },
    ],
  },
  {
    id: "ops",
    label: "Operations",
    items: [{ id: "listings", label: "Listings", href: "/listings" }],
  },
];

const options = {
  tenants: [{ id: "t1", label: "Acme Brands" }],
  sellerAccounts: [
    { id: "s1", label: "Acme US Seller" },
    { id: "s2", label: "Acme EU Seller" },
  ],
  marketplaces: [
    { id: "ATVPDKIKX0DER", label: "United States" },
    { id: "A2EUQ1WTGCTBG2", label: "Canada" },
  ],
};

function Frame({ switching }: { switching?: boolean }) {
  const [ctx, setCtx] = useState<ShellContextValue>({
    tenantId: "t1",
    sellerAccountId: "s1",
    marketplaceId: "ATVPDKIKX0DER",
  });
  return (
    <AppShell
      sections={sections}
      currentPath="/ads/campaigns"
      title="Campaigns"
      breadcrumbs={[{ label: "Advertising", href: "/ads" }, { label: "Campaigns" }]}
      switcher={
        <ContextSwitcher
          value={ctx}
          options={options}
          onChange={setCtx}
          switching={switching ?? false}
        />
      }
      headerActions={<ThemeToggle />}
    >
      <p>Page content</p>
      <PermissionGate
        permission="ads.write"
        mode="lock"
        fallback={<span>Read-only: you cannot create campaigns.</span>}
      >
        <button>Create campaign</button>
      </PermissionGate>
    </AppShell>
  );
}

export const Default: Story = {
  args: { sections, currentPath: "/ads/campaigns", children: null },
  render: () => <Frame />,
  play: async ({ canvasElement }) => {
    const root = within(canvasElement);
    const sidebar = root.getByTestId("sidebar");
    // Collapsed by default (UX-25); expands on request.
    await expect(sidebar).toHaveAttribute("data-expanded", "false");
    await userEvent.click(root.getByRole("button", { name: "Expand menu" }));
    await expect(sidebar).toHaveAttribute("data-expanded", "true");
    await expect(root.getByRole("link", { name: "Campaigns" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(root.getByRole("navigation", { name: "Breadcrumbs" })).toHaveTextContent(
      "Advertising",
    );
    await expect(root.getByRole("heading", { level: 1 })).toHaveTextContent("Campaigns");
    await expect(root.getByRole("button", { name: "Create campaign" })).toBeInTheDocument();
  },
};
export const Switching: Story = {
  args: { sections, currentPath: "/ads/campaigns", children: null },
  render: () => <Frame switching />,
  play: async ({ canvasElement }) => {
    // Navbar actions disable during the switch (UX-18).
    await expect(within(canvasElement).getByTestId("context-switcher")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    await expect(
      within(canvasElement).getByRole("combobox", { name: "Marketplace" }),
    ).toHaveAttribute("aria-disabled", "true");
  },
};
