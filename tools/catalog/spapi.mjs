#!/usr/bin/env node
// Builds catalog/spapi/** from Amazon's selling-partner-api-models (read-only input).
// Node >= 20, ESM, no dependencies. Deterministic: sorted keys/arrays, no timestamps.
//
// Usage: node tools/catalog/spapi.mjs [--refs <dir containing amazon/>] [--out <dir>]
// Default refs: <repo>/refs, else <git-common-dir>/../refs (worktrees).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const argv = process.argv.slice(2);
const arg = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };

function findRefs() {
  const given = arg('--refs');
  if (given) return path.resolve(given);
  const local = path.join(repoRoot, 'refs');
  if (fs.existsSync(path.join(local, 'amazon'))) return local;
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: repoRoot, encoding: 'utf8' }).trim();
    const alt = path.resolve(common, '..', 'refs');
    if (fs.existsSync(path.join(alt, 'amazon'))) return alt;
  } catch { /* fall through */ }
  throw new Error('refs/amazon not found; pass --refs <dir>');
}

const refs = findRefs();
const repoDir = path.join(refs, 'amazon', 'selling-partner-api-models');
const modelsDir = path.join(repoDir, 'models');
const schemasDir = path.join(repoDir, 'schemas');
const outDir = path.resolve(arg('--out') || path.join(repoRoot, 'catalog', 'spapi'));

