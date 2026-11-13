import { createRequire } from "node:module";
import path from "node:path";
import type { StorybookConfig } from "@storybook/react-vite";

// Storybook (D54). Stories live next to components: apps/web/features/**/*.stories.tsx and
// packages/ui/**/*.stories.tsx. The a11y addon is a dependency of packages/ui, so it is resolved from there.
// Storybook loads this file as CommonJS and runs from the repository root, hence process.cwd().
const uiDir = path.resolve(process.cwd(), "packages/ui");
const require = createRequire(path.join(uiDir, "package.json"));
const a11y = path.dirname(require.resolve("@storybook/addon-a11y/package.json"));

const config: StorybookConfig = {
  stories: ["../apps/web/features/**/*.stories.@(ts|tsx)", "../packages/ui/**/*.stories.@(ts|tsx)"],
  addons: [a11y],
  framework: { name: "@storybook/react-vite", options: {} },
  core: { disableTelemetry: true },
};

export default config;
