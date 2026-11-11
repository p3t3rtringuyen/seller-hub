// pnpm contracts:lint — Redocly lint (contracts/redocly.yaml) over every contract source file.
import { spawnSync } from "node:child_process";
import fg from "fast-glob";
import { findRepoRoot } from "@seller-hub/config";

const root = findRepoRoot();
const files = fg
  .sync(["contracts/shared/*.yaml", "contracts/modules/*/*.yaml"], { cwd: root })
  .sort();
if (files.length === 0) {
  console.error("no contract files found");
  process.exit(1);
}
const res = spawnSync(
  "pnpm",
  ["exec", "redocly", "lint", "--config", "contracts/redocly.yaml", ...files],
  {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  },
);
process.exit(res.status ?? 1);
