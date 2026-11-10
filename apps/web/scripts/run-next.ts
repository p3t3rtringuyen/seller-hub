// Starts `next dev|start` on the web port derived from SH_PORT_OFFSET / SH_WEB_PORT (see packages/config/src/ports.ts).
import { spawn } from "node:child_process";
import { loadEnvFile, resolvePorts } from "@seller-hub/config";

loadEnvFile();
const port = resolvePorts(process.env).web;
const mode = process.argv[2] ?? "dev";
const child = spawn("pnpm", ["exec", "next", mode, "-p", String(port)], {
  stdio: "inherit",
  shell: process.platform === "win32",
});
child.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => child.kill(sig));
