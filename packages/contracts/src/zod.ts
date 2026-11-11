import { z } from "zod";
import openapiJson from "../dist/openapi.json";

// Zod generator decision (ADR-0010 decision 4): no code generator. Zod 4 builds a schema from JSON Schema at
// runtime (`z.fromJSONSchema`), and OpenAPI 3.1 component schemas ARE JSON Schema 2020-12, so forms get the
// contract's own constraints with nothing to regenerate or drift. `$ref`s to other components are rewritten
// to a local `$defs` map.

type Json = Record<string, unknown>;
const components = (openapiJson as unknown as { components: { schemas: Record<string, Json> } })
  .components.schemas;

function rewriteRefs(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(rewriteRefs);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Json).map(([k, v]) =>
        k === "$ref" && typeof v === "string"
          ? [k, v.replace("#/components/schemas/", "#/$defs/")]
          : [k, rewriteRefs(v)],
      ),
    );
  }
  return value;
}

const cache = new Map<string, z.ZodType>();

/** Zod schema for a named component of the bundle, for example `zodForComponent("Money")`. */
export function zodForComponent(name: string): z.ZodType {
  const hit = cache.get(name);
  if (hit) return hit;
  if (!(name in components)) throw new Error(`unknown contract component: ${name}`);
  const defs = rewriteRefs(components) as Record<string, unknown>;
  const schema = z.fromJSONSchema({ $ref: `#/$defs/${name}`, $defs: defs } as never);
  cache.set(name, schema);
  return schema;
}
