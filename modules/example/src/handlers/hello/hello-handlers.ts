import { respond, type OperationHandler } from "@seller-hub/core";
import type { HelloRepository } from "../../service/hello/hello-service";
import { helloService } from "../../service/hello/hello-service";

// Handlers adapt HTTP to the service. The shape of params/query/body was already validated against the
// contract by the API before this runs; business rules are the service's job.
export function helloHandlers(repo: HelloRepository) {
  const service = helloService(repo);
  const getHelloStatus: OperationHandler = async (req) => service.status(req.scope!);
  const createHello: OperationHandler = async (req) => {
    const body = req.body as { greeting: string };
    return respond(201, await service.create(req.scope!, body.greeting));
  };
  return { getHelloStatus, createHello };
}
