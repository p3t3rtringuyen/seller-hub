import type { Preview } from "@storybook/react-vite";

// Global decorators/parameters (theme provider, message catalogue, locale) are added by P3-DS.
const preview: Preview = {
  parameters: { controls: { expanded: true } },
};

export default preview;
