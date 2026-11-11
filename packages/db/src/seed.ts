import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { findRepoRoot } from "@seller-hub/config";
import type { Database } from "./client";

/** `modules/<m>/seed/<k>.seed.ts` default-exports a SeedDefinition. Synthetic data only (no real data). */
export interface SeedContext {
  /** Connected as sh_owner (seeds bypass RLS on purpose). */
  db: Database;
  log: (msg: string) => void;
}

export interface SeedDefinition {
  /** `<module>.<key>`. */
  name: string;
  run: (ctx: SeedContext) => Promise<void>;
}
export const defineSeed = (s: SeedDefinition): SeedDefinition => s;

/** Fixed ids of the fixture tenant so e2e specs and other seeds can refer to them. */
export const FIXTURE = {
  tenantId: "01900000-0000-7000-8000-000000000001",
  tenantName: "Fixture Tenant",
  sellerAccountId: "01900000-0000-7000-8000-000000000002",
  sellerAccountName: "Fixture Seller (US)",
  otherTenantId: "01900000-0000-7000-8000-000000000011",
  otherSellerAccountId: "01900000-0000-7000-8000-000000000012",
} as const;

interface SeedsIndex {
  seeds: { file: string; module: string; key: string }[];
}

export async function runSeeds(ctx: SeedContext, root: string = findRepoRoot()): Promise<string[]> {
  const files = [join(root, "packages", "db", "seed", "platform.seed.ts")];
  const index = join(root, "db", "migrations", "seeds.generated.json");
  if (existsSync(index)) {
    const parsed = JSON.parse(readFileSync(index, "utf8")) as SeedsIndex;
    for (const s of parsed.seeds) files.push(join(root, s.file));
  }
  const ran: string[] = [];
  for (const file of files) {
    const mod = (await import(pathToFileURL(file).href)) as { default?: SeedDefinition };
    const seed = mod.default;
    if (!seed || typeof seed.run !== "function")
      throw new Error(`${file}: default export must be a SeedDefinition`);
    await seed.run(ctx);
    ran.push(seed.name);
  }
  return ran;
}
