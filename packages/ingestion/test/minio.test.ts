import { loadConfig, loadEnvFile } from "@seller-hub/config";
import { describe, expect, it } from "vitest";
import { S3ObjectStore } from "../src/object-store";

// Real MinIO from the compose stack (skipped when it is not up; SH_REQUIRE_DB=1 makes that a failure).
loadEnvFile();
const cfg = loadConfig({ ...process.env, NODE_ENV: "test" });
const store = new S3ObjectStore({
  endpoint: cfg.s3Endpoint,
  region: cfg.env.SH_S3_REGION,
  bucket: `${cfg.env.SH_S3_BUCKET}-ingest-test`,
  accessKey: cfg.env.SH_S3_ACCESS_KEY,
  secretKey: cfg.env.SH_S3_SECRET_KEY,
});

let reachable = true;
try {
  await store.ensureBucket();
} catch (e) {
  if (process.env.SH_REQUIRE_DB === "1") throw e;
  console.warn(`[ingestion test] no object store (${(e as Error).message}); skipped`);
  reachable = false;
}

describe.skipIf(!reachable)("S3ObjectStore against MinIO", () => {
  it("puts and gets a landed document (SigV4 accepted by the server) and returns null for a missing key", async () => {
    const key = `raw/t/s/k.k/2026/11/13/run-${Date.now()}/0`;
    await store.put(key, new TextEncoder().encode("a\tb\n1\t2\n"), "text/tab-separated-values");
    expect(new TextDecoder().decode((await store.get(key)) as Uint8Array)).toBe("a\tb\n1\t2\n");
    expect(await store.get(`${key}-missing`)).toBeNull();
  });
});
