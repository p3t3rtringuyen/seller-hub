// Discovery of the files that slices add (BACKLOG §1.2). Pure file-system + light parsing; no output.
// The conventions live in ONE place: the `PATTERNS` table below.

import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import fg from "fast-glob";

export interface Found {
  /** Repo-relative, posix separators. */
  file: string;
  /** Module directory name (`modules/<m>`), when the file belongs to a module. */
  module: string;
  /** Slice key, when it is part of the path or the file name. */
  key: string;
}

export const KEBAB = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const TS = "(ts)";

/** glob (relative to the repo root) -> how to read module/key from the path. */
export const PATTERNS = {
  routes: {
    glob: "modules/*/src/routes/*/*.route.ts",
    re: /^modules\/([^/]+)\/src\/routes\/([^/]+)\//,
  },
  permissions: {
    glob: "modules/*/src/permissions/*.permissions.ts",
    re: /^modules\/([^/]+)\/src\/permissions\/([^/.]+)\.permissions\.ts$/,
  },
  jobs: { glob: "modules/*/src/jobs/*/*.job.ts", re: /^modules\/([^/]+)\/src\/jobs\/([^/]+)\// },
  syncs: { glob: "modules/*/src/sync/*/*.sync.ts", re: /^modules\/([^/]+)\/src\/sync\/([^/]+)\// },
  commands: {
    glob: "modules/*/src/commands/*/*.command.ts",
    re: /^modules\/([^/]+)\/src\/commands\/([^/]+)\//,
  },
  publics: {
    glob: "modules/*/src/public/*.ts",
    re: /^modules\/([^/]+)\/src\/public\/([^/.]+)\.ts$/,
  },
  seeds: { glob: "modules/*/seed/*.seed.ts", re: /^modules\/([^/]+)\/seed\/([^/.]+)\.seed\.ts$/ },
  navs: { glob: "apps/web/features/*/*/*.nav.ts", re: /^apps\/web\/features\/([^/]+)\/([^/]+)\// },
  slots: {
    glob: "apps/web/features/*/*/*.slot.tsx",
    re: /^apps\/web\/features\/([^/]+)\/([^/]+)\//,
  },
  metrics: {
    glob: "packages/metrics/src/*/*.metric.ts",
    re: /^packages\/metrics\/src\/([^/]+)\/([^/.]+)\.metric\.ts$/,
  },
} as const;

export type Kind = keyof typeof PATTERNS;

export interface MessageFile extends Found {
  locale: string;
}

export interface MigrationFile {
  file: string;
  name: string;
  timestamp: string;
  /** `platform` or a module directory name. */
  module: string;
  key: string | null;
}

export interface ContractFile {
  file: string;
  module: string;
  key: string;
}

export interface Discovery {
  root: string;
  modules: string[];
  found: Record<Kind, Found[]>;
  messages: MessageFile[];
  migrations: MigrationFile[];
  contracts: ContractFile[];
  errors: string[];
}

function list(root: string, glob: string): string[] {
  return fg.sync(glob, { cwd: root, dot: false, ignore: ["**/node_modules/**"] }).sort();
}

export function discover(root: string): Discovery {
  const errors: string[] = [];
  const found = {} as Record<Kind, Found[]>;
  for (const kind of Object.keys(PATTERNS) as Kind[]) {
    const { glob, re } = PATTERNS[kind];
    found[kind] = list(root, glob).map((file) => {
      const m = re.exec(file);
      if (!m) throw new Error(`pattern for ${kind} does not match ${file}`);
      return { file, module: m[1] ?? "", key: m[2] ?? "" };
    });
  }

  const modules = fg
    .sync("modules/*/package.json", { cwd: root })
    .map((f) => f.split("/")[1] ?? "")
    .sort();

  const messages: MessageFile[] = [];
  for (const file of list(root, "apps/web/messages/*/*.json")) {
    const m = /^apps\/web\/messages\/([^/]+)\/([a-z0-9-]+)\.([a-z0-9-]+)\.json$/.exec(file);
    if (!m) {
      errors.push(
        `${file}: message files are named <module>.<key>.json (kebab-case) under messages/<locale>/`,
      );
      continue;
    }
    messages.push({ file, locale: m[1] ?? "", module: m[2] ?? "", key: m[3] ?? "" });
  }

  const migrations: MigrationFile[] = [];
  const migrationGlobs = ["packages/db/migrations/*.sql", "modules/*/migrations/*.sql"];
  for (const file of migrationGlobs.flatMap((g) => list(root, g))) {
    const name = basename(file);
    const owner = file.startsWith("packages/db/") ? "platform" : (file.split("/")[1] ?? "");
    const ts = /^(\d{14})_(.+)\.sql$/.exec(name);
    if (!ts) {
      errors.push(`${file}: migration names are <UTC yyyymmddhhmmss>_<module>_<key>_<desc>.sql`);
      continue;
    }
    const rest = ts[2] ?? "";
    if (owner === "platform") {
      if (!rest.startsWith("platform_"))
        errors.push(`${file}: platform migrations are <ts>_platform_<desc>.sql`);
      migrations.push({ file, name, timestamp: ts[1] ?? "", module: "platform", key: null });
      continue;
    }
    const prefix = `${owner}_`;
    const afterModule = rest.startsWith(prefix) ? rest.slice(prefix.length) : null;
    const key = afterModule ? afterModule.split("_")[0] : null;
    if (!afterModule || !key || !KEBAB.test(key) || afterModule.split("_").length < 2) {
      errors.push(
        `${file}: migration names are <ts>_${owner}_<key>_<desc>.sql with a kebab-case key`,
      );
      continue;
    }
    migrations.push({ file, name, timestamp: ts[1] ?? "", module: owner, key });
  }
  migrations.sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.name.localeCompare(b.name));

  const contracts: ContractFile[] = list(root, "contracts/modules/*/*.yaml").map((file) => {
    const m = /^contracts\/modules\/([^/]+)\/([^/.]+)\.yaml$/.exec(file);
    return { file, module: m?.[1] ?? "", key: m?.[2] ?? "" };
  });

  return { root, modules, found, messages, migrations, contracts, errors };
}

/** Text of a repo file (used for static checks that avoid importing React or heavy code). */
export const readRepoFile = (root: string, file: string): string =>
  readFileSync(join(root, file), "utf8");

export { TS };
