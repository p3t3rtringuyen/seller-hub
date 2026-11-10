# P2-BACKLOG — report

Date: 2026-11-10 · Model: Sonnet 5.5 (effort high) · Checkout: main (nothing committed, per brief)

## What I did

Cut the 23 ticked MVP rows of `docs/SCOPE.md` into **15 slices (S01…S15) in 5 waves** and wrote the rules that let them be
built in parallel without touching the same files. Inputs read: CLAUDE.md, `prompts/p2-backlog.md`, `docs/SCOPE.md`,
`docs/PLAN.md`, `docs/DECISIONS.md` (D10, D30, D53–D65), ADR-0001/0002/0003/0006/0008/0009/0010/0011/0012,
`docs/architecture/{overview,conventions}.md`, `docs/data-model/README.md` §6/§8, the table list of every `db/design/*.sql`
file, `docs/reports/{P2-ARCH,P2-DATA}.md`, and the P3 prompts (scaffold, clients, DS, identity, ingest) and `prompts/p4-slice.md`.

Result, in `docs/BACKLOG.md`:

1. **§1 Shared-file protocol** — a table of 17 things a slice adds *as files* (routes, contract, permissions, sync definitions,
   worker jobs, command handlers, migrations, seeds, module public entry, web pages, menu entries, UI slots, copy, metrics,
   fixtures, tests, docs), the glob each is discovered by and the generated file it feeds; the 12 shared files that remain
   with a single owner and the change process (`BLOCKED` request → wave-prep commit); module skeleton ownership; merge procedure.
2. **§2 Common acceptance criteria C1–C9** (D54 test stack, tenant isolation, contract, failure behaviour, no PII, writes
   only against mock / sandbox because D30 is OPEN, docs).
3. **§3 Slices** — each with SCOPE IDs, module and key, wave, size, effort, machine-checked OWNED_PATHS, Amazon APIs (catalogue
   cites), tables / migrations, sync definitions or jobs, API endpoints, screens, needs from packages, new deps, acceptance
   criteria (including throttling, partial failure, empty data, tenant isolation) and a QA checklist with measurements.
   A table before S01 lists what P3 already delivers for the L0 rows.
4. **§4 Waves**, **§5 Overlap check**, **§6 Coverage of the 23 rows**, **§7 Open items**.

Shape of the plan:

| Wave | Slices |
|---|---|
| P3 | SCAFFOLD, CLIENTS ∥ DS, IDENTITY ∥ INGEST — deliver PLT-01, PLT-03, PLT-04, PLT-05 and the connect half of PLT-02 |
| 1a (L0) | S01 campaign-manager (ADS-01/02/03) ∥ S02 commands + audit/History (PLT-07, PLT-06) |
| 1b (L0) | S03 bid-rule (AUT-01), owns the L0 Playwright journey |
| 2 | S04 bulk (ADS-04) · S05 campaign-detail (ADS-05) · S06 SP link + listings sync (PLT-02, CAT-01) |
| 3 | S07 ad-group-detail (ADS-06) · S08 FBA inventory (INV-01) · S09 portfolios (ADS-09) |
| 4 | S10 search-terms (ADS-07) · S11 create-campaign (ADS-08, XL) · S12 orders (ORD-02) |
| 5 | S13 listings screen (CAT-02) · S14 sales overview + TACoS (ORD-01) · S15 finance (FIN-01) |

Design choices worth knowing (each is flagged in BACKLOG §7 for Gate 2):

- **Wave 1 is two steps (1a, 1b)** because AUT-01 consumes the merged output of S01 and S02; PLAN's rule "a wave starts when the
  previous wave is merged" holds between waves. L0 is done when S03 is merged and `e2e/l0/**` is green.
- **Disjointness inside a module** is by directory key: seven slices write into `modules/ads`, each in
  `modules/ads/src/<layer>/<key>/**`, `migrations/*_ads_<key>_*.sql`, `contracts/modules/ads/<key>.yaml`,
  `apps/web/features/ads/<key>/**`, so the registry generator (ADR-0001) merges them; web pages are separate route directories;
  extension of the Campaign Manager by other slices is through named slots (`*.slot.tsx`), not by editing S01's page.
