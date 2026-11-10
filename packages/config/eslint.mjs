// Shared ESLint 9 flat config (ADR-0001). The root eslint.config.mjs re-exports `createConfig()`;
// every package's `lint` script runs `eslint .`, which finds that root file.
//
// Layer rules (conventions §11, ADR-0002) are expressed with `no-restricted-imports` overrides, one block per
// folder, so no extra plugin is needed. Deviation from ADR-0001 (which names eslint-plugin-boundaries): the
// rules here need only path patterns; the plugin can be added later if element-type rules outgrow them.

import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import nextPlugin from "@next/eslint-plugin-next";

const restricted = (patterns, message) => ({
  "no-restricted-imports": ["error", { patterns: [{ group: patterns, message }] }],
});

export function createConfig() {
  return tseslint.config(
    {
      ignores: [
        "**/node_modules/**",
        "**/dist/**",
        "**/.next/**",
        "**/.turbo/**",
        "**/coverage/**",
        "**/*.generated.ts",
        "**/*.generated.json",
        "**/generated/**",
        "storybook-static/**",
        "playwright-report/**",
        "test-results/**",
        "refs/**",
        "catalog/**",
        "db/design/**",
        ".claude/**",
        "**/next-env.d.ts",
      ],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
      languageOptions: { globals: { ...globals.node } },
      rules: {
        "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
        "@typescript-eslint/no-unused-vars": [
          "error",
          { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
        ],
        "no-console": "error",
      },
    },
    // CLIs, scripts and tools talk to the terminal.
    {
      files: ["scripts/**", "tools/**", "**/scripts/**", "**/*.config.*", "apps/*/src/main.ts"],
      rules: { "no-console": "off" },
    },
    // apps/web: browser code. Only contracts, ui, metrics, config (conventions §11).
    {
      files: ["apps/web/**/*.{ts,tsx}"],
      languageOptions: { globals: { ...globals.browser, ...globals.node } },
      plugins: { "react-hooks": reactHooks, "@next/next": nextPlugin },
      rules: {
        ...reactHooks.configs.recommended.rules,
        ...nextPlugin.configs.recommended.rules,
        ...restricted(
          [
            "@seller-hub/mod-*",
            "@seller-hub/db",
            "@seller-hub/db/*",
            "@seller-hub/amazon-*",
            "@seller-hub/ingestion",
            "@seller-hub/core",
            "@seller-hub/core/*",
            "pg",
            "kysely",
            "ioredis",
            "bullmq",
          ],
          "apps/web may import only packages/contracts, ui, metrics and config (conventions §11).",
        ),
      },
    },
    // Modules: other modules only through their public entry; never apps.
    {
      files: ["modules/*/src/**/*.ts", "modules/*/test/**/*.ts"],
      rules: restricted(
        ["@seller-hub/mod-*/*", "**/apps/**", "../../../*/src/**"],
        "A module may import another module only through its public entry (conventions §11).",
      ),
    },
    // Layering inside a module: handler -> service -> repository.
    {
      files: ["modules/*/src/service/**/*.ts"],
      rules: restricted(
        ["**/routes/**", "**/handlers/**"],
        "service must not import routes or handlers.",
      ),
    },
    {
      files: ["modules/*/src/repository/**/*.ts"],
      rules: restricted(
        ["**/routes/**", "**/handlers/**", "**/service/**"],
        "repository must not import routes, handlers or services.",
      ),
    },
    // Only packages/amazon-* talk to Amazon (conventions §11): no HTTP clients elsewhere.
    {
      files: ["modules/*/src/**/*.ts", "apps/api/src/**/*.ts", "apps/worker/src/**/*.ts"],
      rules: restricted(
        ["axios", "got", "undici", "node-fetch", "@aws-sdk/client-sp*"],
        "Amazon calls go through packages/amazon-* only.",
      ),
    },
    {
      files: ["**/*.test.{ts,tsx}", "**/test/**"],
      rules: { "no-console": "off", "@typescript-eslint/no-non-null-assertion": "off" },
    },
  );
}
