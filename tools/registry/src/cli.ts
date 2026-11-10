// pnpm gen — discovers slice files and writes the generated registries.
//   tsx tools/registry/src/cli.ts [--root <dir>]
import { resolve } from "node:path";
import { findRepoRoot } from "@seller-hub/config";
import { discover } from "./discover";
import { generate } from "./generate";

const args = process.argv.slice(2);
const rootIdx = args.indexOf("--root");
const root = rootIdx >= 0 ? resolve(args[rootIdx + 1] ?? ".") : findRepoRoot();

const result = await generate(discover(root));
if (result.errors.length) {
  console.error(`registry: ${result.errors.length} problem(s)`);
  for (const e of result.errors) console.error(`  - ${e}`);
  process.exit(1);
}
const s = result.summary;
console.log(
  `registry: ${s.routes} route files, ${s.permissions} permissions, ${s.syncs} syncs, ${s.jobs} jobs, ` +
    `${s.commands} commands, ${s.migrations} migrations, ${s.seeds} seeds, ${s.navs} nav, ${s.slots} slots, ` +
    `${s.messages} message files, ${s.metrics} metric files, ${s.contracts} contracts`,
);
