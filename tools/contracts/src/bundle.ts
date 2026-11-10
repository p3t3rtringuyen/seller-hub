// Contract bundler (ADR-0010 decision 3, BACKLOG §1.2): merges contracts/shared/*.yaml and
// contracts/modules/<module>/<key>.yaml into one OpenAPI 3.1 document and enforces the rules that need the
// whole picture. Each file is bundled on its own first (relative $refs to shared files are resolved into
// that file's components), then merged; identical shared components collapse, conflicting ones fail.

import { isDeepStrictEqual } from "node:util";
import { join } from "node:path";
import { bundle, createConfig } from "@redocly/openapi-core";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- OpenAPI documents are arbitrary JSON
type Json = Record<string, any>;

const HTTP = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;
const SCOPES = new Set(["tenant", "seller-account", "none"]);
const COMPONENT_SECTIONS = [
  "schemas",
  "parameters",
  "responses",
  "headers",
  "requestBodies",
  "securitySchemes",
  "examples",
] as const;

const pascal = (s: string) =>
  s
    .split("-")
    .map((p) => p[0]!.toUpperCase() + p.slice(1))
    .join("");

export interface BundleInput {
  root: string;
  sharedFiles: string[];
  moduleFiles: { file: string; module: string; key: string }[];
  /** permission -> roles, from *.permissions.ts files. */
  permissions: Map<string, Set<string>>;
  /** Registered command handler kinds. */
  commandKinds: string[];
}

export interface BundleOutput {
  document: Json;
  errors: string[];
  operations: {
    operationId: string;
    method: string;
    path: string;
    permission: string | null;
    scope: string;
  }[];
}

async function load(root: string, file: string): Promise<Json> {
  const config = await createConfig({});
  const res = await bundle({ ref: join(root, file), config, dereference: false });
  return res.bundle.parsed as Json;
}

