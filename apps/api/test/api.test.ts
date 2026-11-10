import { Writable } from "node:stream";
import { createHelloRoutes } from "../../../modules/example/src/routes/hello/hello.route";
import helloPermissions from "../../../modules/example/src/permissions/hello.permissions";
import { zodForComponent } from "@seller-hub/contracts";
import { createLogger, isUuid, type Role } from "@seller-hub/core";
import { FIXTURE, seedFixtures, tryCreateTestDb } from "@seller-hub/testing";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp, type BuiltApp } from "../src/app";
import type { Authenticator } from "../src/auth";

// Header "x-test-user: <tenantId>:<role>" stands in for the session until P3-IDENTITY. The principal resolves a
// seller account only if it belongs to the caller's tenant (null => 404, never 403, conventions §3).
const t = await tryCreateTestDb();

const logLines: string[] = [];
const logger = createLogger({
  name: "test",
  level: "info",
  stream: new Writable({
    write(chunk, _enc, cb) {
      logLines.push(String(chunk));
      cb();
    },
  }),
});

const authenticator: Authenticator = async (req) => {
  const header = req.headers["x-test-user"];
  if (typeof header !== "string") return null;
  const [tenantId, role] = header.split(":") as [string, Role];
  return {
    userId: "u1",
    tenantId,
    async resolve(sellerAccountId) {
      if (!sellerAccountId) return { scope: { tenantId }, roles: [role] };
      const r = await sql<{
        id: string;
      }>`select id from core.seller_accounts where id = ${sellerAccountId} and tenant_id = ${tenantId}`.execute(
        t!.owner.db,
      );
      return r.rows.length ? { scope: { tenantId, sellerAccountId }, roles: [role] } : null;
    },
  };
};

let built: BuiltApp;
const A = FIXTURE.tenantId;
const B = FIXTURE.otherTenantId;
const status = `/v1/seller-accounts/${FIXTURE.sellerAccountId}/example/hello/status`;
const create = `/v1/seller-accounts/${FIXTURE.sellerAccountId}/example/hello`;

