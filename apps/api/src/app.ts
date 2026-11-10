import { randomUUID } from "node:crypto";
import {
  DomainError,
  requestLogFields,
  resolveRequestId,
  type Logger,
  type PermissionDecl,
  type Role,
  type RouteModule,
} from "@seller-hub/core";
import { openapiDocument, contractOperations, type OperationInfo } from "@seller-hub/contracts";
import Fastify, { LogController, type FastifyBaseLogger, type FastifyInstance } from "fastify";
import { noAuthenticator, type Authenticator } from "./auth";
import { OperationBinder, type OperationConfig } from "./binding";
import { fromDomainError, problem } from "./problem";
import {
  permissions as generatedPermissions,
  routes as generatedRoutes,
  type Registered,
} from "./registry.generated";
import { systemRoutes } from "./system-routes";

export interface AppOptions {
  logger: Logger;
  authenticator?: Authenticator;
  /** Named checks for /readyz (database, redis). A rejected check answers 503. */
  readiness?: Record<string, () => Promise<void>>;
  // Overridable for tests; default to the generated registry and the contract bundle.
  routes?: Registered<RouteModule>[];
  permissions?: Registered<PermissionDecl>[];
  operations?: readonly OperationInfo[];
  document?: unknown;
}

export interface BuiltApp {
  app: FastifyInstance;
  /** permission -> roles, from every *.permissions.ts file. */
  permissionMatrix: Map<string, Set<Role>>;
}

export async function buildApp(options: AppOptions): Promise<BuiltApp> {
  const operations = options.operations ?? contractOperations;
  const document = (options.document ?? openapiDocument) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const authenticator = options.authenticator ?? noAuthenticator;

  const permissionMatrix = new Map<string, Set<Role>>();
  for (const { value } of options.permissions ?? generatedPermissions) {
    const set = permissionMatrix.get(value.permission) ?? new Set<Role>();
    for (const r of value.roles) set.add(r);
    permissionMatrix.set(value.permission, set);
  }

  const app = Fastify({
    loggerInstance: options.logger as unknown as FastifyBaseLogger,
    logController: new LogController({ disableRequestLogging: true }), // we log one allow-listed line per request below
    genReqId: (req) => resolveRequestId(firstHeader(req.headers["x-request-id"])) ?? randomUUID(),
    requestIdHeader: false,
    ajv: { customOptions: { strict: false, coerceTypes: "array", removeAdditional: false } },
  });
  app.decorateRequest("guard", null as never);

  // --- request context: correlation id, timing, allow-listed access log --------------------------------
  app.addHook("onRequest", async (request, reply) => {
    request.guard = { scope: null };
    reply.header("x-request-id", request.id);
    (request as unknown as { startedAt: number }).startedAt = performance.now();
  });
  app.addHook("onResponse", async (request, reply) => {
    const started = (request as unknown as { startedAt: number }).startedAt;
    request.log.info(
      requestLogFields({
        method: request.method,
        route: request.routeOptions.url ?? "(unmatched)",
        status: reply.statusCode,
        durationMs: performance.now() - started,
        traceId: request.id,
      }),
      "request",
    );
  });

  // --- default-deny guard: authentication, scope (404 for foreign ids), permission (403) --------------------
  app.addHook("onRequest", async (request) => {
    const cfg: OperationConfig | undefined = request.routeOptions.config.operation;
    if (!cfg || cfg.isPublic) return;
    const principal = await authenticator(request);
    if (!principal)
      throw new DomainError("unauthenticated", "unauthenticated", "Sign in to continue");
    const params = request.params as Record<string, string>;
    const sellerAccountId =
      cfg.scope === "seller-account" ? (params.sellerAccountId ?? null) : null;
    const resolved = await principal.resolve(sellerAccountId);
    if (!resolved) throw new DomainError("not_found", "not_found", "resource not found");
    const allowed = permissionMatrix.get(cfg.permission ?? "");
    if (!allowed || !resolved.roles.some((r) => allowed.has(r))) {
      throw new DomainError("forbidden", "forbidden", "You do not have permission for this action");
    }
    request.guard.scope = resolved.scope;
  });

  // --- errors: RFC 9457 problem+json with the real status --------------------------------------------------
  app.setErrorHandler((error, request, reply) => {
    const traceId = request.id;
    let body;
    if (error instanceof DomainError) {
      body = fromDomainError(error, traceId);
    } else if ((error as { validation?: unknown }).validation) {
      const issues = (
        error as unknown as {
          validation: { instancePath?: string; keyword: string; message?: string }[];
        }
      ).validation;
      body = problem(
        400,
        "invalid_request",
        traceId,
        "The request does not match the contract",
        issues.map((v) => ({
          path: v.instancePath ?? "",
          code: v.keyword,
          ...(v.message ? { message: v.message } : {}),
        })),
      );
    } else if (
      typeof (error as { statusCode?: number }).statusCode === "number" &&
      (error as { statusCode: number }).statusCode < 500
    ) {
      const status = (error as { statusCode: number }).statusCode;
      body = problem(status, status === 404 ? "not_found" : "bad_request", traceId, undefined);
    } else {
      // The message may carry internals; log it, return a generic body.
      request.log.error(
        { traceId, err: { type: (error as Error).name, message: (error as Error).message } },
        "unhandled error",
      );
      body = problem(500, "internal_error", traceId);
    }
    void reply.code(body.status).header("content-type", "application/problem+json").send(body);
  });
  app.setNotFoundHandler((request, reply) => {
    void reply
      .code(404)
      .header("content-type", "application/problem+json")
      .send(problem(404, "not_found", request.id, "No such route"));
  });

  // --- routes: system first, then every module's route files ------------------------------------------------
  const binder = new OperationBinder(app, operations, document);
  systemRoutes({ document, readiness: options.readiness ?? {} })(binder);
  for (const r of options.routes ?? generatedRoutes) await r.value(binder);

  // --- boot checks (default-deny, contract-first) -------------------------------------------------------------
  const unbound = operations
    .filter((o) => !binder.bound.has(o.operationId))
    .map((o) => o.operationId);
  if (unbound.length)
    throw new Error(`contract operations without a handler: ${unbound.join(", ")}`);
  for (const o of operations) {
    if (o.permission === null) {
      const op = document.paths[o.path][o.method] as Record<string, unknown>;
      if (op["x-public"] !== true)
        throw new Error(`${o.operationId}: no x-permission and not x-public — refusing to start`);
    } else if (!permissionMatrix.has(o.permission)) {
      throw new Error(
        `${o.operationId}: permission "${o.permission}" is declared by no *.permissions.ts file`,
      );
    }
  }
  return { app, permissionMatrix };
}

function firstHeader(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}
