import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { discover } from "../src/discover";
import { generate } from "../src/generate";

// The conventions of BACKLOG §1.2 on a throw-away tree: what is discovered, what is generated, what fails.
function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "sh-registry-"));
  for (const [file, content] of Object.entries({ "modules/m/package.json": "{}", ...files })) {
    const abs = join(root, file);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}
const run = async (files: Record<string, string>) => {
  const root = tree(files);
  return { root, result: await generate(discover(root)) };
};

const GOOD = {
  "modules/m/src/routes/k/k.route.ts": "export default () => {};",
  "modules/m/src/permissions/k.permissions.ts":
    'export default [{ permission: "m.read", roles: ["viewer"] }];',
  "modules/m/src/sync/k/a.sync.ts": 'export default { key: "m.a", family: "paged" };',
  "modules/m/src/jobs/k/a.job.ts": 'export default { queue: "m.a-job", process: async () => 1 };',
  "modules/m/src/commands/k/a.command.ts":
    'export default { kind: "m.thing.do", permission: "m.read", batchMax: 5, payloadSchema: {}, apply: async () => [] };',
  "modules/m/src/public/k.ts": "export const x = 1;",
  "modules/m/seed/k.seed.ts": 'export default { name: "m.k", run: async () => {} };',
  "modules/m/migrations/20261110000100_m_k_create-things.sql": "select 1;",
  "apps/web/features/m/k/k.nav.ts":
    'export default { id: "m.k", labelKey: "nav", href: "/m", section: "m", order: 1, permission: "m.read" };',
  "apps/web/features/m/k/k.slot.tsx":
    'export default { slot: "m.page.extras", component: () => null, order: 5 };',
  "apps/web/messages/en/m.k.json": '{"a":"b"}',
  "packages/metrics/src/m/x.metric.ts": 'export default { id: "m.x" };',
};

describe("registry generator", () => {
  it("discovers every convention and writes the generated files", async () => {
    const { root, result } = await run(GOOD);
    expect(result.errors).toEqual([]);
    expect(result.summary).toMatchObject({
      routes: 1,
      permissions: 1,
      syncs: 1,
      jobs: 1,
      commands: 1,
      migrations: 1,
      seeds: 1,
      navs: 1,
      slots: 1,
      messages: 1,
      metrics: 1,
    });
    const api = readFileSync(join(root, "apps/api/src/registry.generated.ts"), "utf8");
    expect(api).toContain("modules/m/src/routes/k/k.route");
    expect(api).toContain("modules/m/src/permissions/k.permissions");
    const worker = readFileSync(join(root, "apps/worker/src/registry.generated.ts"), "utf8");
    expect(worker).toContain("modules/m/src/sync/k/a.sync");
    expect(worker).toContain("modules/m/src/jobs/k/a.job");
    expect(readFileSync(join(root, "modules/m/src/public.generated.ts"), "utf8")).toContain(
      'export * from "./public/k";',
    );
    expect(
      JSON.parse(readFileSync(join(root, "db/migrations/index.generated.json"), "utf8"))
        .migrations[0],
    ).toMatchObject({ module: "m", key: "k" });
    expect(readFileSync(join(root, "apps/web/messages.generated.ts"), "utf8")).toContain('"m.k"');
  });

  it("is deterministic (same input, same bytes)", async () => {
    const { root } = await run(GOOD);
    const first = readFileSync(join(root, "apps/api/src/registry.generated.ts"), "utf8");
    await generate(discover(root));
    expect(readFileSync(join(root, "apps/api/src/registry.generated.ts"), "utf8")).toBe(first);
  });

  it("fails on a duplicate sync key, command kind and queue", async () => {
    const { result } = await run({
      ...GOOD,
      "modules/m/src/sync/k/b.sync.ts": 'export default { key: "m.a", family: "paged" };',
      "modules/m/src/jobs/k/b.job.ts":
        'export default { queue: "m.a-job", process: async () => 1 };',
      "modules/m/src/commands/k/b.command.ts":
        'export default { kind: "m.thing.do", permission: "m.read", batchMax: 5, payloadSchema: {}, apply: async () => [] };',
    });
    expect(result.errors.join("\n")).toMatch(/duplicate sync key m\.a/);
    expect(result.errors.join("\n")).toMatch(/duplicate queue m\.a-job/);
    expect(result.errors.join("\n")).toMatch(/duplicate command kind m\.thing\.do/);
  });

  it("rejects a sync key outside the module namespace and a queue not named <module>.<job>", async () => {
    const { result } = await run({
      "modules/m/src/sync/k/a.sync.ts": 'export default { key: "other.a", family: "paged" };',
      "modules/m/src/jobs/k/a.job.ts": 'export default { queue: "a-job", process: async () => 1 };',
    });
    expect(result.errors.join("\n")).toMatch(/must start with "m\."/);
  });

  it("rejects a command that uses an undeclared permission", async () => {
    const { result } = await run({
      "modules/m/src/commands/k/a.command.ts":
        'export default { kind: "m.thing.do", permission: "m.nope", batchMax: 5, payloadSchema: {}, apply: async () => [] };',
    });
    expect(result.errors.join("\n")).toMatch(/no \*\.permissions\.ts declares/);
  });

  it("rejects malformed migration names, duplicate timestamps and files without a module package", async () => {
    const { result } = await run({
      "modules/m/migrations/20261110000100_wrongmodule_k_x.sql": "select 1;",
      "modules/m/migrations/20261110000200_m_k_ok.sql": "select 1;",
      "modules/m/migrations/20261110000200_m_j_dup.sql": "select 1;",
      "modules/orphan/src/routes/k/k.route.ts": "export default () => {};",
    });
    const text = result.errors.join("\n");
    expect(text).toMatch(/wrongmodule/);
    expect(text).toMatch(/timestamp 20261110000200 is also used/);
    expect(text).toMatch(/modules\/orphan has no package\.json/);
  });

  it("rejects bad nav entries, slot files and permission roles", async () => {
    const { result } = await run({
      "modules/m/src/permissions/k.permissions.ts":
        'export default [{ permission: "m.read", roles: ["boss"] }];',
      "apps/web/features/m/k/k.nav.ts": 'export default { id: "m.k" };',
      "apps/web/features/m/k/k.slot.tsx": "export default {};",
    });
    const text = result.errors.join("\n");
    expect(text).toMatch(/needs roles from/);
    expect(text).toMatch(/nav entry needs/);
    expect(text).toMatch(/slot file default-exports/);
  });

  it("rejects non-kebab keys and files without a default export", async () => {
    const { result } = await run({
      "modules/m/src/routes/BadKey/x.route.ts": "export const a = 1;",
    });
    expect(result.errors.join("\n")).toMatch(/kebab-case/);
    expect(result.errors.join("\n")).toMatch(/default-export/);
  });
});