describe.skipIf(!t)("API (real Postgres, contract-validated)", () => {
  beforeAll(async () => {
    await seedFixtures(t!);
    built = await buildApp({
      logger,
      authenticator,
      readiness: { database: async () => void (await sql`select 1`.execute(t!.app.db)) },
      routes: [
        {
          module: "example",
          key: "hello",
          file: "test",
          value: createHelloRoutes(() => t!.app.db),
        },
      ],
    });
  });
  afterAll(async () => {
    await built?.app.close();
    await t?.drop();
  });

  it("serves health, readiness and the contract without a session", async () => {
    const health = await built.app.inject("/healthz");
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ status: "ok" });
    expect((await built.app.inject("/readyz")).json()).toEqual({
      status: "ok",
      checks: { database: "ok" },
    });
    const doc = (await built.app.inject("/v1/openapi.json")).json() as {
      openapi: string;
      paths: object;
    };
    expect(doc.openapi).toBe("3.1.0");
    expect(Object.keys(doc.paths)).toContain("/healthz");
  });

  it("returns a correlation id: the caller's when well-formed, a generated one otherwise", async () => {
    const own = await built.app.inject({
      url: "/healthz",
      headers: { "x-request-id": "req-abcdef12" },
    });
    expect(own.headers["x-request-id"]).toBe("req-abcdef12");
    const bad = await built.app.inject({
      url: "/healthz",
      headers: { "x-request-id": "not ok!!" },
    });
    expect(isUuid(bad.headers["x-request-id"])).toBe(true);
  });

  it("answers unknown routes with problem+json and the real status (404)", async () => {
    const r = await built.app.inject("/v1/nope");
    expect(r.statusCode).toBe(404);
    expect(r.headers["content-type"]).toContain("application/problem+json");
    expect(r.json()).toMatchObject({
      status: 404,
      code: "not_found",
      traceId: r.headers["x-request-id"],
    });
  });

  it("no session => 401", async () => {
    const r = await built.app.inject(status);
    expect(r.statusCode).toBe(401);
    expect(r.json()).toMatchObject({ status: 401, code: "unauthenticated" });
  });

  it("viewer can read (200, body matches the contract schema)", async () => {
    const r = await built.app.inject({ url: status, headers: { "x-test-user": `${A}:viewer` } });
    expect(r.statusCode).toBe(200);
    expect(zodForComponent("ExampleHelloStatus").safeParse(r.json()).success).toBe(true);
    expect(r.json()).toEqual({ items: 1 });
  });

  it("viewer cannot write (403); manager can (201)", async () => {
    const denied = await built.app.inject({
      method: "POST",
      url: create,
      headers: { "x-test-user": `${A}:viewer` },
      payload: { greeting: "hi" },
    });
    expect(denied.statusCode).toBe(403);
    const ok = await built.app.inject({
      method: "POST",
      url: create,
      headers: { "x-test-user": `${A}:manager` },
      payload: { greeting: "hi" },
    });
    expect(ok.statusCode).toBe(201);
    expect(zodForComponent("ExampleHelloRow").safeParse(ok.json()).success).toBe(true);
  });

  it("another tenant's seller-account id => 404 (not 403)", async () => {
    const r = await built.app.inject({ url: status, headers: { "x-test-user": `${B}:owner` } });
    expect(r.statusCode).toBe(404);
  });

  it("maps shape errors to 400, business errors to 422 and conflicts to 409", async () => {
    const headers = { "x-test-user": `${A}:manager` };
    const shape = await built.app.inject({ method: "POST", url: create, headers, payload: {} });
    expect(shape.statusCode).toBe(400);
    expect(shape.json()).toMatchObject({ code: "invalid_request" });
    const business = await built.app.inject({
      method: "POST",
      url: create,
      headers,
      payload: { greeting: "   " },
    });
    expect(business.statusCode).toBe(422);
    expect(business.json().errors[0]).toMatchObject({ path: "/greeting", code: "required" });
    const conflict = await built.app.inject({
      method: "POST",
      url: create,
      headers,
      payload: { greeting: "forbidden" },
    });
    expect(conflict.statusCode).toBe(409);
  });

  it("never logs authorization headers, cookies or bodies", async () => {
    await built.app.inject({
      url: status,
      headers: {
        authorization: "Bearer super-secret-token",
        cookie: "sh_session=cookie-secret",
        "x-test-user": `${A}:viewer`,
      },
    });
    await built.app.inject({
      method: "POST",
      url: create,
      headers: { "x-test-user": `${A}:manager` },
      payload: { greeting: "body-secret-greeting" },
    });
    const all = logLines.join("\n");
    expect(all).toContain('"msg":"request"');
    expect(all).not.toContain("super-secret-token");
    expect(all).not.toContain("cookie-secret");
    expect(all).not.toContain("body-secret-greeting");
  });
});

describe("boot checks (no database needed)", () => {
  it("refuses to start when a contract operation has no handler", async () => {
    await expect(buildApp({ logger, routes: [] })).rejects.toThrow(
      /without a handler: .*example\.getHelloStatus/,
    );
  });

  it("refuses to start when a route binds an unknown operationId", async () => {
    await expect(
      buildApp({
        logger,
        routes: [
          {
            module: "x",
            key: "x",
            file: "x",
            value: (r) => r.operation("nope.doesNotExist", async () => ({})),
          },
        ],
      }),
    ).rejects.toThrow(/unknown operationId/);
  });

  it("refuses to start when a permission used by the contract is declared nowhere", async () => {
    await expect(
      buildApp({
        logger,
        permissions: [],
        routes: [
          {
            module: "example",
            key: "hello",
            file: "x",
            value: createHelloRoutes(() => {
              throw new Error("unused");
            }),
          },
        ],
      }),
    ).rejects.toThrow(/declared by no \*\.permissions\.ts/);
  });

  it("lists every route with its permission (default-deny audit)", async () => {
    const { app, permissionMatrix } = await buildApp({
      logger,
      routes: [
        {
          module: "example",
          key: "hello",
          file: "x",
          value: createHelloRoutes(() => {
            throw new Error("unused");
          }),
        },
      ],
    });
    const declared = new Set(helloPermissions.map((p) => p.permission));
    expect([...declared].every((p) => permissionMatrix.has(p))).toBe(true);
    await app.close();
  });
});
