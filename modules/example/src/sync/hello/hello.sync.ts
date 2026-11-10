import { defineSync } from "@seller-hub/core";

// EXAMPLE sync definition (ADR-0008 shape, discovered from sync/<key>/*.sync.ts). P3-INGEST adds the runner
// families and the real fields (buildRequest / parse / upsert); the key must be unique and start with "<module>.".
export default defineSync({
  key: "example.hello-refresh",
  family: "example",
  schedule: { every: "6h", jitter: "30m" },
});
