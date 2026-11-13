import { buildTenancyService, tenancyServices } from "@seller-hub/mod-platform-tenancy";
import type { AmazonPort } from "./amazon/amazon-port";
import {
  connectionsService,
  type ConnectionsService,
} from "./service/platform-connections/connections-service";
import type { KeyProvider } from "./vault/envelope";

// Same pattern as platform-tenancy: the composition root provides the vault keys and the Amazon port once; the service
// is built lazily per tenancy-services instance.

export interface ConnectionsServices {
  keys: KeyProvider;
  amazon: AmazonPort;
}

let current: ConnectionsServices | undefined;
const cache = new WeakMap<object, ConnectionsService>();

export function provideConnectionsServices(services: ConnectionsServices): void {
  current = services;
}

export function connectionsServiceInstance(): ConnectionsService {
  if (!current)
    throw new Error("platform-connections services were not provided by the composition root");
  const base = tenancyServices();
  let service = cache.get(current);
  if (!service) {
    service = connectionsService({
      db: base.db,
      audit: base.audit,
      keys: current.keys,
      amazon: current.amazon,
      tenancy: buildTenancyService(),
      webPublicUrl: base.webPublicUrl,
    });
    cache.set(current, service);
  }
  return service;
}
