// What other modules, the worker and the composition root may import (through `@seller-hub/mod-platform-connections`).
export { provideConnectionsServices } from "../container";
export {
  composeAmazon,
  connectionsReplayFixtures,
  MOCK_AUTH_CODE,
  MOCK_ADS_REFRESH_TOKEN,
} from "../amazon/compose";
export type { AmazonStack } from "../amazon/compose";
export { createAmazonPort, type AmazonPort } from "../amazon/amazon-port";
export { vaultCredentialSource } from "../vault/vault-credential-source";
export {
  envKeyProvider,
  memoryKeyProvider,
  seal,
  open,
  rewrap,
  VaultConfigError,
} from "../vault/envelope";
export type { KeyProvider, SealedSecret } from "../vault/envelope";
export { connectionsService } from "../service/platform-connections/connections-service";
export type { ConnectionsService } from "../service/platform-connections/connections-service";
export { connectionsRepository } from "../repository/platform-connections/connections-repository";
