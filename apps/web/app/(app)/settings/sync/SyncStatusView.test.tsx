import { ThemeProvider } from "@seller-hub/ui";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { copy } from "./copy";
import {
  formatDuration,
  formatLag,
  SyncStatusView,
  type SyncStatusViewProps,
} from "./SyncStatusView";
import type { SyncHealth, SyncHealthItem } from "./sync-types";

const NOW = Date.parse("2026-11-13T12:00:00Z");

const item = (over: Partial<SyncHealthItem>): SyncHealthItem => ({
  syncKey: "listings.merchant-listings",
  scopeKey: "ATVPDKIKX0DER",
  description: "Merchant listings (full report)",
  family: "spapi-report",
  status: "idle",
  freshness: "fresh",
  pausedReason: null,
  lastSuccessAt: "2026-11-13T11:00:00Z",
  lastFailureAt: null,
  lagSeconds: 3600,
  nextRunAt: "2026-11-13T17:00:00Z",
  consecutiveFailures: 0,
  lastErrorCode: null,
  lastRun: { rows: 1200, durationMs: 4200, throttles: 2 },
  runningRuns: 0,
  ...over,
});

const data = (items: SyncHealthItem[]): SyncHealth => ({
  items,
  generatedAt: "2026-11-13T12:00:00Z",
  recentRuns: [
    {
      id: "r1",
      syncKey: "listings.merchant-listings",
      priority: "scheduled",
      state: "done",
      startedAt: "2026-11-13T11:00:00Z",
      finishedAt: "2026-11-13T11:00:04Z",
      durationMs: 4200,
      rows: 1200,
      attempts: 0,
      errorCode: null,
      errorDetail: null,
    },
  ],
});

function view(over: Partial<SyncStatusViewProps>) {
  const props: SyncStatusViewProps = {
    state: "ready",
    data: data([item({})]),
    canRefresh: true,
    onReload: vi.fn(),
    onRefreshNow: vi.fn(),
    now: NOW,
    ...over,
  };
  render(
    <ThemeProvider>
      <SyncStatusView {...props} />
    </ThemeProvider>,
  );
  return props;
}

describe("SyncStatusView", () => {
  it("shows a loading status and disables Reload", () => {
    view({ state: "loading", data: undefined });
    expect(screen.getByRole("status")).toHaveTextContent(copy.loading);
    expect(screen.getByRole("button", { name: copy.reload })).toBeDisabled();
  });

  it("shows the error in place with Retry (UX-20)", () => {
    const p = view({ state: "error", data: undefined, error: { message: "boom", status: 501 } });
    expect(screen.getByRole("alert")).toHaveTextContent("boom");
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(p.onReload).toHaveBeenCalled();
  });

  it("shows a specific empty state when the account has no syncs", () => {
    view({ data: data([]) });
    expect(screen.getByText(copy.emptyTitle)).toBeInTheDocument();
  });

  it("renders one row per sync with freshness, lag, last run and throttles", () => {
    view({
      data: data([
        item({}),
        item({
          syncKey: "ads.sp-report-daily",
          scopeKey: "1234567890",
          freshness: "failing",
          lastErrorCode: "AmazonValidationError",
          lastRun: null,
        }),
      ]),
    });
    const rows = screen.getAllByTestId("sync-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText(copy.freshness.fresh)).toBeInTheDocument();
    expect(within(rows[0]!).getByText(/1,200 rows · 4\.2 s · 2 throttled/)).toBeInTheDocument();
    expect(within(rows[0]!).getByText("60 min ago")).toBeInTheDocument();
    expect(rows[1]).toHaveAttribute("data-freshness", "failing");
    expect(within(rows[1]!).getByText("AmazonValidationError")).toBeInTheDocument();
    expect(screen.getAllByTestId("run-row")).toHaveLength(1);
  });

  it("explains a paused sync and locks its Refresh button", () => {
    view({
      data: data([item({ freshness: "paused", status: "paused", pausedReason: "needs_reauth" })]),
    });
    expect(screen.getByText(copy.paused.needs_reauth as string)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: copy.refreshNow })).toBeDisabled();
  });

  it("hides Refresh now without permission and calls back with the row otherwise", () => {
    view({ canRefresh: false });
    expect(screen.queryByRole("button", { name: copy.refreshNow })).toBeNull();
  });

  it("calls onRefreshNow with the clicked sync", () => {
    const p = view({});
    fireEvent.click(screen.getByRole("button", { name: copy.refreshNow }));
    expect(p.onRefreshNow).toHaveBeenCalledWith(
      expect.objectContaining({ syncKey: "listings.merchant-listings" }),
    );
  });

  it("formats lag and duration for people", () => {
    expect(formatLag(30)).toBe("just now");
    expect(formatLag(7200)).toBe("2 h ago");
    expect(formatLag(null)).toBe(copy.never);
    expect(formatDuration(900)).toBe("900 ms");
    expect(formatDuration(200_000)).toBe("3 min");
  });
});