- **One generic command endpoint** (`POST /commands` with `kind`, owned by S02) so no shared `oneOf` union has to be edited;
  each command handler file carries its own payload schema.
- **Shared `package.json` / lockfile / `.env.example`** are orchestrator-owned; new dependencies are declared in the slice entry
  and added in a wave-prep commit (only S11 needs one: `papaparse`).
- **Audit table before S02:** P3-IDENTITY must write sign-in / membership events, so `ops.audit_log` and the `AuditWriter` belong
  to P3-IDENTITY (module `platform-audit` skeleton); S02 adds `ops.change_history`, History, and the commands pipeline.
- **Vendor (D60 a)** is not blocked: no slice owns paths a vendor module needs; the pipeline, registries, slots and the
  `account_type` / `sku | asin` seams are reused.

## Files created / changed

- `docs/BACKLOG.md` (new, ~1 180 lines)
- `docs/reports/P2-BACKLOG.md` (this file)

No other file was touched. Scratch scripts live in the session scratchpad (their source is in the appendix).

## Commands run and results

| Command | Result |
|---|---|
| `node check-overlap.mjs docs/BACKLOG.md` (appendix A) | `slices=15 waves=2,3,4,5,1a,1b slice-pairs=13 path-comparisons=5421 overlaps=0` |
| same on a copy where S04's `apps/web/features/ads/bulk/**` was renamed to S05's directory (mutation test) | `overlaps=1` (S04 ↔ S05), exit 1 — the checker detects a clash |
| same with every wave set to `X` (all 105 slice pairs) | 4 matches, all pairs of migration globs `*_ads_<k1>_*.sql` vs `*_ads_<k2>_*.sql` / `*_orders_…` — false positives of the glob test (different literal key infix); no real shared path |
| `node coverage.mjs` (appendix B) | `ticked rows: 23`, `problems: 0` — each ticked SCOPE row has exactly one owner (a slice, or a named P3 task for PLT-01/03/04/05); no non-MVP ID is in a slice |

## Checks skipped

- No build, lint or typecheck exists yet (CLAUDE.md "Commands" is filled in by P3-SCAFFOLD); the BACKLOG conventions are therefore
  **not** exercised against a real generator — P3-SCAFFOLD must implement them and may find a convention that needs adjusting
  (then the orchestrator changes BACKLOG §1.2, not the slices).
- Catalogue cites (`catalog/ads/operations.json`, `catalog/spapi/*`) were taken from SCOPE / the overview / the ADRs, not
  re-opened operation by operation; each slice session must read the operation entries it uses (`prompts/p4-slice.md`).
- Rate-limit numbers quoted come from SCOPE; slices must read them from `catalog/spapi/operations.json` through the limiter.

## Open questions

1. **Accept the three convention extensions** (per-slice contract files, `<m>.<k>.json` messages, `*.job.ts` jobs + slots)?
   Without them the `ads` module cannot take seven parallel slices (BACKLOG §7.2). Recommendation: accept.
2. **D30**: eight slices write to Amazon; all acceptance is mock-only until D30 is decided (§7.1).
3. **Order of waves 2–5** is ads-first; the SP-API slices can move earlier if Amazon approves R5 before R6.
4. S11 (XL) may need splitting if it overruns (§7.8).

## Follow-ups — exact edits for the orchestrator (I did not edit these files)

### `CLAUDE.md` — replace the "Target layout (created in P3)" block with

```
apps/web        Next.js (App Router), BFF — tokens never reach the browser; features/<module>/<key>/ for slice UI code
apps/api        Fastify composition root (registers module routes from a generated registry)
apps/worker     BullMQ composition root (sync definitions, jobs, command executor from generated registries)
apps/mcp        later (AI-04)
modules/<name>  feature modules (src/{routes,handlers,service,repository,sync,jobs,commands,permissions,public}/<key>/, migrations/, seed/, test/)
packages/*      config, core, db, contracts, amazon-core, amazon-sp, amazon-ads, ingestion, metrics, ui, testing
contracts/      shared/ (P3-SCAFFOLD) and modules/<module>/<key>.yaml (one OpenAPI file per slice)
db/design       DDL drafts from P2-DATA (frozen reference); db/migrations is a generated index
e2e/<key>/      Playwright specs per slice
catalog/        machine-readable API catalogues from P1
tools/          generators (catalog builders, codegen, registry, contracts)
docs/           plan, decisions, backlog, discovery, architecture, ADRs, data model, modules/<slice>.md, reports
```

