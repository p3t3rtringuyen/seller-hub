// UX-01: money, percentages and counts are text fields that refuse disallowed characters while typing
// (no e/E/+/-, no spinner). Pure functions; the components call them on every change.

export type NumericKind = "money" | "integer" | "percent" | "decimal";

export interface SanitizeOptions {
  /** Maximum digits after the dot (money: currency exponent, default 2; decimal: default 2). */
  decimals?: number;
  /** Capped while typing, not afterwards: a keystroke that would exceed it is refused. */
  max?: number;
}

function keepDigitsAndOneDot(raw: string): string {
  let out = "";
  let dot = false;
  for (const ch of raw) {
    if (ch >= "0" && ch <= "9") out += ch;
    else if (ch === "." && !dot) {
      dot = true;
      out += ch;
    }
  }
  return out;
}

/** Digits and exactly one dot; the fraction is cut to `decimals`. A bid is `0.35`, the dot is never stripped. */
export function sanitizeDecimal(
  raw: string,
  { decimals = 2, max }: SanitizeOptions = {},
  previous = "",
): string {
  const kept = keepDigitsAndOneDot(raw);
  const [int = "", frac] = kept.split(".");
  const trimmedInt = int.replace(/^0+(?=\d)/, "");
  let next = trimmedInt;
  if (frac !== undefined && decimals > 0) next = `${trimmedInt || "0"}.${frac.slice(0, decimals)}`;
  if (max !== undefined && next !== "" && Number(next) > max) return previous;
  return next;
}

/** Whole numbers: digits only. A pasted `15.39` keeps its integer part (15). */
export function sanitizeInteger(raw: string, { max }: SanitizeOptions = {}, previous = ""): string {
  const integerPart = keepDigitsAndOneDot(raw).split(".")[0] ?? "";
  const next = integerPart.replace(/^0+(?=\d)/, "");
  if (max !== undefined && next !== "" && Number(next) > max) return previous;
  return next;
}

export function sanitizeNumeric(
  kind: NumericKind,
  raw: string,
  options: SanitizeOptions = {},
  previous = "",
): string {
  if (kind === "money" || kind === "decimal") {
    return sanitizeDecimal(raw, { decimals: 2, ...options }, previous);
  }
  return sanitizeInteger(raw, options, previous);
}

/** When a field switches between money and percent, trim the carried value to what the new field accepts. */
export function carryOver(value: string, to: NumericKind, options: SanitizeOptions = {}): string {
  return sanitizeNumeric(to, value, options);
}

/** Currency symbol for an ISO 4217 code; never a literal `$`. */
export function currencySymbol(currency: string, locale = "en"): string {
  try {
    const parts = new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
    }).formatToParts(0);
    return parts.find((p) => p.type === "currency")?.value ?? currency;
  } catch {
    return currency;
  }
}

/** Decimal digits of a currency (USD 2, JPY 0). */
export function currencyDecimals(currency: string, locale = "en"): number {
  try {
    return (
      new Intl.NumberFormat(locale, { style: "currency", currency }).resolvedOptions()
        .maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}
