// Date-range logic (UX-17). Business dates are plain `YYYY-MM-DD` strings in the marketplace time zone; "today" is
// supplied by the server (never `new Date()` in the browser) and everything here is calendar arithmetic on those
// strings, so the browser's zone cannot leak in.

export type PresetId =
  | "today"
  | "yesterday"
  | "last7"
  | "last14"
  | "last30"
  | "last90"
  | "thisWeek"
  | "lastWeek"
  | "thisMonth"
  | "lastMonth"
  | "thisYear"
  | "lifetime"
  | "custom";

export interface DateRange {
  from: string;
  to: string;
}
export interface RangeValue extends DateRange {
  preset: PresetId;
}
export interface CompareValueRange {
  enabled: boolean;
  from?: string;
  to?: string;
}

const MS_DAY = 86_400_000;

function parse(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`invalid date: ${iso}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}
function fmt(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export const isIsoDate = (s: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) && fmt(parse(s)) === s;
export const addDays = (iso: string, n: number): string => fmt(parse(iso) + n * MS_DAY);
/** Inclusive number of days in a range. */
export const rangeLength = (r: DateRange): number =>
  Math.round((parse(r.to) - parse(r.from)) / MS_DAY) + 1;
export const minDate = (a: string, b: string): string => (a <= b ? a : b);
export const maxDate = (a: string, b: string): string => (a >= b ? a : b);

/** Day of week, 0 = Monday … 6 = Sunday. */
function weekday(iso: string): number {
  return (new Date(parse(iso)).getUTCDay() + 6) % 7;
}
function startOfMonth(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}
function endOfMonth(iso: string): string {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  return fmt(Date.UTC(y, m, 0));
}

export interface PresetContext {
  /** Today in the marketplace time zone, from the server. */
  today: string;
  /** Earliest date for "Life time" (fixed per account). */
  lifetimeStart?: string;
}

/** Range of a preset; `custom` has none. Weeks start on Monday. */
export function presetRange(preset: Exclude<PresetId, "custom">, ctx: PresetContext): DateRange {
  const { today } = ctx;
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const y = addDays(today, -1);
      return { from: y, to: y };
    }
    case "last7":
      return { from: addDays(today, -6), to: today };
    case "last14":
      return { from: addDays(today, -13), to: today };
    case "last30":
      return { from: addDays(today, -29), to: today };
    case "last90":
      return { from: addDays(today, -89), to: today };
    case "thisWeek":
      return { from: addDays(today, -weekday(today)), to: today };
    case "lastWeek": {
      const start = addDays(today, -weekday(today) - 7);
      return { from: start, to: addDays(start, 6) };
    }
    case "thisMonth":
      return { from: startOfMonth(today), to: today };
    case "lastMonth": {
      const lastDayPrev = addDays(startOfMonth(today), -1);
      return { from: startOfMonth(lastDayPrev), to: endOfMonth(lastDayPrev) };
    }
    case "thisYear":
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    case "lifetime":
      return { from: ctx.lifetimeStart ?? "2015-01-01", to: today };
  }
}

/** The period of the same length that ends the day before `range` starts. */
export function previousPeriod(range: DateRange): DateRange {
  const len = rangeLength(range);
  const to = addDays(range.from, -1);
  return { from: addDays(to, -(len - 1)), to };
}

/** Compare range rule: End autofills Start + (length of the main range - 1); End >= Start. */
export function autofillCompareEnd(compareFrom: string, main: DateRange): string {
  return addDays(compareFrom, rangeLength(main) - 1);
}

export interface RangeIssue {
  field: "from" | "to" | "compareFrom" | "compareTo";
  code: "invalid" | "endBeforeStart" | "future";
}

/** Future days are not allowed (calendar ceiling = today in the marketplace zone). */
export function validateRange(
  value: DateRange,
  compare: CompareValueRange,
  ctx: PresetContext,
): RangeIssue[] {
  const issues: RangeIssue[] = [];
  const check = (from: string, to: string, f: "from" | "compareFrom", t: "to" | "compareTo") => {
    if (!isIsoDate(from)) issues.push({ field: f, code: "invalid" });
    if (!isIsoDate(to)) issues.push({ field: t, code: "invalid" });
    if (isIsoDate(from) && isIsoDate(to) && to < from)
      issues.push({ field: t, code: "endBeforeStart" });
    if (isIsoDate(to) && to > ctx.today) issues.push({ field: t, code: "future" });
    if (isIsoDate(from) && from > ctx.today) issues.push({ field: f, code: "future" });
  };
  check(value.from, value.to, "from", "to");
  // Compare is sent only when both ends are set.
  if (compare.enabled && compare.from && compare.to)
    check(compare.from, compare.to, "compareFrom", "compareTo");
  return issues;
}

/** Compare is sent to the server only when enabled and both dates are set. */
export function compareParams(compare: CompareValueRange): DateRange | null {
  return compare.enabled && compare.from && compare.to
    ? { from: compare.from, to: compare.to }
    : null;
}
