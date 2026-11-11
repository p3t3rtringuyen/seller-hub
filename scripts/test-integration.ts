// pnpm test:integration — the test step with SH_REQUIRE_DB=1 (a missing database/Redis fails instead of
// skipping). A wrapper instead of `VAR=1 cmd` so it works in cmd.exe/PowerShell as well as POSIX shells.
import { spawnSync } from "node:child_process";

const res = spawnSync("pnpm", ["run", "test"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, SH_REQUIRE_DB: "1" },
});
process.exit(res.status ?? 1);
