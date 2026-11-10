import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { bundleContracts } from "../src/bundle";

const repo = resolve(__dirname, "../../..");

function workspace(moduleFiles: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "sh-contracts-"));
  cpSync(join(repo, "contracts", "shared"), join(root, "contracts", "shared"), { recursive: true });
  const modules: { file: string; module: string; key: string }[] = [];
  for (const [file, content] of Object.entries(moduleFiles)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), content);
    const m = /contracts\/modules\/([^/]+)\/([^.]+)\.yaml/.exec(file)!;
    modules.push({ file, module: m[1]!, key: m[2]! });
  }
  return { root, modules };
}

const op = (extra = "") => `
openapi: 3.1.0
info: { title: t, version: 1.0.0 }
paths:
  /v1/seller-accounts/{sellerAccountId}/m/things:
    get:
      operationId: m.listThings
      summary: List
      x-permission: m.read
      x-scope: seller-account
      parameters:
        - $ref: "../../shared/common.yaml#/components/parameters/SellerAccountId"
      responses:
        "200": { description: ok, content: { application/json: { schema: { $ref: "#/components/schemas/MKThing" } } } }
        "4XX": { $ref: "../../shared/common.yaml#/components/responses/Problem" }
components:
  schemas:
    MKThing: { type: object }
${extra}`;

const run = async (
  files: Record<string, string>,
  over: { permissions?: string[]; kinds?: string[] } = {},
) => {
  const { root, modules } = workspace(files);
  return bundleContracts({
    root,
    sharedFiles: ["contracts/shared/common.yaml", "contracts/shared/system.yaml"],
    moduleFiles: modules,
    permissions: new Map((over.permissions ?? ["m.read"]).map((p) => [p, new Set(["viewer"])])),
    commandKinds: over.kinds ?? [],
  });
};

describe("contract bundler", () => {
  it("merges shared and slice files and resolves relative $refs into the bundle", async () => {
    const out = await run({ "contracts/modules/m/k.yaml": op() });
    expect(out.errors).toEqual([]);
    expect(out.operations.map((o) => o.operationId)).toContain("m.listThings");
    expect(out.document.components.responses.Problem).toBeDefined();
    expect(out.document.components.parameters.SellerAccountId).toBeDefined();
  });

  it("fails on an x-permission that no permissions file declares", async () => {
    const out = await run({ "contracts/modules/m/k.yaml": op() }, { permissions: [] });
    expect(out.errors.join("\n")).toMatch(/x-permission "m\.read" is not declared/);
  });

  it("fails on a wrong operationId prefix, a missing 4XX and a missing x-scope", async () => {
    const bad = op()
      .replace("operationId: m.listThings", "operationId: other.listThings")
      .replace(
        '        "4XX": { $ref: "../../shared/common.yaml#/components/responses/Problem" }\n',
        "",
      )
      .replace("      x-scope: seller-account\n", "");
    const out = await run({ "contracts/modules/m/k.yaml": bad });
    const text = out.errors.join("\n");
    expect(text).toMatch(/operationId "other\.listThings" must be m\./);
    expect(text).toMatch(/4XX problem response/);
    expect(text).toMatch(/x-scope must be/);
  });

  it("fails on a component without the <Module><KeyPascal> prefix", async () => {
    const out = await run({
      "contracts/modules/m/k.yaml": op("    Unprefixed: { type: object }\n"),
    });
    expect(out.errors.join("\n")).toMatch(/component "Unprefixed" must be prefixed MK/);
  });

  it("fails when two slices define the same operationId or path", async () => {
    const out = await run({
      "contracts/modules/m/k.yaml": op(),
      "contracts/modules/m/j.yaml": op().replace(/MKThing/g, "MJThing"),
    });
    expect(out.errors.join("\n")).toMatch(/duplicate operationId m\.listThings/);
  });

  it("requires inline request bodies to be named components", async () => {
    const body = op()
      .replace("    get:", "    post:")
      .replace(
        "      parameters:",
        "      requestBody: { content: { application/json: { schema: { type: object } } } }\n      parameters:",
      );
    const out = await run({ "contracts/modules/m/k.yaml": body });
    expect(out.errors.join("\n")).toMatch(/no inline anonymous schemas/);
  });

  it("checks x-command-kind against registered handlers in both directions", async () => {
    const declared = op("    MKPayload: { type: object, x-command-kind: m.thing.do }\n");
    expect(
      (await run({ "contracts/modules/m/k.yaml": declared }, { kinds: [] })).errors.join("\n"),
    ).toMatch(/no \*\.command\.ts registers it/);
    expect(
      (await run({ "contracts/modules/m/k.yaml": op() }, { kinds: ["m.thing.do"] })).errors.join(
        "\n",
      ),
    ).toMatch(/has no schema with x-command-kind/);
    expect(
      (await run({ "contracts/modules/m/k.yaml": declared }, { kinds: ["m.thing.do"] })).errors,
    ).toEqual([]);
  });
});
