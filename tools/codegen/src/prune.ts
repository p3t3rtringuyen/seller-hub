// Keeps only the operations we generate for, plus every component they reference (transitively), so the
// generated type files stay small and reviewable (SP v0 Ads spec alone has 669 schemas for 80 operations).

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

const HTTP_METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];
const REF_RE = /^#\/components\/([^/]+)\/(.+)$/;

function collectRefs(node: unknown, into: Set<string>): void {
  if (Array.isArray(node)) {
    for (const n of node) collectRefs(n, into);
  } else if (isObj(node)) {
    for (const [k, v] of Object.entries(node)) {
      if (k === "$ref" && typeof v === "string") into.add(v);
      else collectRefs(v, into);
    }
  }
}

const unescapePointer = (s: string): string =>
  decodeURIComponent(s).replace(/~1/g, "/").replace(/~0/g, "~");

export interface PruneResult {
  spec: Obj;
  /** operationId → { path, method } for every operation kept. */
  kept: Map<string, { path: string; method: string }>;
  /** Requested ids the spec does not contain. */
  missing: string[];
}

/** `operationIds === "*"` keeps every operation (components are still pruned to what is referenced). */
export function pruneSpec(spec: Obj, operationIds: readonly string[] | "*"): PruneResult {
  const wanted = operationIds === "*" ? null : new Set(operationIds);
  const paths = isObj(spec.paths) ? spec.paths : {};
  const keptPaths: Obj = {};
  const kept = new Map<string, { path: string; method: string }>();

  for (const [path, item] of Object.entries(paths)) {
    if (!isObj(item)) continue;
    const keptItem: Obj = {};
    for (const [k, v] of Object.entries(item)) {
      if (!HTTP_METHODS.includes(k))
        keptItem[k] = v; // path-level parameters, summary, …
      else if (
        isObj(v) &&
        typeof v.operationId === "string" &&
        (!wanted || wanted.has(v.operationId))
      ) {
        keptItem[k] = v;
        kept.set(v.operationId, { path, method: k.toUpperCase() });
      }
    }
    if (Object.keys(keptItem).some((k) => HTTP_METHODS.includes(k))) keptPaths[path] = keptItem;
  }

  const components = isObj(spec.components) ? spec.components : {};
  const needed = new Set<string>();
  collectRefs(keptPaths, needed);
  const queue = [...needed];
  while (queue.length) {
    const ref = queue.pop() as string;
    const m = REF_RE.exec(ref);
    if (!m) continue;
    const group = components[m[1] as string];
    const target = isObj(group) ? group[unescapePointer(m[2] as string)] : undefined;
    if (target === undefined) continue;
    const more = new Set<string>();
    collectRefs(target, more);
    for (const r of more)
      if (!needed.has(r)) {
        needed.add(r);
        queue.push(r);
      }
  }

  const keptComponents: Obj = {};
  for (const ref of needed) {
    const m = REF_RE.exec(ref);
    if (!m) continue;
    const kind = m[1] as string;
    const name = unescapePointer(m[2] as string);
    const group = components[kind];
    if (!isObj(group) || group[name] === undefined) continue;
    const out = (keptComponents[kind] ??= {}) as Obj;
    out[name] = group[name];
  }
  if (isObj(components.securitySchemes))
    keptComponents.securitySchemes = components.securitySchemes;

  const pruned: Obj = { ...spec, paths: keptPaths, components: keptComponents };
  const missing = wanted ? [...wanted].filter((id) => !kept.has(id)) : [];
  return { spec: pruned, kept, missing };
}
