import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Walks up from `start` to the folder holding pnpm-workspace.yaml. */
export function findRepoRoot(start: string = dirname(fileURLToPath(import.meta.url))): string {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error("repository root not found (pnpm-workspace.yaml)");
    dir = parent;
  }
}

/**
 * Loads `.env.local` (or the file named by SH_ENV_FILE) into process.env without overriding values that
 * are already set. Used by CLIs and servers at start-up; tests set their own environment.
 */
export function loadEnvFile(root: string = findRepoRoot()): void {
  const file = resolve(root, process.env.SH_ENV_FILE ?? ".env.local");
  if (existsSync(file)) process.loadEnvFile(file);
}
