import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  defaultRepoRoot,
  findRefsDir,
  generateAds,
  generateSp,
  normaliseRegions,
} from "../src/generate";
import { pruneSpec } from "../src/prune";
import { loadTooling } from "../src/tooling";

describe("pruneSpec", () => {
  const spec = {
    openapi: "3.0.0",
    paths: {
      "/a": {
        parameters: [{ $ref: "#/components/parameters/P" }],
        get: {
          operationId: "getA",
          responses: {
            "200": {
              content: { "application/json": { schema: { $ref: "#/components/schemas/A" } } },
            },
          },
        },
        post: {
          operationId: "postA",
          requestBody: {
            content: { "application/json": { schema: { $ref: "#/components/schemas/Unused" } } },
          },
        },
      },
      "/b": { get: { operationId: "getB", responses: {} } },
    },
    components: {
      parameters: { P: { name: "p", in: "query", schema: { type: "string" } } },
      schemas: {
        A: { type: "object", properties: { b: { $ref: "#/components/schemas/B" } } },
        B: { type: "string" },
        Unused: { type: "object" },
        AlsoUnused: { type: "object" },
      },
    },
  };

  it("keeps the requested operations and only the components they reach (transitively)", () => {
    const r = pruneSpec(spec, ["getA"]);
    expect([...r.kept.keys()]).toEqual(["getA"]);
    const paths = r.spec.paths as Record<string, Record<string, unknown>>;
    expect(Object.keys(paths)).toEqual(["/a"]);
    expect(paths["/a"]?.post).toBeUndefined();
    expect(paths["/a"]?.parameters).toBeDefined(); // path-level parameters survive
    const schemas = (r.spec.components as { schemas: Record<string, unknown> }).schemas;
    expect(Object.keys(schemas).sort()).toEqual(["A", "B"]);
    expect(r.missing).toEqual([]);
  });

  it("reports operations the spec does not contain, and '*' keeps everything", () => {
    expect(pruneSpec(spec, ["getA", "nope"]).missing).toEqual(["nope"]);
    expect(pruneSpec(spec, "*").kept.size).toBe(3);
  });
});

describe("normaliseRegions", () => {
  it("keeps the leading region code of free-text catalogue values", () => {
    expect(normaliseRegions(["NA", "EU", "FE except where noted"])).toEqual(["eu", "fe", "na"]);
    expect(normaliseRegions(null)).toBeUndefined();
    expect(normaliseRegions(["somewhere"])).toBeUndefined();
  });
});

// Needs refs/ (gitignored: present in the main checkout, found through the git common dir from a worktree).
// Regenerates everything from the models and compares with what is committed - a stale `generated/` fails here.
const root = defaultRepoRoot();
const hasRefs = (() => {
  try {
    return existsSync(join(findRefsDir(root), "amazon", "selling-partner-api-models"));
  } catch {
    return false;
  }
})();

describe.skipIf(!hasRefs)("generated output is current", () => {
  it("regenerating SP and Ads from refs/ + catalog/ reproduces the committed files", async () => {
    const tooling = await loadTooling(root);
    const files = [...(await generateSp(root, tooling)), ...(await generateAds(root, tooling))];
    expect(files.length).toBeGreaterThan(20);
    const stale = files.filter(
      (f) =>
        !existsSync(join(root, f.path)) || readFileSync(join(root, f.path), "utf8") !== f.content,
    );
    expect(stale.map((f) => f.path)).toEqual([]);
  }, 180_000);
});
