import type { NextConfig } from "next";
import { loadEnvFile } from "@seller-hub/config";

// Next only reads .env files from this folder; the repo keeps a single .env.local at the root.
try {
  loadEnvFile();
} catch {
  // not inside the monorepo (for example a container image): rely on the real environment
}

const config: NextConfig = {
  reactStrictMode: true,
  // Workspace packages are shipped as TypeScript source.
  transpilePackages: [
    "@seller-hub/contracts",
    "@seller-hub/config",
    "@seller-hub/metrics",
    "@seller-hub/core",
  ],
  // Lint runs as its own gate step (pnpm lint).
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
};

export default config;
