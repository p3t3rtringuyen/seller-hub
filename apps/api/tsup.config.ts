import { defineConfig } from "tsup";

// One self-contained file: workspace packages AND third-party packages are bundled (so `node dist/main.js`
// works from a plain copy of dist/). A banner supplies `require` for CommonJS dependencies inside the ESM
// bundle. Native add-ons are not used (pg-native stays optional/absent).
export default defineConfig({
  entry: ["src/main.ts"],
  format: ["esm"],
  target: "node24",
  platform: "node",
  clean: true,
  sourcemap: true,
  noExternal: [/.*/],
  external: ["pg-native"],
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
  },
});
