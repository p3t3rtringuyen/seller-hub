import { addDays, daysBetween, localDateOf, type LocalDate } from "@seller-hub/core";
import { scopeKindOf } from "./definitions";
import type { PullDefinition, SyncTarget } from "./types";

// Windows are marketplace-local dates (conventions §6): Ads v1 reports and every facts.*.date are keyed by the local
// date of the Ads profile (else the marketplace), never by the UTC date.

/** Offset of `timeZone` from UTC at the instant `ms`, in milliseconds. */
function zoneOffsetMs(ms: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(ms));
  const n = (t: string): number => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** The instant at which local date `date` starts in `timeZone`. */
export function localMidnight(date: LocalDate, timeZone: string): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d);
  let t = guess - zoneOffsetMs(guess, timeZone);
  t = guess - zoneOffsetMs(t, timeZone); // second pass settles a DST edge
  return new Date(t);
}

/** Inclusive local dates covered by a window `[start, end)`. */
export function windowDates(
  window: { start: Date | null; end: Date | null },
  timeZone: string,
): { from: LocalDate; to: LocalDate } | null {
  if (!window.start || !window.end) return null;
  return {
    from: localDateOf(window.start, timeZone),
    to: localDateOf(new Date(window.end.getTime() - 1), timeZone),
  };
}

/** The zone a run's dates are in: the Ads profile, else the marketplace, else the account default, else UTC. */
export function timeZoneFor(target: SyncTarget, def: PullDefinition, scopeKey: string): string {
  const kind = scopeKindOf(def);
  if (kind === "ads-profile") {
    const p = target.adsProfiles.find((x) => x.profileId === scopeKey);
    if (p?.timeZone) return p.timeZone;
    if (p?.marketplaceId && target.marketplaceTimeZones?.[p.marketplaceId])
      return target.marketplaceTimeZones[p.marketplaceId] as string;
  }
  if (kind === "marketplace" && target.marketplaceTimeZones?.[scopeKey])
    return target.marketplaceTimeZones[scopeKey] as string;
  return target.timeZone ?? "UTC";
}

/**
 * Window for a scheduled run (ADR-0008 decision 6: a lookback that converges restatements, never a full re-pull).
 * `lookbackDays` local days back from today, extended back to the last window's end date after a gap, at most
 * `maxRangeDays` days long (the next runs catch up).
 */
export function computeWindow(
  def: PullDefinition,
  cursor: Record<string, unknown>,
  now: Date,
  timeZone = "UTC",
): { start: Date | null; end: Date | null } {
  const w = def.window;
  if (!w?.lookbackDays) return { start: null, end: null };
  const today = localDateOf(now, timeZone);
  let from = addDays(today, -w.lookbackDays);
  const last = typeof cursor.windowEnd === "string" ? new Date(cursor.windowEnd) : null;
  if (last && !Number.isNaN(last.getTime())) {
    const lastDate = localDateOf(new Date(last.getTime() - 1), timeZone);
    if (lastDate < from) from = lastDate; // catch up after a gap
  }
  let to = today;
  const max = w.maxRangeDays ?? 31;
  if (daysBetween(from, to) + 1 > max) to = addDays(from, max - 1);
  return {
    start: localMidnight(from, timeZone),
    end: to === today ? now : localMidnight(addDays(to, 1), timeZone),
  };
}

/** Splits inclusive local dates into chunks of at most `maxRangeDays`, newest first. */
export function backfillWindows(
  from: LocalDate,
  to: LocalDate,
  maxRangeDays: number,
  timeZone: string,
): { start: Date; end: Date }[] {
  const out: { start: Date; end: Date }[] = [];
  for (let end = to; end >= from; end = addDays(end, -maxRangeDays)) {
    let start = addDays(end, -(maxRangeDays - 1));
    if (start < from) start = from;
    out.push({
      start: localMidnight(start, timeZone),
      end: localMidnight(addDays(end, 1), timeZone),
    });
  }
  return out;
}
