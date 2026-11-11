/* eslint-disable @typescript-eslint/no-explicit-any -- walks arbitrary JSON Schema / OpenAPI documents */
import type { ApiRouter, OperationHandler, OperationResponse, Scope } from "@seller-hub/core";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { OperationInfo } from "@seller-hub/contracts";

type Json = Record<string, any>;

export interface OperationConfig {
  operationId: string;
  permission: string | null;
  isPublic: boolean;
  scope: OperationInfo["scope"];
}

/** Request state set by the guard and read by the handler wrapper. */
export interface GuardState {
  scope: Scope | null;
}
declare module "fastify" {
  interface FastifyRequest {
    guard: GuardState;
  }
  interface FastifyContextConfig {
    operation?: OperationConfig;
  }
}

/** Inlines `$ref`s into a plain JSON Schema that Ajv/Fastify can use (cycles are cut to `{}`). */
export function dereference(node: unknown, doc: Json, stack: string[] = []): any {
  if (Array.isArray(node)) return node.map((n) => dereference(n, doc, stack));
  if (node && typeof node === "object") {
    const obj = node as Json;
    if (typeof obj.$ref === "string") {
      const ref = obj.$ref as string;
      if (stack.includes(ref)) return {};
      const target = ref
        .replace(/^#\//, "")
        .split("/")
        .reduce<any>((acc, part) => acc?.[part], doc);
      if (target === undefined) throw new Error(`unresolved $ref ${ref}`);
      return dereference(target, doc, [...stack, ref]);
    }
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, dereference(v, doc, stack)]));
  }
  return node;
}

function fastifySchema(op: Json, doc: Json): Json {
  const schema: Json = {};
  const params = ((op.parameters ?? []) as Json[]).map((p) => dereference(p, doc));
  for (const [where, key] of [
    ["path", "params"],
    ["query", "querystring"],
    ["header", "headers"],
  ] as const) {
    const list = params.filter((p) => p.in === where);
    if (!list.length) continue;
    schema[key] = {
      type: "object",
      properties: Object.fromEntries(
        list.map((p) => [
          where === "header" ? String(p.name).toLowerCase() : p.name,
          p.schema ?? {},
        ]),
      ),
      required: list
        .filter((p) => p.required)
        .map((p) => (where === "header" ? String(p.name).toLowerCase() : p.name)),
    };
  }
  const body = dereference(op.requestBody, doc);
  const bodySchema = body?.content?.["application/json"]?.schema;
  if (bodySchema) schema.body = bodySchema;
  const response: Json = {};
  for (const [code, r] of Object.entries((op.responses ?? {}) as Json)) {
    if (!/^2\d\d$/.test(code)) continue; // problem responses are produced by the error handler
    const s = dereference(r, doc)?.content?.["application/json"]?.schema;
    if (s) response[code] = s;
  }
  if (Object.keys(response).length) schema.response = response;
  return schema;
}

/**
 * Implements the ApiRouter that route modules receive: `operation(operationId, handler)` looks the operation up
 * in the contract bundle (method, path, schemas, x-permission, x-scope) and registers the Fastify route.
 * Unknown or duplicate operation ids fail the boot (contract-first, ADR-0002).
 */
export class OperationBinder implements ApiRouter {
  readonly bound = new Set<string>();
  private readonly byId: Map<string, OperationInfo>;

  constructor(
    private readonly app: FastifyInstance,
    operations: readonly OperationInfo[],
    private readonly doc: Json,
  ) {
    this.byId = new Map(operations.map((o) => [o.operationId, o]));
  }

  operation(operationId: string, handler: OperationHandler): void {
    const info = this.byId.get(operationId);
    if (!info)
      throw new Error(`route binds unknown operationId "${operationId}" (not in any contract)`);
    if (this.bound.has(operationId)) throw new Error(`operationId "${operationId}" is bound twice`);
    this.bound.add(operationId);

    const op = this.doc.paths[info.path][info.method] as Json;
    const url = info.path.replace(/\{([^}]+)\}/g, ":$1");
    const config: OperationConfig = {
      operationId,
      permission: info.permission,
      isPublic: op["x-public"] === true,
      scope: info.scope,
    };
    this.app.route({
      method: info.method.toUpperCase() as "GET",
      url,
      schema: fastifySchema(op, this.doc),
      config: { operation: config },
      handler: async (request: FastifyRequest, reply: FastifyReply) => {
        const result = (await handler({
          params: request.params as Record<string, string>,
          query: request.query as Record<string, unknown>,
          body: request.body,
          headers: request.headers,
          scope: request.guard.scope,
          traceId: request.id,
          log: request.log as never,
        })) as OperationResponse | unknown;
        if (
          result &&
          typeof result === "object" &&
          "status" in result &&
          typeof (result as OperationResponse).status === "number"
        ) {
          const r = result as OperationResponse;
          if (r.headers) reply.headers(r.headers);
          return reply.code(r.status).send(r.body);
        }
        return reply.send(result);
      },
    });
  }
}
