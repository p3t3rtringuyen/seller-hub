// tsx tools/contracts/src/cli.ts — bundles contracts/** into packages/contracts/dist/openapi.json
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import fg from "fast-glob";
import { findRepoRoot } from "@seller-hub/config";
import { discover } from "../../registry/src/discover";
import { generate } from "../../registry/src/generate";
import { bundleContracts } from "./bundle";

const args = process.argv.slice(2);
const rootIdx = args.indexOf("--root");
const root = rootIdx >= 0 ? resolve(args[rootIdx + 1] ?? ".") : findRepoRoot();

const discovery = discover(root);
const generated = await generate(discovery);
if (generated.errors.length) {
  console.error(
    `contracts: registry problems (run pnpm gen):\n${generated.errors.map((e) => `  - ${e}`).join("\n")}`,
  );
  process.exit(1);
}

const sharedFiles = fg.sync("contracts/shared/*.yaml", { cwd: root }).sort();
const result = await bundleContracts({
  root,
  sharedFiles,
  moduleFiles: discovery.contracts,
  permissions: generated.permissions,
  commandKinds: generated.commandKinds,
});
if (result.errors.length) {
  console.error(`contracts: ${result.errors.length} problem(s)`);
  for (const e of result.errors) console.error(`  - ${e}`);
  process.exit(1);
}

const out = join(root, "packages", "contracts", "dist");
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "openapi.json"), `${JSON.stringify(result.document, null, 2)}\n`);
// Operation table for the API boot check and for tests: operationId -> method, path, permission, scope.
writeFileSync(join(out, "operations.json"), `${JSON.stringify(result.operations, null, 2)}\n`);
console.log(
  `contracts: bundled ${result.operations.length} operations from ${sharedFiles.length} shared + ${discovery.contracts.length} slice files`,
);
