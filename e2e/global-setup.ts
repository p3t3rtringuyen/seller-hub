import { loadEnvFile, resolvePorts } from "@seller-hub/config";

// `next dev` compiles a route on its first request, which can take tens of seconds for pages that pull in the design
// system. Warm the routes the specs use, one after another, so the specs measure the app and not the compiler.
export default async function globalSetup(): Promise<void> {
  loadEnvFile();
  const base = `http://127.0.0.1:${resolvePorts(process.env).web}`;
  const paths = [
    "/bff/csrf",
    "/sign-in",
    "/setup",
    "/accept-invitation",
    "/settings/connections",
    "/settings/members",
    "/settings/connections/ads/callback",
    "/example",
    "/",
  ];
  for (const path of paths) {
    try {
      await fetch(base + path, { signal: AbortSignal.timeout(180_000) });
    } catch {
      // a slow or failing page shows up in the specs with a proper error
    }
  }
}
