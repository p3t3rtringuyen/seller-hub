import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { fixturesDir } from "./test-db";

/**
 * Loads an Amazon replay/mock fixture: `packages/testing/fixtures/<api>/<operation>/<key>--<case>.json|.json.gz`
 * (BACKLOG §1.2: the file name starts with the slice key). Fixtures are synthetic or redacted: no tokens,
 * no real seller ids, no PII.
 */
export function loadFixture<T = unknown>(api: string, operation: string, name: string): T {
  const base = join(fixturesDir(), api, operation, name);
  let raw: Buffer;
  try {
    raw = readFileSync(`${base}.json`);
  } catch {
    raw = gunzipSync(readFileSync(`${base}.json.gz`));
  }
  return JSON.parse(raw.toString("utf8")) as T;
}
