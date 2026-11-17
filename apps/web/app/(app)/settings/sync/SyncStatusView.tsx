"use client";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { EmptyState, ErrorCard, StatusChip, type StatusTone } from "@seller-hub/ui";
import { copy } from "./copy";
import type { Freshness, JobRunItem, SyncHealth, SyncHealthItem } from "./sync-types";

// Presentational part of the sync status screen (UX-20: loading, empty, error and data states in place).
// The container (SyncStatusScreen) owns fetching; this component is pure and unit-tested.

const TONE: Record<Freshness, StatusTone> = {
  fresh: "success",
  stale: "warning",
  failing: "error",
  paused: "warning",
  never: "neutral",
};

export function formatLag(seconds: number | null): string {
  if (seconds === null) return copy.never;
  if (seconds < 90) return "just now";
  const m = Math.round(seconds / 60);
  if (m < 90) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return copy.never;
  if (ms < 1_000) return `${ms} ms`;
  if (ms < 90_000) return `${(ms / 1_000).toFixed(1)} s`;
  return `${Math.round(ms / 60_000)} min`;
}

function formatTime(iso: string | null, now: number): string {
  if (!iso) return copy.never;
  const diff = new Date(iso).getTime() - now;
  if (diff > 0) {
    const m = Math.round(diff / 60_000);
    return m < 1 ? "in under a minute" : m < 90 ? `in ${m} min` : `in ${Math.round(m / 60)} h`;
  }
  return formatLag(Math.round(-diff / 1000));
}

export interface SyncStatusViewProps {
  state: "loading" | "error" | "ready";
  data?: SyncHealth | undefined;
  error?: { message: string; status?: number | string } | undefined;
  /** Permission to start a refresh (`sync.refresh`). */
  canRefresh: boolean;
  onReload: () => void;
  onRefreshNow: (item: SyncHealthItem) => void;
  /** Sync keys (`key|scope`) with a refresh request in flight. */
  refreshing?: ReadonlySet<string>;
  /** Result of the last refresh click, shown above the tables. */
  notice?: { kind: "success" | "error"; text: string } | undefined;
  now?: number;
}

export function SyncStatusView(p: SyncStatusViewProps) {
  const now = p.now ?? Date.now();
  return (
    <Stack spacing={3} component="section" aria-labelledby="sync-title">
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={2}>
        <Box>
          <Typography id="sync-title" variant="h5" component="h1">
            {copy.title}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {copy.subtitle}
          </Typography>
        </Box>
        <Button
          variant="outlined"
          size="small"
          onClick={p.onReload}
          disabled={p.state === "loading"}
        >
          {copy.reload}
        </Button>
      </Stack>

      {p.notice ? (
        <Typography
          role="status"
          color={p.notice.kind === "error" ? "error" : "success.main"}
          variant="body2"
        >
          {p.notice.text}
        </Typography>
      ) : null}

      {p.state === "loading" ? (
        <Typography role="status" aria-live="polite" color="text.secondary">
          {copy.loading}
        </Typography>
      ) : null}

      {p.state === "error" ? (
        <ErrorCard
          title={copy.errorTitle}
          message={p.error?.message ?? ""}
          {...(p.error?.status !== undefined ? { status: p.error.status } : {})}
          onRetry={p.onReload}
        />
      ) : null}

      {p.state === "ready" && p.data && p.data.items.length === 0 ? (
        <EmptyState title={copy.emptyTitle} description={copy.emptyBody} />
      ) : null}

      {p.state === "ready" && p.data && p.data.items.length > 0 ? (
        <>
          <SyncTable
            items={p.data.items}
            now={now}
            canRefresh={p.canRefresh}
            onRefreshNow={p.onRefreshNow}
            refreshing={p.refreshing ?? new Set()}
          />
          <RunsTable runs={p.data.recentRuns} now={now} />
        </>
      ) : null}
    </Stack>
  );
}

