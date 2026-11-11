import { resolve } from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

// Flat config replaces a rule's options when a later block matches the same file; these tests prove that the
// FINAL options for each kind of file still carry every pattern group (module boundary, layering, HTTP clients).
const root = resolve(__dirname, "../../..");
const eslint = new ESLint({ cwd: root });

async function patterns(file: string): Promise<string[]> {
  const cfg = await eslint.calculateConfigForFile(resolve(root, file));
  const rule = cfg.rules?.["no-restricted-imports"] as [
    string,
    { patterns: { group: string[] }[] },
  ];
  return rule[1].patterns.flatMap((p) => p.group);
}

describe("restricted imports are cumulative per file group", () => {
  it("service files: module boundary + HTTP clients + service layering", async () => {
    const p = await patterns("modules/example/src/service/hello/hello-service.ts");
    expect(p).toEqual(
      expect.arrayContaining(["@seller-hub/mod-*/*", "axios", "**/routes/**", "**/handlers/**"]),
    );
  });
  it("repository files: module boundary + HTTP clients + repository layering", async () => {
    const p = await patterns("modules/example/src/repository/hello/hello-repository.ts");
    expect(p).toEqual(
      expect.arrayContaining(["@seller-hub/mod-*/*", "axios", "**/service/**", "**/routes/**"]),
    );
  });
  it("other module files: module boundary + HTTP clients", async () => {
    const p = await patterns("modules/example/src/routes/hello/hello.route.ts");
    expect(p).toEqual(expect.arrayContaining(["@seller-hub/mod-*/*", "undici"]));
    expect(p).not.toContain("**/service/**");
  });
  it("apps/api keeps the HTTP client fence; apps/web keeps its package fence", async () => {
    expect(await patterns("apps/api/src/app.ts")).toContain("axios");
    expect(await patterns("apps/web/app/page.tsx")).toEqual(
      expect.arrayContaining(["@seller-hub/mod-*", "kysely"]),
    );
  });
});
