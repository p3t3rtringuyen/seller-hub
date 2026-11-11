import type { StorybookConfig } from "@storybook/react-vite";

// Storybook (D54). Stories live next to components: apps/web/features/**/*.stories.tsx and
// packages/ui/**/*.stories.tsx (P3-DS adds packages/ui, the theme and the a11y addon).
const config: StorybookConfig = {
  stories: ["../apps/web/features/**/*.stories.@(ts|tsx)", "../packages/ui/**/*.stories.@(ts|tsx)"],
  framework: { name: "@storybook/react-vite", options: {} },
  core: { disableTelemetry: true },
};

export default config;