function SyncTable(p: {
  items: SyncHealthItem[];
  now: number;
  canRefresh: boolean;
  onRefreshNow: (item: SyncHealthItem) => void;
  refreshing: ReadonlySet<string>;
}) {
  const c = copy.columns;
  return (
    <Box>
      <Typography variant="h6" component="h2" gutterBottom>
        {copy.syncsHeading}
      </Typography>
      <TableContainer>
        <Table size="small" aria-label={copy.syncsHeading}>
          <TableHead>
            <TableRow>
              <TableCell>{c.sync}</TableCell>
              <TableCell>{c.status}</TableCell>
              <TableCell>{c.lastSuccess}</TableCell>
              <TableCell>{c.nextRun}</TableCell>
              <TableCell>{c.lastRun}</TableCell>
              <TableCell>{c.error}</TableCell>
              {p.canRefresh ? <TableCell align="right">{c.actions}</TableCell> : null}
            </TableRow>
          </TableHead>
          <TableBody>
            {p.items.map((i) => {
              const id = `${i.syncKey}|${i.scopeKey}`;
              return (
                <TableRow key={id} data-testid="sync-row" data-freshness={i.freshness}>
                  <TableCell>
                    <Typography variant="body2" fontWeight={600}>
                      {i.description ?? i.syncKey}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {i.syncKey}
                      {i.scopeKey ? ` · ${i.scopeKey}` : ""}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <StatusChip
                      status={i.freshness}
                      label={copy.freshness[i.freshness]}
                      tone={TONE[i.freshness]}
                    />
                    {i.pausedReason ? (
                      <Typography variant="caption" display="block" color="text.secondary">
                        {copy.paused[i.pausedReason] ?? i.pausedReason}
                      </Typography>
                    ) : null}
                    {i.runningRuns > 0 ? (
                      <Typography variant="caption" display="block" color="text.secondary">
                        {copy.runningNow(i.runningRuns)}
                      </Typography>
                    ) : null}
                  </TableCell>
                  <TableCell>{formatLag(i.lagSeconds)}</TableCell>
                  <TableCell>{formatTime(i.nextRunAt, p.now)}</TableCell>
                  <TableCell>
                    {i.lastRun ? (
                      <>
                        {copy.rowsUnit(i.lastRun.rows)} · {formatDuration(i.lastRun.durationMs)}
                        {i.lastRun.throttles > 0 ? ` · ${copy.throttled(i.lastRun.throttles)}` : ""}
                      </>
                    ) : (
                      copy.never
                    )}
                  </TableCell>
                  <TableCell>{i.lastErrorCode ?? copy.never}</TableCell>
                  {p.canRefresh ? (
                    <TableCell align="right">
                      <Button
                        size="small"
                        onClick={() => p.onRefreshNow(i)}
                        disabled={p.refreshing.has(id) || i.freshness === "paused"}
                      >
                        {copy.refreshNow}
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}

function RunsTable({ runs, now }: { runs: JobRunItem[]; now: number }) {
  const c = copy.columns;
  return (
    <Box>
      <Typography variant="h6" component="h2" gutterBottom>
        {copy.runsHeading}
      </Typography>
      {runs.length === 0 ? (
        <Typography color="text.secondary">{copy.noRuns}</Typography>
      ) : (
        <TableContainer>
          <Table size="small" aria-label={copy.runsHeading}>
            <TableHead>
              <TableRow>
                <TableCell>{c.sync}</TableCell>
                <TableCell>{c.started}</TableCell>
                <TableCell>{c.state}</TableCell>
                <TableCell>{c.priority}</TableCell>
                <TableCell align="right">{c.rows}</TableCell>
                <TableCell align="right">{c.duration}</TableCell>
                <TableCell align="right">{c.attempts}</TableCell>
                <TableCell>{c.error}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {runs.map((r) => (
                <TableRow key={r.id} data-testid="run-row">
                  <TableCell>{r.syncKey}</TableCell>
                  <TableCell>{formatTime(r.startedAt, now)}</TableCell>
                  <TableCell>
                    <StatusChip status={r.state} />
                  </TableCell>
                  <TableCell>{r.priority}</TableCell>
                  <TableCell align="right">{r.rows ?? copy.never}</TableCell>
                  <TableCell align="right">{formatDuration(r.durationMs)}</TableCell>
                  <TableCell align="right">{r.attempts}</TableCell>
                  <TableCell>{r.errorCode ?? copy.never}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
}
