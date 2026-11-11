// pnpm new:module <module> [<key>]
//   Creates modules/<module>/{package.json,tsconfig.json,README.md,src/index.ts} (the module owner's job,
//   BACKLOG §1.4). With <key> it also creates the slice's stub files (route, handler, service, repository,
//   permissions, public entry, contract, messages, test) — everything a slice adds, nothing shared.
//   Existing files are never overwritten.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { findRepoRoot } from "@seller-hub/config";
import { KEBAB } from "./discover";

const [moduleName, key] = process.argv.slice(2);
if (!moduleName || !KEBAB.test(moduleName) || (key !== undefined && !KEBAB.test(key))) {
  console.error("usage: pnpm new:module <module> [<key>]   (kebab-case names)");
  process.exit(2);
}

const root = findRepoRoot();
const pascal = (s: string) =>
  s
    .split("-")
    .map((p) => p[0]!.toUpperCase() + p.slice(1))
    .join("");
const camel = (s: string) => {
  const p = pascal(s);
  return p[0]!.toLowerCase() + p.slice(1);
};
const created: string[] = [];

function put(file: string, content: string): void {
  const abs = join(root, file);
  if (existsSync(abs)) return;
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
  created.push(file);
}

const m = moduleName;
put(
  `modules/${m}/package.json`,
  `${JSON.stringify(
    {
      name: `@seller-hub/mod-${m}`,
      version: "0.0.0",
      private: true,
      type: "module",
      exports: { ".": "./src/index.ts" },
      scripts: {
        lint: "eslint .",
        typecheck: "tsc --noEmit",
        test: "vitest run --passWithNoTests --hookTimeout=60000 --testTimeout=30000",
        build: `node -e "console.log('mod-${m}: source-only module, bundled by apps/api and apps/worker')"`,
      },
      dependencies: {
        "@seller-hub/config": "workspace:*",
        "@seller-hub/core": "workspace:*",
        "@seller-hub/db": "workspace:*",
        kysely: "catalog:",
      },
      devDependencies: {
        "@seller-hub/testing": "workspace:*",
        "@types/node": "catalog:",
        eslint: "catalog:",
        typescript: "catalog:",
        vitest: "catalog:",
      },
    },
    null,
    2,
  )}\n`,
);
put(
  `modules/${m}/tsconfig.json`,
  `${JSON.stringify(
    {
      extends: "@seller-hub/config/tsconfig.base.json",
      compilerOptions: { noEmit: true },
      include: ["src", "seed", "test"],
    },
    null,
    2,
  )}\n`,
);
put(
  `modules/${m}/README.md`,
  `# mod-${m}\n\nOwner: <slice id>. Skeleton created by \`pnpm new:module ${m}\`.\n\nSlices add files under \`src/{routes,handlers,service,repository,sync,jobs,commands,permissions,public}/<key>/\`,\n\`migrations/\`, \`seed/\`, \`test/\` — see docs/architecture/dev-setup.md "Adding a slice". Never edit \`src/index.ts\`\n(one fixed line) or the \`*.generated.ts\` files.\n`,
);
put(`modules/${m}/src/index.ts`, 'export * from "./public.generated";\n');

if (key) {
  const k = key;
  const K = pascal(k);
  const base = `modules/${m}/src`;
  const prefix = `${pascal(m)}${K}`;
  const op = `${m}.get${K}Status`;
  const perm = `${m}.read`;
  put(
    `${base}/permissions/${k}.permissions.ts`,
    `import { definePermissions } from "@seller-hub/core";\n\nexport default definePermissions([\n  { permission: "${perm}", roles: ["owner", "admin", "manager", "analyst", "viewer"] },\n]);\n`,
  );
  put(
    `${base}/repository/${k}/${k}-repository.ts`,
    `import { requireScope, type Scope } from "@seller-hub/core";\n\n// Every repository function takes a Scope first (conventions §10); queries filter by it, RLS enforces it again.\nexport function ${camel(k)}Repository() {\n  return {\n    async count(scope: Scope): Promise<number> {\n      requireScope(scope);\n      return 0;\n    },\n  };\n}\n`,
  );
  put(
    `${base}/service/${k}/${k}-service.ts`,
    `import type { Scope } from "@seller-hub/core";\nimport { ${camel(k)}Repository } from "../../repository/${k}/${k}-repository";\n\nexport function ${camel(k)}Service(repo = ${camel(k)}Repository()) {\n  return {\n    async status(scope: Scope): Promise<{ items: number }> {\n      return { items: await repo.count(scope) };\n    },\n  };\n}\n`,
  );
  put(
    `${base}/handlers/${k}/${k}-handlers.ts`,
    `import type { OperationHandler } from "@seller-hub/core";\nimport { ${camel(k)}Service } from "../../service/${k}/${k}-service";\n\nexport const get${K}Status: OperationHandler = async (req) => {\n  if (!req.scope) throw new Error("scope missing");\n  return ${camel(k)}Service().status(req.scope);\n};\n`,
  );
  put(
    `${base}/routes/${k}/${k}.route.ts`,
    `import { defineRoutes } from "@seller-hub/core";\nimport { get${K}Status } from "../../handlers/${k}/${k}-handlers";\n\nexport default defineRoutes((router) => {\n  router.operation("${op}", get${K}Status);\n});\n`,
  );
  put(
    `${base}/public/${k}.ts`,
    `export { ${camel(k)}Service } from "../service/${k}/${k}-service";\n`,
  );
  put(
    `modules/${m}/test/${k}/${k}.test.ts`,
    `import { describe, expect, it } from "vitest";\nimport { ${camel(k)}Service } from "../../src/service/${k}/${k}-service";\n\ndescribe("${m}/${k}", () => {\n  it("answers for a scope", async () => {\n    expect(await ${camel(k)}Service().status({ tenantId: "t" })).toEqual({ items: 0 });\n  });\n});\n`,
  );
  put(
    `contracts/modules/${m}/${k}.yaml`,
    `openapi: 3.1.0
info:
  title: ${m} / ${k}
  version: 0.1.0
paths:
  /v1/seller-accounts/{sellerAccountId}/${m}/${k}/status:
    get:
      operationId: ${op}
      summary: Status of ${m}/${k}
      tags: [${m}]
      x-permission: ${perm}
      x-scope: seller-account
      parameters:
        - $ref: "../../shared/common.yaml#/components/parameters/SellerAccountId"
      responses:
        "200":
          description: Status
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/${prefix}Status"
        "4XX":
          $ref: "../../shared/common.yaml#/components/responses/Problem"
components:
  schemas:
    ${prefix}Status:
      type: object
      required: [items]
      properties:
        items:
          type: integer
          minimum: 0
`,
  );
  put(`apps/web/messages/en/${m}.${k}.json`, `{\n  "title": "${m} ${k}"\n}\n`);
}

console.log(
  created.length
    ? `created:\n${created.map((c) => `  ${c}`).join("\n")}`
    : "nothing to create (all files exist)",
);
console.log("next: pnpm install && pnpm gen");