Also add one line to "Before doing anything, read": `docs/BACKLOG.md` — slices, waves and the shared-file protocol (the P4 slice
brief names its slice ID).

### `docs/PLAN.md`

1. **P2 table:** P2-BACKLOG OWNED_PATHS → `docs/BACKLOG.md`, `docs/reports/P2-BACKLOG.md`.
2. **P3-SCAFFOLD** OWNED_PATHS add: `modules/` root conventions and `pnpm new:module`, `tools/registry/**`,
   `tools/contracts/**`, `contracts/shared/**`, `contracts/redocly.yaml`, `packages/{core,metrics,testing}/**` (skeletons),
   `.storybook/**`, Playwright config. Its prompt must implement BACKLOG §1.2 (all conventions, including `*.job.ts`, `*.nav.ts`,
   `*.slot.tsx`, `*.permissions.ts`, seeds, message catalogues, fixtures globs).
3. **P3-CLIENTS** OWNED_PATHS add the named v0 adapters `packages/amazon-ads/src/v0/{ex-profiles,ex-exports,ex-portfolios,ex-targeting-recs,ex-targeting-discovery,ex-change-history,ex-budget-rules}`
   (ADR-0006; budget-rules read only) and ports `CampaignsPort, AdGroupsPort, AdsPort, TargetsPort`. **Prompt fix:**
   `prompts/p3-amazon-clients.md` line 43 asks for a "Reporting v3 helper" — D57 a forbids Reporting v3; replace with the v1
   report helper (create → poll → download → decompress).
4. **P3-DS** OWNED_PATHS stay `packages/ui/**`, `apps/web/app/(shell)/**`, add `apps/web/app/(app)/layout.tsx` and the shell code
   that reads `nav.generated.ts` and `slots.generated.ts`.
5. **P3-IDENTITY** OWNED_PATHS → `modules/platform-{auth,tenancy,connections}/**`, `modules/platform-audit/{package.json,tsconfig.json,README.md,src/index.ts,src/{service,repository,public}/writer/**,migrations/*_platform-audit_writer_*.sql}`
   (skeleton, `ops.audit_log`, `AuditWriter`), `contracts/modules/platform-{auth,tenancy,connections,audit}/**`,
   `apps/web/app/(auth)/**`, `apps/web/app/(app)/settings/{members,connections}/**` (replaces `apps/web/app/settings/**` and
   `apps/api/src/modules/…`), core-schema migrations inside those modules. Prompt additions: `/v1/me` column-preference endpoint;
   `ref.marketplaces` / `ref.ads_limits` read endpoint; the audit table now in this task.
6. **P3-INGEST** OWNED_PATHS → `apps/worker/**`, `packages/ingestion/**` (+ `packages/ingestion/migrations/**` for `ingest.*`),
   `apps/web/app/(app)/settings/sync/**`, `docs/architecture/ingestion.md`. Prompt fixes: registry loader must read
   `*.sync.ts` **and** `*.job.ts` **and** `*.command.ts` (BACKLOG §1.2); remove "Ads Reporting v3" from the job types
   (`prompts/p3-ingestion-engine.md` line 23; keep "Ads export snapshot" and v1 reports); the prompt's `raw` schema /
   `core.sync_state` names map to `ingest.*` (P2-DATA README §1).