export async function bundleContracts(input: BundleInput): Promise<BundleOutput> {
  const errors: string[] = [];
  const doc: Json = {
    openapi: "3.1.0",
    info: {
      title: "seller-hub API",
      version: "0.1.0",
      description: "Generated bundle — do not edit.",
    },
    servers: [{ url: "/" }],
    tags: [],
    paths: {},
    components: {},
  };
  const operations: BundleOutput["operations"] = [];
  const operationIds = new Map<string, string>();
  const tags = new Set<string>();

  // Component names that come from shared files (not subject to the slice prefix).
  const sharedNames: Record<string, Set<string>> = {};
  const files: { file: string; module: string | null; key: string | null }[] = [
    ...input.sharedFiles.map((file) => ({ file, module: null, key: null })),
    ...input.moduleFiles,
  ];

  const merge = (file: string, section: string, name: string, value: unknown) => {
    const target = (doc.components[section] ??= {}) as Json;
    if (name in target) {
      if (!isDeepStrictEqual(target[name], value))
        errors.push(
          `${file}: components.${section}.${name} conflicts with a different definition elsewhere`,
        );
      return;
    }
    target[name] = value;
  };

  // Shared files first so slice files can be checked against their names.
  for (const entry of files) {
    let parsed: Json;
    try {
      parsed = await load(input.root, entry.file);
    } catch (e) {
      errors.push(`${entry.file}: ${(e as Error).message}`);
      continue;
    }
    const owner = entry.module ?? "system";
    const isShared = entry.module === null;
    const prefixes =
      entry.module && entry.key
        ? [pascal(entry.module) + pascal(entry.key), pascal(entry.module)]
        : [];
    const preferred =
      entry.module && entry.key === entry.module ? [pascal(entry.module)] : prefixes.slice(0, 1);

    for (const section of COMPONENT_SECTIONS) {
      const comps = (parsed.components?.[section] ?? {}) as Json;
      for (const [name, value] of Object.entries(comps)) {
        if (isShared) {
          (sharedNames[section] ??= new Set()).add(name);
          // system.yaml schemas follow the SystemXxx convention; common.yaml names are unprefixed shared names.
        } else if (!sharedNames[section]?.has(name)) {
          const ok =
            preferred.some((p) => name.startsWith(p)) ||
            (entry.key === entry.module && name.startsWith(pascal(entry.module ?? "")));
          if (!ok && section === "schemas")
            errors.push(
              `${entry.file}: component "${name}" must be prefixed ${preferred[0]} (new components are <Module><KeyPascal>…)`,
            );
          if (!ok && section !== "schemas")
            errors.push(
              `${entry.file}: ${section} component "${name}" must be prefixed ${preferred[0]}`,
            );
        }
        merge(entry.file, section, name, value);
      }
    }

    for (const [path, item] of Object.entries((parsed.paths ?? {}) as Json)) {
      for (const method of HTTP) {
        const op = (item as Json)[method] as Json | undefined;
        if (!op) continue;
        const where = `${entry.file}: ${method.toUpperCase()} ${path}`;
        const id = String(op.operationId ?? "");
        const idModule = isShared ? "system" : entry.module!;
        if (
          !id.startsWith(`${idModule}.`) ||
          !/^[a-z][a-z0-9-]*\.[a-z]+[A-Z][A-Za-z0-9]*$/.test(id)
        ) {
          errors.push(`${where}: operationId "${id}" must be ${idModule}.<verb><Noun>`);
        }
        if (operationIds.has(id))
          errors.push(`${where}: duplicate operationId ${id} (also ${operationIds.get(id)})`);
        operationIds.set(id, where);

        const permission =
          typeof op["x-permission"] === "string" ? (op["x-permission"] as string) : null;
        const isPublic = op["x-public"] === true;
        if (!permission && !isPublic)
          errors.push(`${where}: needs x-permission (or x-public: true)`);
        if (permission && !input.permissions.has(permission)) {
          errors.push(
            `${where}: x-permission "${permission}" is not declared by any modules/*/src/permissions/*.permissions.ts`,
          );
        }
        const scope = String(op["x-scope"] ?? "");
        if (!SCOPES.has(scope))
          errors.push(`${where}: x-scope must be tenant | seller-account | none`);
        if (scope === "seller-account" && !path.includes("{sellerAccountId}"))
          errors.push(`${where}: x-scope seller-account needs {sellerAccountId} in the path`);
        if (!isShared && !path.startsWith("/v1/"))
          errors.push(`${where}: paths are versioned (/v1/...)`);
        if (!isShared && /[A-Z_]/.test(path.replace(/\{[^}]+\}/g, "")))
          errors.push(`${where}: path segments are kebab-case`);

        const responses = (op.responses ?? {}) as Json;
        if (!Object.keys(responses).some((c) => /^4(XX|\d\d)$/.test(c)))
          errors.push(`${where}: declare a 4XX problem response`);
        for (const [code, resp] of Object.entries(responses)) {
          if (/^2/.test(code) && (resp as Json).content?.["application/json"]?.schema) {
            const schema = (resp as Json).content["application/json"].schema as Json;
            void schema; // inline success schemas are allowed; only request bodies are restricted
          }
        }
        const body = op.requestBody as Json | undefined;
        if (body && !body.$ref) {
          for (const media of Object.values((body.content ?? {}) as Json)) {
            const schema = (media as Json).schema as Json | undefined;
            if (schema && !schema.$ref)
              errors.push(
                `${where}: request bodies must $ref a named component schema (no inline anonymous schemas)`,
              );
          }
        }
        for (const t of (op.tags ?? []) as string[]) tags.add(t);

        const existing = (doc.paths[path] ??= {}) as Json;
        if (existing[method]) errors.push(`${where}: path+method already defined in another file`);
        existing[method] = op;
        operations.push({ operationId: id, method, path, permission, scope });
        void owner;
      }
    }
  }

  // x-command-kind coverage: every registered handler kind is declared in some contract schema, and vice versa.
  const declared = new Map<string, string>();
  for (const [name, schema] of Object.entries((doc.components.schemas ?? {}) as Json)) {
    const kind = (schema as Json)["x-command-kind"];
    if (typeof kind === "string") declared.set(kind, name);
  }
  for (const kind of input.commandKinds) {
    if (!declared.has(kind))
      errors.push(
        `command kind "${kind}" has no schema with x-command-kind: ${kind} in any contract`,
      );
  }
  for (const [kind, name] of declared) {
    if (!input.commandKinds.includes(kind))
      errors.push(
        `schema ${name} declares x-command-kind "${kind}" but no *.command.ts registers it`,
      );
  }

  doc.tags = [...tags].sort().map((name) => ({ name }));
  const sortedPaths: Json = {};
  for (const p of Object.keys(doc.paths).sort()) sortedPaths[p] = doc.paths[p];
  doc.paths = sortedPaths;
  operations.sort((a, b) => a.operationId.localeCompare(b.operationId));
  return { document: doc, errors, operations };
}
