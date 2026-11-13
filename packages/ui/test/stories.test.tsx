/// <reference types="vite/client" />
import {
  composeStories,
  setProjectAnnotations,
  type Meta,
  type StoryFn,
} from "@storybook/react-vite";
import { describe, expect, it } from "vitest";
import preview from "../storybook/preview-config";
import * as ui from "../src";

// Runs every story's play function (the Storybook interaction tests, D54) inside Vitest, so `pnpm gate` executes
// them without a browser. A real-browser pass over the layout measurements is `pnpm --filter @seller-hub/ui
// run measure` (needs Playwright's chromium).
setProjectAnnotations([preview]);

const modules = import.meta.glob<Record<string, unknown>>("../src/**/*.stories.tsx", {
  eager: true,
});

describe("stories", () => {
  const entries = Object.entries(modules);
  it("finds the story files", () => {
    expect(entries.length).toBeGreaterThanOrEqual(8);
  });

  for (const [file, mod] of entries) {
    const composed = composeStories(mod as { default: Meta } & Record<string, StoryFn>);
    describe(file.replace("../src/", ""), () => {
      for (const [name, Story] of Object.entries(composed)) {
        it(`${name} renders and its interaction test passes`, async () => {
          await (Story as unknown as { run: () => Promise<void> }).run();
        });
      }
    });
  }
});

describe("coverage", () => {
  it("every exported component has a story", () => {
    const skip = /Icon$|^ThemeProvider$|^UiMessagesProvider$|^PermissionProvider$/;
    const sources = Object.keys(
      import.meta.glob("../src/**/*.stories.tsx", {
        query: "?raw",
        import: "default",
        eager: true,
      }),
    );
    const raw = import.meta.glob<string>("../src/**/*.stories.tsx", {
      query: "?raw",
      import: "default",
      eager: true,
    });
    const text = Object.values(raw).join("\n");
    expect(sources.length).toBeGreaterThan(0);
    const missing = Object.entries(ui)
      .filter(
        ([name, value]) => typeof value === "function" && /^[A-Z]/.test(name) && !skip.test(name),
      )
      .map(([name]) => name)
      .filter((name) => !new RegExp(`\\b${name}\\b`).test(text));
    expect(missing).toEqual([]);
  });
});