7. **P4 section:** slice IDs are S01…S15, task IDs `P4-S01`…, prompt `p4-slice.md` with parameter `SLICE_ID`; OWNED_PATHS,
   depends_on, wave, size and effort come from the BACKLOG entry (the `owned` block is authoritative). Waves: 1a, 1b, 2, 3, 4, 5 with
   ≤ 3 writers; add the **wave-prep commit** step from BACKLOG §1.5 before each wave starts. Effort `high`: S02, S03, S04, S05,
   S07, S09, S10, S11; `medium`: S01, S06, S08, S12, S13, S14, S15. P5-QA runs for every slice (all have UI). Wave 1 (S01–S03) is L0; G4 =
   all five waves merged.
8. **Gate G2** text: add "ADR amendments accepted (below)".

### ADR / convention amendments to apply together (all three change what P3-SCAFFOLD builds)

- **ADR-0010 decision 2:** `contracts/modules/<module>.yaml` → `contracts/modules/<module>/<key>.yaml` (one per slice); new
  component names prefixed `<Module><KeyPascal>`; `$ref` only to slices in `depends_on`. Single generic `POST …/commands`
  (`kind`, `payload`) with per-kind schemas declared by handlers and mirrored with `x-command-kind` in the slice contract.
- **conventions §9:** message files `apps/web/messages/<locale>/<module>.<key>.json`.
- **ADR-0008 decision 2 / ADR-0002 structure:** add `jobs/<key>/*.job.ts`; subdirectories `<key>` under each layer folder;
  `permissions/<key>.permissions.ts`; `public/<key>.ts` feeding a generated `public.generated.ts` (module `index.ts` is a
  single re-export line).
- **ADR-0003 / ADR-0001:** `apps/web/features/<module>/<key>/` for slice UI; slots and nav registries; web features import each
  other only through `public.ts`.
- **ADR-0006 follow-up already in P2-ARCH:** time library and zod generator choices stay with P3-SCAFFOLD.

### `prompts/p4-slice.md`

Add under "Read first": "the `owned` block of your slice is your OWNED_PATHS; the shared-file protocol (§1) lists the
conventions you must follow; never edit a file listed in §1.3". Replace "copy and option labels in a constants module" with the
message-catalogue rule (conventions §9). Add to "Stop and ask": a missing P3 capability named under "Needs from packages" →
`BLOCKED`.

### Other follow-ups

- P3-SMOKE should verify live the items P2-ARCH/P2-DATA listed (report coverage D57, rate-limit headers, time zones) because
  S01, S05, S10 depend on them.
- Before wave 2, decide whether `docs/modules/` needs an index (a generated list is enough).

## Appendix A — `check-overlap.mjs`

