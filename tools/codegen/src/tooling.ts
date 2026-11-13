import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// openapi-typescript and swagger2openapi are devDependencies of @seller-hub/amazon-core (tools/ is not a
// workspace package, so it has no node_modules of its own). They are resolved from that package on demand.

export interface Tooling {
  /** Swagger 2.0 → OpenAPI 3.0 (SP-API models are Swagger 2). */
  swaggerToOpenApi(spec: object): Promise<Record<string, unknown>>;
  /** OpenAPI 3 → TypeScript source text. */
  openApiToTypes(spec: object): Promise<string>;
}

export async function loadTooling(repoRoot: string): Promise<Tooling> {
  const anchor = join(repoRoot, "packages", "amazon-core", "package.json");
  const req = createRequire(anchor);

  const s2o = req("swagger2openapi") as {
    convertObj(
      spec: object,
      options: Record<string, unknown>,
    ): Promise<{ openapi: Record<string, unknown> }>;
  };
  const otsEntry = req.resolve("openapi-typescript");
  const ots = (await import(pathToFileURL(otsEntry).href)) as {
    default: (source: object, options?: Record<string, unknown>) => Promise<unknown>;
    astToString: (ast: unknown) => string;
  };

  return {
    async swaggerToOpenApi(spec) {
      const res = await s2o.convertObj(structuredClone(spec), {
        patch: true,
        warnOnly: true,
        resolveInternal: false,
        anchors: true,
      });
      return res.openapi;
    },
    async openApiToTypes(spec) {
      const ast = await ots.default(spec, {
        alphabetize: true,
        exportType: true,
        defaultNonNullable: false,
      });
      return ots.astToString(ast);
    },
  };
}
