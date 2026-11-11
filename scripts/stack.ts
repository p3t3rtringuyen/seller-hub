// Dev stack helper: `pnpm stack:up | stack:down | stack:ps | stack -- logs <service>`.
// Computes host ports from SH_PORT_OFFSET (or explicit SH_*_PORT), picks the compose project name and
// passes both to `docker compose -f docker-compose.dev.yml`. Prints names and ports only, never secrets.

import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { findRepoRoot, loadEnvFile, portEnv } from "@seller-hub/config";

const root = findRepoRoot();
loadEnvFile(root);

const ports = portEnv(process.env);
const project = process.env.COMPOSE_PROJECT_NAME || "sellerhub";
const env = { ...process.env, ...ports, COMPOSE_PROJECT_NAME: project };
const compose = (args: string[]) =>
  spawnSync("docker", ["compose", "-f", join(root, "docker-compose.dev.yml"), ...args], {
    cwd: root,
    env,
    stdio: "inherit",
  }).status ?? 1;

const [command = "ps", ...rest] = process.argv.slice(2);
let status = 0;
switch (command) {
  case "up":
    status = compose(["up", "-d", "--wait"]);
    if (status === 0) {
      console.log(`stack "${project}" is up. Host ports:`);
      for (const [name, value] of Object.entries(ports)) console.log(`  ${name}=${value}`);
    }
    break;
  case "down":
    // Keeps volumes; add `-v` to wipe the data of this stack only.
    status = compose(["down", ...rest]);
    break;
  case "ps":
  case "logs":
    status = compose([command, ...rest]);
    break;
  default:
    console.error("usage: stack <up|down [-v]|ps|logs [service]>");
    status = 2;
}
process.exit(status);
