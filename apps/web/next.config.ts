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
    "@seller-hub/ui",
  ],
  // Baseline response headers (P3-IDENTITY): no framing, no sniffing, and no Referer to other sites - the Ads consent
  // redirect lands on a URL with a one-time code, and nothing about it may leak to a third party. A CSP is P6-SEC work.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
  // Lint runs as its own gate step (pnpm lint).
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
};

export default config;
