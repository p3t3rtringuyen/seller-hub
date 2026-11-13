import { toIngestDefinitions } from "@seller-hub/ingestion";
import { describe, expect, it } from "vitest";
import { commands, jobs, syncs } from "../src/registry.generated";

// The worker boots from the generated registry (tools/registry globs *.sync.ts, *.job.ts and *.command.ts).
// This keeps the contract between the generator and the engine: whatever the generator found must pass the engine's
// boot-time validation, otherwise `pnpm dev` would refuse to start.
describe("generated worker registry", () => {
  it("exposes the three registries as arrays", () => {
    expect(Array.isArray(syncs)).toBe(true);
    expect(Array.isArray(jobs)).toBe(true);
    expect(Array.isArray(commands)).toBe(true);
  });

  it("every registered sync definition passes the engine's validation", () => {
    expect(() => toIngestDefinitions(syncs.map((s) => s.value))).not.toThrow();
  });
});
