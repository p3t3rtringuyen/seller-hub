import { DomainError, defineRoutes, respond } from "@seller-hub/core";

// Operations of contracts/shared/system.yaml: liveness, readiness and the served contract.
export const systemRoutes = (deps: {
  document: unknown;
  readiness: Record<string, () => Promise<void>>;
}) =>
  defineRoutes((router) => {
    router.operation("system.getHealth", async () => ({ status: "ok" }));

    router.operation("system.getReadiness", async () => {
      const checks: Record<string, "ok"> = {};
      for (const [name, check] of Object.entries(deps.readiness)) {
        try {
          await check();
          checks[name] = "ok";
        } catch {
          throw new DomainError("upstream_throttled", "not_ready", `dependency not ready: ${name}`);
        }
      }
      return respond(200, { status: "ok", checks });
    });

    router.operation("system.getOpenApiDocument", async () => deps.document);
  });
