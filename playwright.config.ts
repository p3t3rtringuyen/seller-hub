import { defineConfig, devices } from "@playwright/test";
import { loadEnvFile, resolvePorts } from "@seller-hub/config";

// E2E (ADR-0012): specs live in e2e/<key>/. P3-SCAFFOLD ships one smoke spec against the web app; slices add
// theirs and run them against the compose stack + Amazon mock server. Ports follow SH_PORT_OFFSET.
loadEnvFile();
const ports = resolvePorts(process.env);
const baseURL = `http://127.0.0.1:${ports.web}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm --filter @seller-hub/web run dev",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
