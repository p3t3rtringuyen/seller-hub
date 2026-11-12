import { render, screen, within } from "@testing-library/react";
import { ThemeProvider } from "@seller-hub/ui";
import { describe, expect, it, vi } from "vitest";
import { AppFrame } from "./AppFrame";
import type { NavEntry } from "../../nav.generated";
import { navEntries } from "../../nav.generated";
import { buildBreadcrumbs } from "./breadcrumbs";
import { buildNavSections, labelFor, namespaceOf } from "./nav";

let pathname = "/example";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const entry = (over: Partial<NavEntry>): NavEntry => ({
  id: "x.y",
  labelKey: "nav",
  href: "/x",
  section: "ads",
  order: 10,
  permission: "x.read",
  ...over,
});

describe("buildNavSections", () => {
  const entries = [
    entry({ id: "ads.campaigns", href: "/ads/campaigns", order: 20, permission: "ads.read" }),
    entry({ id: "ads.reports", href: "/ads/reports", order: 10, permission: "ads.read" }),
    entry({
      id: "fin.fees",
      href: "/finance/fees",
      section: "finance",
      permission: "finance.read",
    }),
    entry({
      id: "ops.team",
      href: "/settings/team",
      section: "settings",
      permission: "identity.admin",
    }),
  ];
  it("groups by section, orders by `order`, and keeps section order of first appearance", () => {
    const sections = buildNavSections(entries, () => true);
    expect(sections.map((s) => s.id)).toEqual(["ads", "finance", "settings"]);
    expect(sections[0]!.items.map((i) => i.id)).toEqual(["ads.reports", "ads.campaigns"]);
    expect(sections[0]!.label).toBe("Advertising");
  });
  it("offers only entries the user may open, and nothing while roles load", () => {
    const only = buildNavSections(entries, (p) => p === "ads.read");
    expect(only.map((s) => s.id)).toEqual(["ads"]);
    expect(buildNavSections(entries, () => false)).toEqual([]);
  });
  it("reads labels from the slice message file (<module>.<key> namespace) and falls back to the key", () => {
    expect(namespaceOf({ id: "example.hello" })).toBe("example.hello");
    expect(labelFor(entry({ id: "example.hello", labelKey: "nav" }))).toBe("Example");
    expect(labelFor(entry({ id: "nope.missing", labelKey: "nav" }))).toBe("nav");
  });
});

describe("buildBreadcrumbs (UX-25)", () => {
  it("starts at Home, uses nav labels, humanises other segments, and ends with the page title", () => {
    const known = [{ href: "/ads/campaigns", label: "Campaigns" }];
    const { crumbs, title } = buildBreadcrumbs("/ads/campaigns/c-42", known);
    expect(crumbs.map((c) => c.label)).toEqual(["Home", "Ads", "Campaigns", "C 42"]);
    expect(crumbs.at(-1)!.href).toBeUndefined();
    expect(title).toBe("C 42");
  });
  it("handles the root", () => {
    expect(buildBreadcrumbs("/", []).title).toBe("Home");
  });
});

describe("AppFrame reads the generated registries", () => {
  it("renders the registered nav entry as a link and marks it current", () => {
    pathname = "/example";
    render(
      <ThemeProvider>
        <AppFrame>
          <p>page body</p>
        </AppFrame>
      </ThemeProvider>,
    );
    const nav = screen.getByRole("navigation", { name: "Main navigation" });
    const link = within(nav).getByRole("link", { name: "Example" });
    expect(link).toHaveAttribute("href", navEntries[0]!.href);
    expect(link).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("page body")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Example");
    expect(screen.getByRole("combobox", { name: "Marketplace" })).toBeInTheDocument();
  });
});
