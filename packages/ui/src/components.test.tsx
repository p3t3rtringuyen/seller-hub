import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { KpiCard } from "./charts/KpiCard";
import { TimeSeriesChart } from "./charts/TimeSeriesChart";
import { BulkActionBar } from "./datagrid/BulkActionBar";
import { ConfirmDialog } from "./feedback/Dialogs";
import { ErrorCard } from "./feedback/ErrorCard";
import { ToastProvider, useBulkResultToast } from "./feedback/Toast";
import { MoneyField, PercentField } from "./fields/NumericFields";
import { StatusChip } from "./fields/StatusChip";
import { UiMessagesProvider } from "./messages";
import { PermissionGate, PermissionProvider } from "./permissions";
import { AppShell } from "./shell/AppShell";
import { ThemeProvider } from "./theme";
import { useState } from "react";

const wrap = (ui: React.ReactElement, permissions: string[] = ["ads.write"], loading = false) =>
  render(
    <ThemeProvider>
      <PermissionProvider permissions={permissions} loading={loading}>
        <ToastProvider>{ui}</ToastProvider>
      </PermissionProvider>
    </ThemeProvider>,
  );

describe("permissions (D55, UX-19)", () => {
  it("hides without permission, locks with a reason, and waits while roles load", () => {
    const { unmount } = wrap(<PermissionGate permission="ads.write">write</PermissionGate>, [
      "ads.read",
    ]);
    expect(screen.queryByText("write")).toBeNull();
    unmount();
    wrap(
      <PermissionGate permission="ads.write" mode="lock" fallback={<span>locked: read-only</span>}>
        write
      </PermissionGate>,
      ["ads.read"],
    );
    expect(screen.getByText("locked: read-only")).toBeInTheDocument();
  });
  it("renders neither content nor 'no access' while roles load", () => {
    wrap(
      <PermissionGate permission="ads.write" mode="lock" fallback={<span>no access</span>}>
        write
      </PermissionGate>,
      ["ads.write"],
      true,
    );
    expect(screen.queryByText("write")).toBeNull();
    expect(screen.queryByText("no access")).toBeNull();
  });
});

describe("message catalogue override", () => {
  it("lets the app replace a default string", () => {
    render(
      <ThemeProvider>
        <UiMessagesProvider messages={{ "common.retry": "Thử lại" }}>
          <ErrorCard message="x" onRetry={() => {}} />
        </UiMessagesProvider>
      </ThemeProvider>,
    );
    expect(screen.getByRole("button", { name: "Thử lại" })).toBeInTheDocument();
  });
});

describe("fields", () => {
  it("money field refuses disallowed characters and is never type=number", async () => {
    const Demo = () => {
      const [v, setV] = useState("");
      return <MoneyField label="Bid" value={v} onChange={setV} currency="USD" />;
    };
    wrap(<Demo />);
    const input = screen.getByLabelText("Bid");
    await userEvent.type(input, "1e5E.3-+x.9");
    expect(input).toHaveValue("15.39");
    expect(input).toHaveAttribute("type", "text");
    expect(input).toHaveAttribute("inputmode", "decimal");
    expect(screen.getByText("$")).toBeInTheDocument();
  });
  it("percent field takes digits only", async () => {
    const Demo = () => {
      const [v, setV] = useState("");
      return <PercentField label="Adj" value={v} onChange={setV} />;
    };
    wrap(<Demo />);
    await userEvent.type(screen.getByLabelText("Adj"), "1.5");
    expect(screen.getByLabelText("Adj")).toHaveValue("15");
  });
  it("status chip shows the text, not only a colour", () => {
    wrap(<StatusChip status="paused" />);
    expect(screen.getByText("paused")).toBeInTheDocument();
  });
});