```js
// usage: node check-overlap.mjs docs/BACKLOG.md [--table]
// Parses the "### Sxx" headings, their "**wave:**" bullet and their ```owned blocks, then checks that no two
// slices of the same wave own overlapping paths (segment-wise glob intersection; "**" covers everything below).
import fs from 'node:fs';
const text = fs.readFileSync(process.argv[2], 'utf8');
const wantTable = process.argv.includes('--table');
const expand = (p) => {
  const m = p.match(/\{([^{}]*)\}/);
  if (!m) return [p];
  return m[1].split(',').flatMap((o) => expand(p.replace(m[0], o)));
};
const lines = text.split(/\r?\n/);
const slices = [];
let cur = null;
let inBlock = false;
for (const line of lines) {
  const h = line.match(/^### (S\d\d) — (.*)$/);
  if (h) { cur = { id: h[1], name: h[2], paths: [], wave: null }; slices.push(cur); continue; }
  const w = line.match(/^- \*\*wave:\*\* (\S+)/);
  if (w && cur) cur.wave = w[1];
  if (line.startsWith('```owned')) { inBlock = true; continue; }
  if (inBlock && line.startsWith('```')) { inBlock = false; continue; }
  if (inBlock && line.trim() && cur) cur.paths.push(...expand(line.trim()));
}
const esc = (g) => g.replace(/[.+^$(){}|[\]\\]/g, (c) => '\\' + c);
const rx = (g) => new RegExp('^' + esc(g).replace(/\*/g, '.*') + '$');
const witness = (g) => g.replace(/\*+/g, 'x');
function segOverlap(a, b) {
  if (a === b) return true;
  if (a.includes('*') && rx(a).test(witness(b))) return true;
  if (b.includes('*') && rx(b).test(witness(a))) return true;
  if (a.includes('*') && b.includes('*')) {
    const pa = a.split('*')[0], sa = a.split('*').pop(), pb = b.split('*')[0], sb = b.split('*').pop();
    return (pa.startsWith(pb) || pb.startsWith(pa)) && (sa.endsWith(sb) || sb.endsWith(sa));
  }
  return false;
}
function overlap(a, b) {
  const A = a.split('/'), B = b.split('/');
  const n = Math.max(A.length, B.length);
  for (let i = 0; i < n; i++) {
    const x = A[i], y = B[i];
    if (x === '**' || y === '**') {
      // "**" absorbs any directories; files can still only match both if the final segments can match both
      const la = A[A.length - 1], lb = B[B.length - 1];
      return la === '**' || lb === '**' ? true : segOverlap(la, lb);
    }
    if (x === undefined || y === undefined) return false;
    if (!segOverlap(x, y)) return false;
  }
  return true;
}
const byWave = {};
for (const s of slices) (byWave[s.wave] ??= []).push(s);
const bad = [];
let pairs = 0, comps = 0;
for (const [w, list] of Object.entries(byWave)) {
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    pairs++;
    for (const a of list[i].paths) for (const b of list[j].paths) { comps++; if (overlap(a, b)) bad.push(`wave ${w}: ${list[i].id} ${a}  <->  ${list[j].id} ${b}`); }
  }
}
const rootOf = (p) => p.split('/').slice(0, /^(modules|apps|contracts|packages)\//.test(p) ? 2 : 1).join('/');
if (wantTable) {
  for (const [w, list] of Object.entries(byWave)) {
    for (const s of list) {
      const roots = [...new Set(s.paths.map(rootOf))];
      console.log(`| ${w} | ${s.id} ${s.name} | ${s.paths.length} | ${roots.map((r) => '`' + r + '`').join(' ')} |`);
    }
  }
}
// sanity: every slice has a wave and at least one path
for (const s of slices) if (!s.wave || !s.paths.length) bad.push(`${s.id}: missing wave or owned block`);
console.error(`slices=${slices.length} waves=${Object.keys(byWave).join(',')} slice-pairs=${pairs} path-comparisons=${comps} overlaps=${bad.length}`);
for (const b of bad) console.error('PROBLEM ' + b);
process.exit(bad.length ? 1 : 0);
```

## Appendix B — `coverage.mjs`

```js
import fs from 'node:fs';
const scope = fs.readFileSync('docs/SCOPE.md','utf8').split(/\r?\n/);
const ticked = scope.filter(l => /^\| [A-Z]{3}-\d\d \|/.test(l) && /\|\s*\[x\]\s*\|\s*$/.test(l)).map(l => l.split('|')[1].trim());
const bl = fs.readFileSync('docs/BACKLOG.md','utf8').split(/\r?\n/);
const owners = {};
let cur = null;
for (const l of bl) {
  const h = l.match(/^### (S\d\d) /); if (h) cur = h[1];
  const m = l.match(/^- \*\*SCOPE IDs:\*\* ([^·]+)/);
  if (m && cur) for (const id of m[1].match(/[A-Z]{3}-\d\d/g) ?? []) (owners[id] ??= []).push(cur);
}
// P3 table rows in section 3 preamble
for (const l of bl) { const m = l.match(/^\| (PLT-\d\d)[^|]* \| \*\*(P3-[A-Z]+)\*\*/); if (m && ['PLT-01','PLT-03','PLT-04','PLT-05'].includes(m[1])) (owners[m[1]] ??= []).push(m[2]); }
console.log('ticked rows:', ticked.length, ticked.join(' '));
let bad = 0;
for (const id of ticked) { const o = owners[id] ?? []; if (o.length !== 1) { bad++; console.log('PROBLEM', id, o); } }
for (const id of Object.keys(owners)) if (!ticked.includes(id)) { bad++; console.log('NOT IN MVP', id); }
console.log('problems:', bad);
```
