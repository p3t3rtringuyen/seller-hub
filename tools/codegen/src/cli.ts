// pnpm --filter @seller-hub/amazon-core run codegen            regenerate packages/amazon-{sp,ads}/src/generated
//   tsx tools/codegen/src/cli.ts [sp|ads|all] [--check]
// --check: write nothing, exit 1 when the committed output differs from what the models would generate.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { defaultRepoRoot, generateAds, generateSp } from "./generate";
import type { GeneratedFile } from "./generate";
import { loadTooling } from "./tooling";

const args = process.argv.slice(2);
const check = args.includes("--check");
const which = args.find((a) => !a.startsWith("--")) ?? "all";
const root = defaultRepoRoot();

const tooling = await loadTooling(root);
const files: GeneratedFile[] = [];
if (which === "sp" || which === "all") files.push(...(await generateSp(root, tooling)));
if (which === "ads" || which === "all") files.push(...(await generateAds(root, tooling)));

let stale = 0;
for (const f of files) {
  const abs = join(root, f.path);
  const current = existsSync(abs) ? readFileSync(abs, "utf8") : null;
  if (current === f.content) continue;
  stale++;
  if (check) console.error(`codegen: ${f.path} is out of date`);
  else {
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, f.content);
  }
}
if (check && stale > 0) process.exit(1);
console.log(`codegen: ${files.length} files, ${check ? `${stale} stale` : `${stale} written`}`);
