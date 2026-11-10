import Decimal from "decimal.js";

// No float arithmetic on money or ratios (conventions §5). Amounts travel as decimal strings.
const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export interface Money {
  amount: string;
  currency: string;
}

export const dec = (v: string | number | Decimal): Decimal => new D(v);

export function money(amount: string | number | Decimal, currency: string): Money {
  return { amount: dec(amount).toFixed(), currency };
}

function same(a: Money, b: Money): void {
  if (a.currency !== b.currency)
    throw new Error(`currency mismatch: ${a.currency} vs ${b.currency}`);
}

export const addMoney = (a: Money, b: Money): Money => (
  same(a, b),
  money(dec(a.amount).plus(b.amount), a.currency)
);
export const subMoney = (a: Money, b: Money): Money => (
  same(a, b),
  money(dec(a.amount).minus(b.amount), a.currency)
);
export const mulMoney = (a: Money, factor: string | number): Money =>
  money(dec(a.amount).times(factor), a.currency);

/** `percent` is a percentage, e.g. "10" for 10 %. */
export const percentOf = (a: Money, percent: string | number): Money =>
  money(dec(a.amount).times(percent).div(100), a.currency);

/** Rounds to `minorUnits` decimals (USD 2, JPY 0) — only at the edge. */
export const roundMoney = (a: Money, minorUnits: number): Money =>
  money(dec(a.amount).toDecimalPlaces(minorUnits, Decimal.ROUND_HALF_UP), a.currency);

export const sumDecimals = (values: readonly string[]): string =>
  values.reduce((acc, v) => acc.plus(v), dec(0)).toFixed();

/**
 * Ratio of summed numerator over summed denominator (ACOS, CTR, ...), 4 places, null when the
 * denominator is zero. Never average ratios.
 */
export function ratio(numerator: string, denominator: string, places = 4): string | null {
  const den = dec(denominator);
  if (den.isZero()) return null;
  return dec(numerator).div(den).toFixed(places, Decimal.ROUND_HALF_UP);
}

export const compareDecimals = (a: string, b: string): -1 | 0 | 1 =>
  dec(a).comparedTo(b) as -1 | 0 | 1;
