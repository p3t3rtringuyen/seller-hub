import { defineConfig, devices } from "@playwright/test";
import { loadEnvFile, resolvePorts } from "@seller-hub/config";

// E2E (ADR-0012): specs live in e2e/<key>/. P3-SCAFFOLD ships one smoke spec against the web app; slices add
// theirs and run them against the compose stack + Amazon mock server. Ports follow SH_PORT_OFFSET.
loadEnvFile();
const ports = resolvePorts(process.env);
const baseURL = `http://127.0.0.1:${ports.web}`;
const apiURL = `http://127.0.0.1:${ports.api}`;

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // The web app (BFF included) and, since P3-IDENTITY, the API it talks to. Both need the compose stack (pnpm stack:up,
  // pnpm db:migrate). Amazon calls are answered by the replay fixtures (SH_AMAZON_MODE unset = replay, D30).
  webServer: [
    {
      command: "pnpm --filter @seller-hub/api run dev",
      url: `${apiURL}/healthz`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: "pnpm --filter @seller-hub/web run dev",
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
