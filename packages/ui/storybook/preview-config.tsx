import type { Preview } from "@storybook/react-vite";
import { PermissionProvider, ThemeProvider, ToastProvider } from "../src";

// Global decorators: theme (light/dark through the toolbar), toasts, and a permission context that grants everything
// unless a story overrides it. The message catalogue defaults come from packages/ui.
const preview: Preview = {
  parameters: {
    controls: { expanded: true },
    layout: "padded",
    a11y: { test: "error" },
  },
  globalTypes: {
    scheme: {
      description: "Colour scheme",
      toolbar: {
        title: "Scheme",
        icon: "circlehollow",
        items: [
          { value: "light", title: "Light" },
          { value: "dark", title: "Dark" },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { scheme: "light" },
  decorators: [
    (Story, context) => {
      const scheme = String(context.globals.scheme ?? "light");
      if (typeof document !== "undefined")
        document.documentElement.setAttribute("data-theme", scheme);
      return (
        <ThemeProvider>
          <PermissionProvider permissions={["ads.read", "ads.write", "example.read"]}>
            <ToastProvider>
              <Story />
            </ToastProvider>
          </PermissionProvider>
        </ThemeProvider>
      );
    },
  ],
};

export default preview;