describe("feedback", () => {
  it("confirm dialog names the consequence and disables every button while busy", () => {
    wrap(
      <ConfirmDialog
        open
        title="Confirm Pause 3 Campaigns"
        consequence="They stop delivering."
        confirmLabel="Pause"
        busy
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(screen.getByRole("alertdialog")).toHaveTextContent("They stop delivering.");
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Working…" })).toBeDisabled();
  });
  it("a bulk result with zero successes is an error, partial success a warning (UX-13)", async () => {
    const Demo = () => {
      const bulk = useBulkResultToast();
      return <button onClick={() => bulk({ ok: 0, failed: 2 })}>go</button>;
    };
    wrap(<Demo />);
    await userEvent.click(screen.getByText("go"));
    expect(await screen.findByRole("alert")).toHaveTextContent("2 failed");
  });
  it("error card copies its content", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    wrap(<ErrorCard message="Boom" status={500} details="req-1" />);
    await userEvent.click(screen.getByRole("button", { name: "Copy error content" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Status: 500\nBoom\nreq-1"));
  });
});

describe("bulk bar (UX-12)", () => {
  const action = {
    id: "pause",
    label: "Pause",
    confirm: { title: "Confirm Pause 2 Campaigns", consequence: "Stops delivery." },
    run: vi.fn(),
  };
  it("renders only with a selection and edit permission", () => {
    const { unmount } = wrap(<BulkActionBar count={0} actions={[action]} onClear={() => {}} />);
    expect(screen.queryByRole("toolbar")).toBeNull();
    unmount();
    const second = wrap(
      <BulkActionBar count={2} actions={[action]} permission="ads.write" onClear={() => {}} />,
      ["ads.read"],
    );
    expect(screen.queryByRole("toolbar")).toBeNull();
    second.unmount();
    wrap(<BulkActionBar count={2} actions={[action]} permission="ads.write" onClear={() => {}} />);
    expect(screen.getByRole("toolbar")).toBeInTheDocument();
  });
  it("asks for confirmation before running", async () => {
    wrap(<BulkActionBar count={2} actions={[action]} permission="ads.write" onClear={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(action.run).not.toHaveBeenCalled();
    await userEvent.click(within_dialog("Pause"));
    await waitFor(() => expect(action.run).toHaveBeenCalledTimes(1));
  });
});
function within_dialog(name: string) {
  const dialog = screen.getByRole("alertdialog");
  const buttons = Array.from(dialog.querySelectorAll("button")).filter(
    (b) => b.textContent === name,
  );
  return buttons[0]!;
}

describe("charts and cards", () => {
  it("KPI card shows a dash for no data and a skeleton while loading", () => {
    const { rerender } = wrap(<KpiCard label="TACoS" value={null} />);
    expect(screen.getByRole("group", { name: "TACoS" })).toHaveTextContent("—");
    rerender(
      <ThemeProvider>
        <PermissionProvider permissions={[]}>
          <KpiCard label="TACoS" value={null} loading />
        </PermissionProvider>
      </ThemeProvider>,
    );
    expect(screen.getByRole("group", { name: "TACoS" })).toHaveAttribute("aria-busy", "true");
  });
  it("chart reports its state", () => {
    wrap(<TimeSeriesChart label="Sales" series={[{ id: "s", label: "Sales" }]} data={[]} />);
    expect(screen.getByRole("img", { name: "Sales" })).toHaveAttribute("data-state", "empty");
  });
});

describe("AppShell (UX-25)", () => {
  it("is collapsed by default, marks the active route and shows breadcrumbs and title", async () => {
    wrap(
      <AppShell
        sections={[
          {
            id: "s",
            label: "Section",
            items: [
              { id: "a", label: "Alpha", href: "/alpha" },
              { id: "b", label: "Beta", href: "/beta" },
            ],
          },
        ]}
        currentPath="/beta/detail"
        title="Beta detail"
        breadcrumbs={[{ label: "Beta", href: "/beta" }, { label: "Detail" }]}
      >
        body
      </AppShell>,
    );
    expect(screen.getByTestId("sidebar")).toHaveAttribute("data-expanded", "false");
    expect(screen.getAllByRole("link", { name: "Beta" })[0]).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Beta detail");
    await userEvent.click(screen.getByRole("button", { name: "Expand menu" }));
    expect(screen.getByTestId("sidebar")).toHaveAttribute("data-expanded", "true");
  });
});
