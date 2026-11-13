import { ADS_OPERATIONS, ADS_V0_EXCEPTIONS } from "@seller-hub/amazon-ads";
import { SP_OPERATIONS } from "@seller-hub/amazon-sp";
import type { SyncDefinition } from "@seller-hub/core";
import { parseDurationMs } from "./duration";
import {
  PULL_FAMILIES,
  SYNC_FAMILIES,
  type IngestDefinition,
  type PullDefinition,
  type PushDefinition,
  type SyncScopeKind,
} from "./types";

// Boot-time validation of the registered definitions (ADR-0008 decision 2: "the build fails if a key repeats or an
// operation is not in the client allow-list"). `pnpm gen` checks key shape and duplicates; this checks the rest and
// narrows the registry's loose `SyncDefinition` to the engine's types.

export class DefinitionError extends Error {
  constructor(readonly problems: string[]) {
    super(`invalid sync definitions:\n  - ${problems.join("\n  - ")}`);
    this.name = "DefinitionError";
  }
}

const FN_FIELDS: Record<string, readonly string[]> = {
  "paged-pull": ["fetchPage", "upsert"],
  "sync-read": ["fetchPage", "upsert"],
  "spapi-report": ["report", "parse", "upsert"],
  "ads-report": ["buildRequest", "parse", "upsert"],
  "ads-export": ["exportOperation", "buildRequest", "parse", "upsert"],
  "data-kiosk": ["query", "parse", "upsert"],
  "spapi-notification": ["handle"],
  stream: ["handle"],
};

function operationKnown(id: string): boolean {
  if (id in SP_OPERATIONS) return true;
  if (id in ADS_OPERATIONS) {
    const meta = (ADS_OPERATIONS as Record<string, { generation?: string }>)[id];
    return meta?.generation !== "v0" || id in ADS_V0_EXCEPTIONS; // D53: v0 only as a named exception
  }
  return false;
}

export function toIngestDefinitions(defs: readonly SyncDefinition[]): IngestDefinition[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const d of defs) {
    const key = String(d.key);
    if (seen.has(key)) problems.push(`${key}: duplicate key`);
    seen.add(key);
    if (!(SYNC_FAMILIES as readonly string[]).includes(d.family)) {
      problems.push(`${key}: unknown family "${d.family}" (${SYNC_FAMILIES.join(", ")})`);
      continue;
    }
    for (const field of FN_FIELDS[d.family] ?? []) {
      const v = (d as Record<string, unknown>)[field];
      const ok = field === "exportOperation" ? typeof v === "string" : typeof v === "function";
      if (!ok) problems.push(`${key}: family ${d.family} needs "${field}"`);
    }
    if (d.schedule) {
      try {
        parseDurationMs(d.schedule.every);
        if (d.schedule.jitter) parseDurationMs(d.schedule.jitter);
      } catch (e) {
        problems.push(`${key}: ${(e as Error).message}`);
      }
      if (!(PULL_FAMILIES as readonly string[]).includes(d.family))
        problems.push(`${key}: push families take no schedule`);
    }
    for (const op of d.operations ?? []) {
      if (!operationKnown(op))
        problems.push(`${key}: operation "${op}" is not in the client allow-list`);
    }
    if (d.family === "ads-export") {
      const op = (d as Record<string, unknown>).exportOperation as string;
      if (!(op in ADS_OPERATIONS)) problems.push(`${key}: unknown export operation "${op}"`);
    }
  }
  if (problems.length) throw new DefinitionError(problems);
  return defs as unknown as IngestDefinition[];
}

export const isPull = (d: IngestDefinition): d is PullDefinition =>
  (PULL_FAMILIES as readonly string[]).includes(d.family);
export const isPush = (d: IngestDefinition): d is PushDefinition => !isPull(d);

/** `account` for SP-API syncs, `ads-profile` for Ads syncs unless the definition says otherwise. */
export function scopeKindOf(def: PullDefinition): SyncScopeKind {
  if (def.scopeKind) return def.scopeKind;
  const ads =
    def.family === "ads-report" || def.family === "ads-export" || def.appliesTo?.api === "ads";
  return ads ? "ads-profile" : "account";
}

export const isAdsDefinition = (def: PullDefinition): boolean =>
  def.family === "ads-report" || def.family === "ads-export" || def.appliesTo?.api === "ads";