// ---------- helpers ----------
const sortKeys = (v) => {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
};
const json = (v) => JSON.stringify(sortKeys(v), null, 2) + '\n';
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const rd = (p) => fs.readFileSync(p, 'utf8').replace(/^﻿/, '');
const firstSentence = (s) => {
  if (!s) return undefined;
  const t = String(s).replace(/\s+/g, ' ').trim();
  const m = t.match(/^(.+?[.!?])(\s|$)/);
  return (m ? m[1] : t) || undefined;
};
const refName = (r) => (typeof r === 'string' ? r.replace(/^#\/(definitions|parameters)\//, '') : undefined);
const RESTRICTED_RE = /restricted data token|\bRDT\b|restricted data|personally identifiable|\bPII\b/i;

// ---------- version / api name ----------
function parseFile(file, info) {
  const stem = file.replace(/\.json$/, '');
  const dated = stem.match(/(\d{4}-\d{2}-\d{2})/);
  let version; let base;
  if (dated) { version = dated[1]; base = stem.slice(0, dated.index); }
  else {
    const v = stem.match(/V(\d+)$/i);
    if (v) { version = 'v' + v[1]; base = stem.slice(0, v.index); }
    else { version = String((info && info.version) || 'v0'); base = stem; }
  }
  base = base.replace(/[-_V]+$/, '');
  const overrides = { InvoicesApiModel: 'invoices', fbaInbound: 'fbaInboundEligibility', definitionsProductTypes: 'productTypeDefinitions', application: 'applicationManagement' };
  return { api: overrides[base] || base, version };
}
// dated versions are newer than any vN; vN compared numerically
function versionRank(v) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return [1, v];
  const n = v.match(/(\d+)/);
  return [0, String(n ? n[1] : 0).padStart(6, '0')];
}
const cmpVersion = (a, b) => { const x = versionRank(a); const y = versionRank(b); return x[0] - y[0] || cmp(x[1], y[1]); };

// ---------- rate limit ----------
function parseRate(desc) {
  if (!desc) return null;
  const i = desc.search(/Rate \(requests per second\)/i);
  if (i < 0) return null;
  const rows = desc.slice(i).split('\n').slice(1, 6);
  for (const r of rows) {
    const m = r.match(/^\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|/);
    if (m) return { rate: Number(m[1]), burst: Number(m[2]) };
  }
  return null;
}

// ---------- definitions ----------
function propSummary(p) {
  const o = {};
  if (!p || typeof p !== 'object') return o;
  if (p.$ref) o.ref = refName(p.$ref);
  if (p.type) o.type = p.type;
  if (p.format) o.format = p.format;
  if (p.enum) o.enum = [...p.enum].map(String).sort();
  if (p.type === 'array' && p.items) {
    if (p.items.$ref) o.ref = refName(p.items.$ref);
    else if (p.items.type) o.itemType = p.items.type;
  }
  if (p.additionalProperties && typeof p.additionalProperties === 'object') {
    if (p.additionalProperties.$ref) o.ref = refName(p.additionalProperties.$ref);
    else if (p.additionalProperties.type) o.itemType = p.additionalProperties.type;
  }
  const d = firstSentence(p.description);
  if (d) o.description = d;
  return o;
}
function flattenDef(d) {
  const o = {};
  o.type = d.type || (d.properties || d.allOf ? 'object' : undefined);
  if (d.format) o.format = d.format;
  if (d.enum) o.enum = [...d.enum].map(String).sort();
  const props = { ...(d.properties || {}) };
  const required = new Set(d.required || []);
  const allOf = [];
  for (const part of d.allOf || []) {
    if (part.$ref) allOf.push(refName(part.$ref));
    for (const [k, v] of Object.entries(part.properties || {})) props[k] = v;
    for (const k of part.required || []) required.add(k);
  }
  if (allOf.length) o.allOf = allOf.sort();
  o.required = [...required].sort();
  o.properties = Object.fromEntries(Object.entries(props).map(([k, v]) => [k, propSummary(v)]));
  if (d.type === 'array' || d.additionalProperties) {
    const s = propSummary(d);
    if (s.ref) o.ref = s.ref;
    if (s.itemType) o.itemType = s.itemType;
  }
  const desc = firstSentence(d.description);
  if (desc) o.description = desc;
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
}
// does a definition (transitively) carry restricted-data wording?
function makeRestrictedProbe(defs) {
  const memo = new Map();
  const visit = (name, stack) => {
    if (memo.has(name)) return memo.get(name);
    if (stack.has(name)) return false;
    const d = defs[name];
    if (!d) return false;
    stack.add(name);
    let hit = false;
    const walk = (s) => {
      if (!s || typeof s !== 'object' || hit) return;
      if (RESTRICTED_RE.test(s.description || '')) { hit = true; return; }
      if (s.$ref && visit(refName(s.$ref), stack)) { hit = true; return; }
      for (const sub of [s.items, s.additionalProperties, ...(s.allOf || [])]) walk(sub);
      for (const v of Object.values(s.properties || {})) walk(v);
    };
    walk(d);
    stack.delete(name);
    if (stack.size === 0) memo.set(name, hit);
    return hit;
  };
  return (n) => visit(n, new Set());
}

// ---------- roles (Amazon docs, optional input) ----------
// roles.json is derived from two public doc pages saved as HTML:
//   https://developer-docs.amazon.com/sp-api/docs/role-mappings            (--roles-html)
//   https://developer-docs.amazon.com/sp-api/docs/role-mappings-for-types  (--types-html)
// Without those flags the committed roles.json is reused, so a normal run stays offline.
const decodeHtml = (s) => s.replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const stripTags = (s) => decodeHtml(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
function parseRoleHtml(html) {
  const a = html.indexOf('<article');
  let body = html.slice(a);
  const end = body.search(/<h1[^>]*>\s*Selling Partner API Code Samples/);
  if (end > 0) body = body.slice(0, end);
  const out = [];
  const parts = body.split(/<h2 class="heading heading-2[^>]*>/).slice(1);
  for (const part of parts) {
    const title = stripTags((part.match(/<div class="heading-text">([\s\S]*?)<\/div>/) || [])[1] || '');
    const entries = {};
    for (const d of part.matchAll(/<details>\s*<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/g)) {
      const name = stripTags(d[1]);
      const reg = d[2].match(/<td>Regions<\/td><td>([\s\S]*?)<\/td>/);
      const rol = d[2].match(/<td>Required roles[^<]*<\/td><td>([\s\S]*?)<\/td>/);
      entries[name] = {
        regions: reg ? stripTags(reg[1]).split(/\s*,\s*/).filter(Boolean).sort() : [],
        roles: rol ? [...new Set(rol[1].split(/<br\s*\/?>/).map(stripTags).filter(Boolean))].sort() : [],
      };
    }
    out.push({ title, entries });
  }
  return out;
}
function buildRoles(rolesHtml, typesHtml) {
  const apisOut = [];
  for (const s of parseRoleHtml(rd(rolesHtml))) {
    if (!Object.keys(s.entries).length) continue;
    const m = s.title.match(/^(.*?)\s+(v?\d[\w.-]*)$/);
    apisOut.push({ title: m ? m[1] : s.title, version: m ? m[2] : null, operations: s.entries });
  }
  const types = {};
  for (const s of parseRoleHtml(rd(typesHtml))) {
    const k = /feed/i.test(s.title) ? 'feed' : /notification/i.test(s.title) ? 'notification' : /report/i.test(s.title) ? 'report' : null;
    if (k) types[k] = s.entries;
  }
  return { sources: ['https://developer-docs.amazon.com/sp-api/docs/role-mappings', 'https://developer-docs.amazon.com/sp-api/docs/role-mappings-for-types'], apis: apisOut, types };
}
// doc title (lowercased, " api" removed) -> catalog api key, where names differ
const ROLE_TITLE_ALIAS = {
  'a+ content management': 'aplusContent', 'amazon warehousing and distribution': 'awd', 'fba inbound eligibility': 'fbaInboundEligibility',
  'messaging automations': 'messaging', 'external fulfillment shipping': 'externalFulfillmentShipments',
  'vendor direct fulfillment sandbox test data': 'vendorDirectFulfillmentSandboxData', 'invoices': 'invoices',
  'finance remittance': 'financeRemittance', 'fba inventory': 'fbaInventory',
};
const normKey = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
function roleApiKey(title, apiNames) {
  const t = title.toLowerCase().replace(/\s+api$/, '');
  if (ROLE_TITLE_ALIAS[t]) return ROLE_TITLE_ALIAS[t];
  return apiNames.find((n) => normKey(n) === normKey(t)) || null;
}

// RDT-required operations, transcribed from Amazon's Tokens API use-case guide
// (https://developer-docs.amazon.com/sp-api/docs/tokens-api-use-case-guide, "restricted operations").
// [catalog api key, versions or '*', operationIds]
const RDT_OPS = [
  ['vendorDirectFulfillmentOrders', '*', ['getOrders', 'getOrder']],
  ['vendorDirectFulfillmentShipping', 'v1', ['getShippingLabel', 'getShippingLabels', 'getPackingSlip', 'getPackingSlips', 'getCustomerInvoice', 'getCustomerInvoices', 'createShippingLabels']],
  ['vendorDirectFulfillmentShipping', '2021-12-28', ['getShippingLabel', 'getCustomerInvoices', 'getCustomerInvoice', 'getPackingSlips', 'getPackingSlip']],
  ['easyShip', '2022-03-23', ['createScheduledPackageBulk']],
  ['merchantFulfillment', '*', ['getShipment', 'cancelShipment', 'cancelShipmentOld', 'createShipment']],
  ['orders', '*', ['getOrders', 'getOrder', 'getOrderItems', 'getOrderRegulatedInfo', 'getOrderAddress', 'getOrderBuyerInfo', 'getOrderItemsBuyerInfo']],
  ['reports', '*', ['getReportDocument']],
  ['shipmentInvoicing', '*', ['getShipmentDetails']],
  ['shipping', '*', ['getShipment']],
];

// ---------- main: models ----------
const modelFiles = [];
for (const dir of fs.readdirSync(modelsDir).sort()) {
  const full = path.join(modelsDir, dir);
  if (!fs.statSync(full).isDirectory()) continue;
  for (const f of fs.readdirSync(full).sort()) modelFiles.push({ dir, f, p: path.join(full, f) });
}

const apis = []; const ops = []; const skipped = []; const defsOut = {};
const METHODS = ['get', 'put', 'post', 'delete', 'patch', 'options', 'head'];
for (const { dir, f, p } of modelFiles) {
  const rel = `models/${dir}/${f}`;
  if (!f.endsWith('.json')) {
    const txt = rd(p).replace(/\s+/g, ' ').trim();
    skipped.push({ file: rel, reason: /has been removed/i.test(txt) ? 'API removed by Amazon (stub .md only)' : 'not a JSON model', note: txt.slice(0, 160) });
    continue;
  }
  const j = JSON.parse(rd(p));
  if (!j.paths) { skipped.push({ file: rel, reason: 'no paths' }); continue; }
  const { api, version } = parseFile(f, j.info);
  const defs = j.definitions || {};
  const probe = makeRestrictedProbe(defs);
  const sharedParams = j.parameters || {};
  const audience = /^vendor/i.test(api) ? 'vendor' : 'seller';
  let opCount = 0; let depCount = 0;
  for (const [route, item] of Object.entries(j.paths)) {
    for (const m of METHODS) {
      const op = item[m];
      if (!op) continue;
      opCount++;
      if (op.deprecated) depCount++;
      const rawParams = [...(item.parameters || []), ...(op.parameters || [])].map((x) => (x.$ref ? sharedParams[refName(x.$ref)] : x)).filter(Boolean);
      let requestRef = null;
      const params = rawParams.map((x) => {
        let type = x.type || null;
        if (x.in === 'body') { requestRef = x.schema && x.schema.$ref ? refName(x.schema.$ref) : null; type = requestRef || (x.schema && x.schema.type) || 'object'; }
        else if (x.type === 'array') type = `array<${(x.items && x.items.type) || 'string'}>`;
        return { name: x.name, in: x.in, required: !!x.required, type };
      }).sort((a, b) => cmp(a.in, b.in) || cmp(a.name, b.name));
      const codes = Object.keys(op.responses || {}).filter((c) => /^2/.test(c)).sort();
      const ok = codes.length ? op.responses[codes[0]] : null;
      const responseRef = ok && ok.schema && ok.schema.$ref ? refName(ok.schema.$ref) : null;
      const desc = op.description || '';
      let restricted = false; let restrictedReason = null;
      if (RESTRICTED_RE.test(desc + ' ' + rawParams.map((x) => x.description || '').join(' '))) { restricted = true; restrictedReason = 'operation-description'; }
      else if ((responseRef && probe(responseRef)) || (requestRef && probe(requestRef))) { restricted = true; restrictedReason = 'schema-description'; }
      if (api === 'tokens' && op.operationId === 'createRestrictedDataToken') { restricted = false; restrictedReason = null; }
      ops.push({
        api, version, audience, operationId: op.operationId, method: m.toUpperCase(),
        path: (j.basePath && j.basePath !== '/' ? j.basePath : '') + route,
        summary: op.summary || firstSentence(desc) || null,
        deprecated: !!op.deprecated,
        rateLimit: parseRate(desc),
        restricted, restrictedReason,
        params, requestRef, responseRef,
      });
    }
  }
  apis.push({ api, version, audience, file: rel, group: dir, title: (j.info && j.info.title) || null, host: j.host || null, operationCount: opCount, deprecatedOperationCount: depCount, definitionCount: Object.keys(defs).length });
  defsOut[`${api}@${version}`] = Object.fromEntries(Object.entries(defs).map(([k, v]) => [k, flattenDef(v)]));
}

// superseded
const byApi = new Map();
for (const a of apis) { if (!byApi.has(a.api)) byApi.set(a.api, []); byApi.get(a.api).push(a); }
for (const list of byApi.values()) {
  list.sort((x, y) => cmpVersion(x.version, y.version));
  const newest = list[list.length - 1];
  for (const a of list) {
    a.superseded = false;
    if (a !== newest) { a.superseded = true; a.supersededBy = newest.version; a.supersededReason = 'newer-version'; }
    else if (a.operationCount > 0 && a.deprecatedOperationCount === a.operationCount) { a.superseded = true; a.supersededReason = 'all-operations-deprecated'; }
  }
}
apis.sort((a, b) => cmp(a.api, b.api) || cmpVersion(a.version, b.version));
ops.sort((a, b) => cmp(a.api, b.api) || cmpVersion(a.version, b.version) || cmp(a.operationId, b.operationId));
const supers = new Map(apis.map((a) => [`${a.api}@${a.version}`, a.superseded]));
for (const o of ops) o.superseded = supers.get(`${o.api}@${o.version}`);

// ---------- roles + RDT merge ----------
const rolesPath = path.join(outDir, 'roles.json');
if (arg('--roles-html') || arg('--types-html')) {
  if (!(arg('--roles-html') && arg('--types-html'))) throw new Error('pass both --roles-html and --types-html');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(rolesPath, json(buildRoles(arg('--roles-html'), arg('--types-html'))), 'utf8');
}
const rolesDoc = fs.existsSync(rolesPath) ? JSON.parse(rd(rolesPath)) : null;
const rolesUnmatched = [];
if (rolesDoc) {
  const apiNames = [...new Set(apis.map((a) => a.api))];
  const idx = new Map(ops.map((o) => [`${o.api}@${o.version}#${o.operationId}`, o]));
  for (const d of rolesDoc.apis) {
    const key = roleApiKey(d.title, apiNames);
    if (!key) { rolesUnmatched.push(`${d.title} ${d.version}`); continue; }
    for (const [opId, v] of Object.entries(d.operations)) {
      const o = idx.get(`${key}@${d.version}#${opId}`) || idx.get(`${key}@${d.version.replace(/^v(\d{4})/, '$1')}#${opId}`);
      if (!o) { rolesUnmatched.push(`${d.title} ${d.version} ${opId}`); continue; }
      o.roles = v.roles; o.regions = v.regions;
    }
  }
}
for (const o of ops) {
  if (!('roles' in o)) { o.roles = null; o.regions = null; } // null = not listed in Amazon's role page: unknown
  for (const [api, ver, ids] of RDT_OPS) {
    if (o.api === api && (ver === '*' || ver === o.version) && ids.includes(o.operationId)) {
      o.restricted = true; o.restrictedReason = o.restrictedReason ? o.restrictedReason + '+amazon-rdt-list' : 'amazon-rdt-list';
    }
  }
}

// ---------- reports / notifications / feeds / data kiosk ----------
const uniq = (arr) => [...new Set(arr)].sort();
const schemaFiles = (sub, ext) => (fs.existsSync(path.join(schemasDir, sub)) ? fs.readdirSync(path.join(schemasDir, sub)).filter((x) => x.endsWith(ext)).sort() : []);
const reports = []; const notifications = []; const feeds = []; const kiosk = [];
for (const f of schemaFiles('reports', '.json')) {
  const raw = rd(path.join(schemasDir, 'reports', f)); const j = JSON.parse(raw);
  reports.push({ schemaFile: `schemas/reports/${f}`, title: j.title || null, description: firstSentence(j.description) || null, reportTypes: uniq([...raw.matchAll(/"reportType"\s*:\s*"([A-Z0-9_]+)"/g)].map((m) => m[1])) });
}
for (const f of schemaFiles('notifications', '.json')) {
  const raw = rd(path.join(schemasDir, 'notifications', f)); const j = JSON.parse(raw);
  let types = uniq([...raw.matchAll(/"NotificationType"\s*:\s*"([A-Z0-9_]+)"/g)].map((m) => m[1]));
  let typesSource = 'schema-example';
  if (!types.length && rolesDoc && rolesDoc.types.notification) {
    // fall back to Amazon's notification-type list: match the file name, e.g. PricingHealthNotification -> PRICING_HEALTH
    const stem = f.replace(/\.json$/, '').replace(/_\d{4}-\d{2}-\d{2}$/, '').replace(/Notification$/, '');
    const snake = stem.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2').toUpperCase();
    types = Object.keys(rolesDoc.types.notification).filter((t) => t === snake || t === snake + 'S' || t === snake.replace(/_CHANGE$/, '_CHANGES') || normKey(t) === normKey(snake));
    typesSource = types.length ? 'filename-match' : 'unknown';
  }
  notifications.push({
    schemaFile: `schemas/notifications/${f}`, title: j.title || null, description: firstSentence(j.description) || null,
    notificationTypes: types, notificationTypesSource: typesSource,
    payloadVersions: uniq([...raw.matchAll(/"PayloadVersion"\s*:\s*"([^"]+)"/g)].map((m) => m[1])),
  });
}
for (const f of schemaFiles('feeds', '.json')) {
  const raw = rd(path.join(schemasDir, 'feeds', f)); const j = JSON.parse(raw);
  feeds.push({ schemaFile: `schemas/feeds/${f}`, title: j.title || null, description: firstSentence(j.description || j.$comment) || null, example: /\.example\.json$/.test(f) });
}
for (const f of schemaFiles('data-kiosk', '.graphql')) {
  const raw = rd(path.join(schemasDir, 'data-kiosk', f));
  const q = raw.match(/type Query\b[^{]*\{([\s\S]*?)\n\}/);
  const fields = q ? uniq([...q[1].matchAll(/^\s{2}(\w+)\s*[(:]/gm)].map((m) => m[1])) : [];
  kiosk.push({ schemaFile: `schemas/data-kiosk/${f}`, queryFields: fields, typeCount: (raw.match(/^type \w+/gm) || []).length, enumCount: (raw.match(/^enum \w+/gm) || []).length });
}

// ---------- write ----------
const versionsLine = rd(path.join(refs, 'amazon', 'VERSIONS.txt')).split('\n').map((l) => l.trim().split(/\s+/)).find((c) => c[0] === 'selling-partner-api-models');
const stamp = {
  source: 'selling-partner-api-models', commit: versionsLine ? versionsLine[1] : null, commitDate: versionsLine ? versionsLine[2] : null,
  counts: {
    modelFiles: modelFiles.length, modelFilesParsed: apis.length, modelFilesSkipped: skipped.length,
    operations: ops.length, sellerOperations: ops.filter((o) => o.audience === 'seller').length, vendorOperations: ops.filter((o) => o.audience === 'vendor').length,
    operationsOnCurrentVersions: ops.filter((o) => !o.superseded).length,
    restrictedOperations: ops.filter((o) => o.restricted).length, operationsWithRoles: ops.filter((o) => o.roles).length, operationsWithoutRateLimit: ops.filter((o) => !o.rateLimit).length,
    definitionFiles: Object.keys(defsOut).length, reportSchemas: reports.length, notificationSchemas: notifications.length, feedSchemas: feeds.length, dataKioskSchemas: kiosk.length,
  },
  skipped,
  rolesUnmatched: rolesUnmatched.sort(),
};
if (stamp.counts.modelFilesParsed + stamp.counts.modelFilesSkipped !== stamp.counts.modelFiles) throw new Error('model file count mismatch');

fs.rmSync(path.join(outDir, 'definitions'), { recursive: true, force: true });
fs.mkdirSync(path.join(outDir, 'definitions'), { recursive: true });
const w = (name, v) => fs.writeFileSync(path.join(outDir, name), json(v), 'utf8');
w('apis.json', apis); w('operations.json', ops);
for (const [k, v] of Object.entries(defsOut)) w(`definitions/${k}.json`, v);
w('reports.json', reports); w('notifications.json', notifications); w('feeds.json', feeds); w('data-kiosk.json', kiosk); w('stamp.json', stamp);
console.log(`spapi catalog: ${apis.length} api versions, ${ops.length} operations, ${Object.keys(defsOut).length} definition files, ${skipped.length} skipped -> ${path.relative(repoRoot, outDir)}`);
