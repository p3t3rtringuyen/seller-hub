import { defineRoutes } from "@seller-hub/core";
import { createDb, type Database } from "@seller-hub/db";
import { loadConfig } from "@seller-hub/config";
import { helloHandlers } from "../../handlers/hello/hello-handlers";
import { helloRepository } from "../../repository/hello/hello-repository";

// EXAMPLE route module: binds contract operationIds to handlers. The default export is the RouteModule
// the registry finds. createHelloRoutes(getDb) lets tests inject a database; a real module receives its
// handle from the composition root once P3-IDENTITY defines the service container.
export function createHelloRoutes(getDb: () => Database) {
  let handlers: ReturnType<typeof helloHandlers> | undefined;
  const lazy = () => (handlers ??= helloHandlers(helloRepository(getDb())));
  return defineRoutes((router) => {
    router.operation("example.getHelloStatus", (req) => lazy().getHelloStatus(req));
    router.operation("example.createHello", (req) => lazy().createHello(req));
  });
}

export default createHelloRoutes(() => createDb(loadConfig().databaseUrl, { max: 4 }).db);
