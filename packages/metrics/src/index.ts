// Metric definitions shared by api and web (conventions §5). A domain directory
// (`packages/metrics/src/<domain>/*.metric.ts`) is owned by the slice that defines it; `index.generated.ts`
// is produced by `pnpm gen`. Ratios are computed from SUMMED numerators and denominators, never averaged.
import { ratio, sumDecimals } from "@seller-hub/core";

export { metrics } from "./index.generated";

/** Ratio over a set of rows: sum(numerator) / sum(denominator), `null` when the denominator sums to 0. */
export function sumRatio(
  rows: readonly Record<string, string>[],
  numerator: string,
  denominator: string,
): string | null {
  const total = (field: string) => sumDecimals(rows.map((r) => r[field] ?? "0"));
  return ratio(total(numerator), total(denominator));
}
