/* eslint-disable no-console -- an operator CLI that talks to the terminal */
// `pnpm auth:setup-token` - prints a ONE-TIME setup token (valid 24 h, single use, stored hashed) that lets the first
// Owner of a tenant register at /setup. There is no default admin and no open sign-up (ADR-0004). Run it again for a
// second tenant. The token is shown once; it is not logged anywhere.
import { loadConfig, loadEnvFile } from "@seller-hub/config";
import { createDb } from "@seller-hub/db";
import { createAuditWriter } from "@seller-hub/mod-platform-audit";
import { tenancyService } from "@seller-hub/mod-platform-tenancy";
import { identityService } from "../src/service/platform-auth/identity-service";

loadEnvFile();
const config = loadConfig();
const handle = createDb(config.databaseUrl, { max: 2 });
try {
  const audit = createAuditWriter(handle.db);
  const tenancy = tenancyService({
    db: handle.db,
    audit,
    permissionMatrix: new Map(),
    webPublicUrl: config.webUrl,
  });
  const { token, expiresAt } = await identityService({
    db: handle.db,
    audit,
    tenancy,
  }).createSetupToken();
  console.log("");
  console.log("Setup token (shown once, valid until " + expiresAt.toISOString() + "):");
  console.log("");
  console.log("  " + token);
  console.log("");
  console.log(
    "Open " + config.webUrl.replace(/\/$/, "") + "/setup and paste it to create the first Owner.",
  );
} finally {
  await handle.close();
}
