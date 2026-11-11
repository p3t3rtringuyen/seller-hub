import { defineMetric } from "@seller-hub/core";

// EXAMPLE — proves the *.metric.ts convention (BACKLOG §1.2). Delete the folder with modules/example.
export default defineMetric({
  id: "example.ratio",
  formula: "numerator / denominator",
  unit: "ratio",
  direction: "neutral",
  labelKey: "example.hello.metricRatio",
});
