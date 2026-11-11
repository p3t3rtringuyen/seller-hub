import { Temporal } from "@js-temporal/polyfill";

// Time library decision (conventions §6): @js-temporal/polyfill, wrapped here. Business dates are
// marketplace-local `YYYY-MM-DD` strings; instants are ISO 8601 with Z. Nothing else imports Temporal.

export type LocalDate = string; // YYYY-MM-DD

export function isValidTimeZone(tz: string): boolean {
  try {
    Temporal.Now.zonedDateTimeISO(tz);
    return true;
  } catch {
    return false;
  }
}

/** The marketplace-local date of an instant. */
export function localDateOf(instant: Date | string, timeZone: string): LocalDate {
  const iso = instant instanceof Date ? instant.toISOString() : instant;
  return Temporal.Instant.from(iso).toZonedDateTimeISO(timeZone).toPlainDate().toString();
}

/** "Today" in the marketplace time zone (UX-17): computed on the server, never from the browser. */
export const todayIn = (timeZone: string, now: Date = new Date()): LocalDate =>
  localDateOf(now, timeZone);

export const addDays = (date: LocalDate, days: number): LocalDate =>
  Temporal.PlainDate.from(date).add({ days }).toString();

export function daysBetween(from: LocalDate, to: LocalDate): number {
  return Temporal.PlainDate.from(from).until(Temporal.PlainDate.from(to), { largestUnit: "day" })
    .days;
}

/** Inclusive list of dates from `from` to `to`. */
export function dateRange(from: LocalDate, to: LocalDate): LocalDate[] {
  const n = daysBetween(from, to);
  return n < 0 ? [] : Array.from({ length: n + 1 }, (_, i) => addDays(from, i));
}

export const isLocalDate = (v: string): boolean => {
  try {
    return Temporal.PlainDate.from(v, { overflow: "reject" }).toString() === v;
  } catch {
    return false;
  }
};
