import type {
  CredentialRef,
  CredentialSource,
  LwaAppCredential,
  LwaCredential,
} from "./credentials";
import type { ApiFamily, Region } from "./regions";
import { parseRegion } from "./regions";

/**
 * Credentials from the developer's own environment (`.env.local`, names in `.env.example`: SPAPI_* and ADS_*).
 * ONLY for `pnpm amazon:sandbox` live checks on the developer's machine. Tenant credentials come from the vault
 * (ADR-0005) through another `CredentialSource`; production code must not use this one.
 */
export function envCredentialSource(
  env: Record<string, string | undefined> = process.env,
): CredentialSource {
  const read = (api: ApiFamily): { credential: LwaCredential; region: Region } => {
    const prefix = api === "sp" ? "SPAPI" : "ADS";
    const clientId = env[`${prefix}_LWA_CLIENT_ID`];
    const clientSecret = env[`${prefix}_LWA_CLIENT_SECRET`];
    const refreshToken = env[`${prefix}_REFRESH_TOKEN`];
    if (!clientId || !clientSecret || !refreshToken) {
      throw new Error(
        `${prefix}_LWA_CLIENT_ID, ${prefix}_LWA_CLIENT_SECRET and ${prefix}_REFRESH_TOKEN must be set in .env.local`,
      );
    }
    return {
      credential: { clientId, clientSecret, refreshToken },
      region: parseRegion(env[`${prefix}_REGION`]),
    };
  };
  return {
    async getCredential(ref: CredentialRef) {
      const { credential, region } = read(ref.api);
      if (region !== ref.region)
        throw new Error(`the environment credential is for region ${region}, not ${ref.region}`);
      return credential;
    },
    async getAppCredential(api): Promise<LwaAppCredential> {
      const { credential } = read(api);
      return { clientId: credential.clientId, clientSecret: credential.clientSecret };
    },
  };
}

/** The region configured for an API family in the environment (SPAPI_REGION / ADS_REGION). */
export function envRegion(
  api: ApiFamily,
  env: Record<string, string | undefined> = process.env,
): Region {
  return parseRegion(env[api === "sp" ? "SPAPI_REGION" : "ADS_REGION"]);
}
