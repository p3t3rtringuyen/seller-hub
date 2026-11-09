#!/usr/bin/env node
// P1-ADS catalogue builder: Amazon Ads API (v1 + v0) specs, reporting, Marketing Stream, Ads MCP tools.
// Node >= 20, ESM, no dependencies, deterministic (sorted keys / arrays, no timestamps).
// Input  : <repo>/refs/amazon-ads (read-only mirror; from a worktree it is found via the git common dir)
// Output : <repo>/catalog/ads/{apis,operations,reports,stream,mcp-tools}.json, definitions/*.json
// Usage  : node tools/catalog/ads.mjs [--refs <dir>] [--out <dir>]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };

function findRefs() {
  const given = arg('--refs');
  if (given) return path.resolve(given);
  const local = path.join(REPO, 'refs', 'amazon-ads');
  if (fs.existsSync(local)) return local;
  try {
    const common = execSync('git rev-parse --path-format=absolute --git-common-dir', { cwd: REPO, encoding: 'utf8' }).trim();
    const alt = path.resolve(common, '..', 'refs', 'amazon-ads');
    if (fs.existsSync(alt)) return alt;
  } catch { /* ignore */ }
  throw new Error('refs/amazon-ads not found; run node scripts/fetch-ads-refs.mjs');
}
const REFS = findRefs();
const OUT = path.resolve(arg('--out', path.join(REPO, 'catalog', 'ads')));

// ---------------------------------------------------------------- helpers
const rd = (p) => fs.readFileSync(path.join(REFS, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(REFS, p));
const sortObj = (o) => Array.isArray(o) ? o.map(sortObj)
  : (o && typeof o === 'object') ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, sortObj(o[k])])) : o;
function write(rel, data) {
  const f = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(data, null, 1) + '\n');
}
const clip = (s, n = 200) => { if (typeof s !== 'string') return s; s = s.replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const walk = (d) => fs.readdirSync(path.join(REFS, d), { withFileTypes: true })
  .flatMap((e) => e.isDirectory() ? walk(path.posix.join(d, e.name)) : [path.posix.join(d, e.name)]).sort();

// ---------------------------------------------------------------- minimal YAML (OpenAPI subset)
function parseYaml(text) {
  const raw = text.replace(/\r\n?/g, '\n').split('\n');
  const lines = [];
  for (let i = 0; i < raw.length; i++) {
    const l = raw[i];
    lines.push(l);
  }
  let pos = 0;
  const indentOf = (l) => l.match(/^ */)[0].length;
  const isBlank = (l) => /^\s*(#.*)?$/.test(l);
  const skipBlank = () => { while (pos < lines.length && isBlank(lines[pos])) pos++; };

  function scalar(s) {
    s = s.trim();
    if (s === '' || s === '~' || s === 'null') return null;
    if (s === 'true') return true;
    if (s === 'false') return false;
    if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(s)) return Number(s);
    if (s[0] === '"') { try { return JSON.parse(s); } catch { return s.slice(1, -1); } }
    if (s[0] === "'") return s.slice(1, -1).replace(/''/g, "'");
    if (s[0] === '[' || s[0] === '{') return flow(s);
    return s.replace(/\s+#.*$/, '');
  }
  function flow(s) {
    // flow collections used by OpenAPI yaml are simple: [a, b], {}, []
    let i = 0;
    const ws = () => { while (s[i] === ' ') i++; };
    function val() {
      ws();
      if (s[i] === '[') { i++; const a = []; ws(); while (s[i] !== ']') { a.push(val()); ws(); if (s[i] === ',') i++; ws(); } i++; return a; }
      if (s[i] === '{') {
        i++; const o = {}; ws();
        while (s[i] !== '}') {
          let k = ''; while (s[i] !== ':' && s[i] !== '}') k += s[i++];
          if (s[i] === ':') i++;
          o[k.trim().replace(/^['"]|['"]$/g, '')] = val(); ws(); if (s[i] === ',') i++; ws();
        }
        i++; return o;
      }
      if (s[i] === '"' || s[i] === "'") { const q = s[i++]; let t = ''; while (i < s.length && s[i] !== q) { if (s[i] === '\\' && q === '"') { t += s[i + 1]; i += 2; } else t += s[i++]; } i++; return t; }
      let t = ''; while (i < s.length && ![',', ']', '}'].includes(s[i])) t += s[i++];
      return scalar(t);
    }
    try { return val(); } catch { return s; }
  }
  function blockScalar(style, parentIndent) {
    const chomp = style.includes('-') ? 'strip' : style.includes('+') ? 'keep' : 'clip';
    const folded = style[0] === '>';
    const out = []; let ind = null;
    while (pos < lines.length) {
      const l = lines[pos];
      if (/^\s*$/.test(l)) { out.push(''); pos++; continue; }
      const li = indentOf(l);
      if (li <= parentIndent) break;
      if (ind === null) ind = li;
      if (li < ind) break;
      out.push(l.slice(ind)); pos++;
    }
    while (out.length && out[out.length - 1] === '' && chomp !== 'keep') out.pop();
    let t = folded ? out.join('\n').replace(/([^\n])\n(?!\n)/g, '$1 ') : out.join('\n');
    if (chomp !== 'strip') t += '\n';
    return t;
  }
  function keyVal(l) {
    // returns [key, rest] or null
    const m = l.match(/^\s*(?:-\s+)*("(?:[^"\\]|\\.)*"|'[^']*'|[^\s:#'"\[\]{}][^:]*?|\$ref)\s*:(?:\s+(.*)|\s*)$/);
    if (!m) return null;
    return [m[1].replace(/^["']|["']$/g, ''), m[2] === undefined ? '' : m[2]];
  }
  function valueAfterKey(rest, keyIndent) {
    rest = rest.trim();
    if (/^[|>][+-]?\d*$/.test(rest)) return blockScalar(rest, keyIndent);
    if (rest === '' || rest[0] === '#') {
      skipBlank();
      if (pos < lines.length) {
        const l = lines[pos]; const li = indentOf(l);
        if (li > keyIndent || (li === keyIndent && /^\s*- /.test(l))) return node(li);
      }
      return null;
    }
    // plain scalar possibly continued on following more-indented lines
    if (rest[0] !== '"' && rest[0] !== "'" && rest[0] !== '[' && rest[0] !== '{') {
      let t = rest;
      for (;;) {
        let q = pos; while (q < lines.length && /^\s*$/.test(lines[q])) q++;
        if (q >= lines.length || indentOf(lines[q]) <= keyIndent || keyVal(lines[q]) || /^\s*- /.test(lines[q])) break;
        t += ' ' + lines[q].trim(); pos = q + 1;
      }
      return scalar(t);
    }
    if ((rest[0] === '"' || rest[0] === "'") && !(rest.length > 1 && rest.endsWith(rest[0]) && (rest[0] === "'" || !rest.endsWith('\\"')))) {
      let t = rest;
      while (pos < lines.length && !(t.length > 1 && t.endsWith(rest[0]))) { t += ' ' + lines[pos++].trim(); }
      return scalar(t);
    }
    return scalar(joinFlow(rest));
  }
  function node(ind) {
    skipBlank();
    if (pos >= lines.length) return null;
    const first = lines[pos];
    if (/^\s*- /.test(first) || /^\s*-$/.test(first)) return seq(indentOf(first));
    if (keyVal(first)) return map(indentOf(first));
    return scalar(joinFlow(lines[pos++].trim()));
  }
  function joinFlow(t) {
    if (t[0] !== '[' && t[0] !== '{') return t;
    const bal = (x) => { let d = 0, q = null; for (let i = 0; i < x.length; i++) { const c = x[i]; if (q) { if (c === '\\') i++; else if (c === q) q = null; } else if (c === '"' || c === "'") q = c; else if (c === '[' || c === '{') d++; else if (c === ']' || c === '}') d--; } return d; };
    while (bal(t) > 0 && pos < lines.length) t += ' ' + lines[pos++].trim();
    return t;
  }
  function seq(ind) {
    const arr = [];
    for (;;) {
      skipBlank();
      if (pos >= lines.length) break;
      const l = lines[pos];
      if (indentOf(l) !== ind || !/^\s*-(\s|$)/.test(l)) break;
      const after = l.replace(/^\s*-\s?/, '');
      const childIndent = ind + (l.length - l.replace(/^\s*-\s*/, '').length - ind);
      if (after.trim() === '' ) { pos++; arr.push(node(ind + 1)); continue; }
      if (keyVal(' '.repeat(childIndent) + after)) {
        // inline mapping inside sequence item: rewrite the line as a mapping line at childIndent
        lines[pos] = ' '.repeat(childIndent) + after;
        arr.push(map(childIndent));
      } else { pos++; arr.push(scalar(after)); }
    }
    return arr;
  }
  function map(ind) {
    const o = {};
    for (;;) {
      skipBlank();
      if (pos >= lines.length) break;
      const l = lines[pos];
      const li = indentOf(l);
      if (li !== ind || /^\s*- /.test(l)) break;
      const kv = keyVal(l);
      if (!kv) break;
      pos++;
      o[kv[0]] = valueAfterKey(kv[1], ind);
    }
    return o;
  }
  skipBlank();
  return node(0);
}

// ---------------------------------------------------------------- manifest, TOC titles
const manifest = JSON.parse(rd('manifest.json'));
const specTitle = new Map(manifest.filter((e) => e.kind === 'spec').map((e) => [e.path, e.title]));

// ---------------------------------------------------------------- $ref resolution
const refGet = (spec, ref) => ref.replace(/^#\//, '').split('/').reduce((o, k) => o && o[k.replace(/~1/g, '/').replace(/~0/g, '~')], spec);
function deref(spec, o, depth = 0) {
  while (o && o.$ref && depth++ < 8) o = refGet(spec, o.$ref);
  return o;
}
function propsOf(spec, schema, depth = 0) {
  // collect properties of an object schema, following allOf and refs
  const out = {}; let required = [];
  const s = deref(spec, schema);
  if (!s || depth > 4) return { props: out, required };
  for (const part of s.allOf || []) { const r = propsOf(spec, part, depth + 1); Object.assign(out, r.props); required = required.concat(r.required); }
  Object.assign(out, s.properties || {});
  required = required.concat(s.required || []);
  return { props: out, required };
}

// ---------------------------------------------------------------- API classification
const V1_RE = /^AmazonAdsAPI(ALL|SPGLOBAL|SP|SB|SD|ST|DSP)(.+?)Contract_prod_3p(_BETA)?$/;
const PRODUCT_NAME = { ALL: 'All Ad Products', SP: 'Sponsored Products', SPGLOBAL: 'SP Global', SB: 'Sponsored Brands', SD: 'Sponsored Display', ST: 'Sponsored Television', DSP: 'Amazon DSP' };
function v0Product(tocTitle, file) {
  const t = tocTitle || '';
  if (/Sponsored Products/.test(t) || /sponsored-products/.test(file)) return 'SP';
  if (/Sponsored Brands/.test(t) || /sponsored-brands/.test(file)) return 'SB';
  if (/Sponsored Display/.test(t) || /sponsored-display/.test(file)) return 'SD';
  if (/Amazon DSP/.test(t) || /\/dsp\//.test(file)) return 'DSP';
  if (/Marketing Cloud/.test(t)) return 'AMC';
  return null;
}
function apiId(file) {
  const b = path.posix.basename(file).replace(/\.(json|yaml)$/, '');
  if (file.startsWith('specs/dest/')) return b.replace(/_prod_3p/, '').replace(/_BETA$/, '_beta');
  const dir = path.posix.dirname(file).replace(/^specs\//, '').replace(/\//g, '-');
  return /^openapi$|-openapi$/.test(b) ? dir : `${dir}-${b}`;
}

// ---------------------------------------------------------------- spec catalogue
const apis = []; const operations = []; const skipped = [];
const specFiles = walk('specs').filter((f) => /\.(json|yaml)$/.test(f) && !f.startsWith('specs/mcp/'));

function headerParams(spec, op, pathItem) {
  const all = [...(pathItem.parameters || []), ...(op.parameters || [])].map((p) => deref(spec, p)).filter(Boolean);
  return all;
}
function mediaKeys(spec, content) { return Object.keys((deref(spec, content) || {}).content || {}).sort(); }
function analyseBatch(spec, op, reqSchema) {
  const resp = op.responses || {};
  const has207 = '207' in resp;
  let batchField = null, batchMax = null, paginated = false;
  const { props } = propsOf(spec, reqSchema);
  for (const [k, v] of Object.entries(props)) {
    const d = deref(spec, v) || {};
    if (/Filter$/.test(k)) continue;
    if (d.type === 'array' && (d.maxItems || /ids?|campaigns|adGroups|ads|targets|keywords|items|entries/i.test(k))) {
      if (!batchField || d.maxItems) { batchField = k; batchMax = d.maxItems ?? batchMax; }
    }
    if (k === 'nextToken' || k === 'maxResults' || k === 'pageToken') paginated = true;
  }
  return { has207, batchField, batchMax, paginated };
}
function permissionsOf(desc) {
  const m = /Requires (?:one of these permissions|these permissions|the permission)[^\n]*\*\*:?\s*\n?\s*(\[[^\]]*\])/.exec(desc || '');
  if (!m) return [];
  try { return JSON.parse(m[1]); } catch { return []; }
}

for (const file of specFiles) {
  const id = apiId(file);
  const base = path.posix.basename(file).replace(/\.(json|yaml)$/, '');
  const toc = specTitle.get(file) || null;
  let spec;
  try {
    spec = file.endsWith('.json') ? JSON.parse(rd(file)) : parseYaml(rd(file));
    if (!spec || !spec.paths) throw new Error('no paths object after parsing');
  } catch (e) {
    skipped.push({ file, reason: `not parseable: ${clip(String(e.message), 120)}`, toc });
    continue;
  }
  const m = V1_RE.exec(base);
  const generation = m ? 'v1' : 'v0';
  const adProduct = m ? m[1] : v0Product(toc, file);
  const beta = /_BETA$/.test(base);
  const deprecatedSection = /Deprecations/.test(toc || '');
  const nOps0 = operations.length;
  for (const [p, item] of Object.entries(spec.paths)) {
    for (const method of ['get', 'put', 'post', 'delete', 'patch', 'head', 'options']) {
      const op = item[method];
      if (!op) continue;
      const params = headerParams(spec, op, item);
      const body = deref(spec, op.requestBody);
      const reqContent = body && body.content ? body.content : {};
      const reqTypes = Object.keys(reqContent).sort();
      const reqSchema = reqTypes.length ? reqContent[reqTypes[0]].schema : null;
      const resp = op.responses || {};
      const okCodes = Object.keys(resp).filter((c) => /^2/.test(c)).sort();
      const accept = [...new Set(okCodes.flatMap((c) => mediaKeys(spec, resp[c])))].sort();
      const b = analyseBatch(spec, op, reqSchema);
      const refName = reqSchema && reqSchema.$ref ? reqSchema.$ref.split('/').pop() : null;
      const scopes = [...new Set((op.security || spec.security || []).flatMap((s) => Object.values(s).flat()))].sort();
      operations.push({
        api: id,
        operationId: op.operationId || `${method.toUpperCase()} ${p}`,
        method: method.toUpperCase(),
        path: p,
        summary: clip(op.summary || (op.description || '').split('\n')[0], 160),
        tags: op.tags || [],
        deprecated: !!op.deprecated || deprecatedSection,
        generation,
        adProduct,
        headers: params.filter((x) => x.in === 'header').map((x) => ({ name: x.name, required: !!x.required })).sort((a, c) => a.name.localeCompare(c.name)),
        pathParams: params.filter((x) => x.in === 'path').map((x) => x.name),
        queryParams: params.filter((x) => x.in === 'query').map((x) => ({ name: x.name, required: !!x.required })),
        contentType: reqTypes,
        accept,
        requestSchema: refName,
        successCodes: okCodes,
        batch: b.has207 || !!b.batchField,
        multiStatus207: b.has207,
        batchField: b.batchField,
        batchMax: b.batchMax,
        paginated: b.paginated || (p.includes('/query/') && b.paginated),
        throttled429: '429' in resp,
        scopes,
        permissions: permissionsOf(op.description),
      });
    }
  }
  const schemas = (spec.components && spec.components.schemas) || {};
  apis.push({
    id, file, generation, adProduct, adProductName: adProduct ? (PRODUCT_NAME[adProduct] || adProduct) : null,
    version: (spec.info && spec.info.version) || null, beta, deprecatedSection,
    title: toc, specTitle: (spec.info && spec.info.title) || null,
    servers: ((spec.servers || []).map((s) => s.url)).sort(),
    operations: operations.length - nOps0, schemas: Object.keys(schemas).length,
    format: file.endsWith('.yaml') ? 'yaml' : 'json',
  });
  // definitions
  const defs = {};
  for (const [name, s] of Object.entries(schemas)) defs[name] = compactSchema(s);
  write(`definitions/${id}.json`, sortObj({ api: id, file, schemas: defs }));
}

function compactSchema(s, depth = 0) {
  if (!s || typeof s !== 'object') return s;
  if (s.$ref) return { $ref: s.$ref.split('/').pop() };
  const o = {};
  for (const k of ['type', 'format', 'enum', 'required', 'minItems', 'maxItems', 'minimum', 'maximum', 'maxLength', 'default', 'nullable', 'deprecated']) if (s[k] !== undefined) o[k] = s[k];
  if (s.description) o.description = clip(s.description, 220);
  if (s.items) o.items = depth < 6 ? compactSchema(s.items, depth + 1) : '…';
  for (const k of ['allOf', 'oneOf', 'anyOf']) if (s[k]) o[k] = s[k].map((x) => compactSchema(x, depth + 1));
  if (s.properties) o.properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, depth < 6 ? compactSchema(v, depth + 1) : '…']));
  if (s.additionalProperties && typeof s.additionalProperties === 'object') o.additionalProperties = compactSchema(s.additionalProperties, depth + 1);
  return o;
}

apis.sort((a, b) => a.id.localeCompare(b.id));
operations.sort((a, b) => a.api.localeCompare(b.api) || a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
write('apis.json', { refs: 'refs/amazon-ads', specCount: specFiles.length, catalogued: apis.length, skipped, apis: sortObj(apis) });
write('operations.json', { count: operations.length, operations: sortObj(operations) });

// ---------------------------------------------------------------- markdown helpers
const mdTables = (text) => {
  const out = []; const ls = text.split(/\r?\n/);
  for (let i = 0; i < ls.length; i++) {
    if (/^\s*\|/.test(ls[i]) && i + 1 < ls.length && /^\s*\|[\s:|-]+\|?\s*$/.test(ls[i + 1])) {
      const cells = (l) => l.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim());
      const t = { header: cells(ls[i]), rows: [] }; i += 2;
      while (i < ls.length && /^\s*\|/.test(ls[i])) { t.rows.push(cells(ls[i])); i++; }
      i--; out.push(t);
    }
  }
  return out;
};
const ticks = (s) => [...String(s).matchAll(/`([^`]+)`/g)].map((m) => m[1]);
const plain = (s) => String(s).replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[`*]/g, '').trim();
const sections = (text, level) => {
  const re = new RegExp(`^${'#'.repeat(level)} (.+)$`, 'gm'); const out = []; let m; const idx = [];
  while ((m = re.exec(text))) idx.push([m.index, m[1].trim(), m.index + m[0].length]);
  idx.forEach((x, i) => out.push({ title: x[1], body: text.slice(x[2], i + 1 < idx.length ? idx[i + 1][0] : text.length) }));
  return out;
};
const frontTitle = (t) => ((/^title:\s*(.+)$/m.exec(t) || [])[1] || '').replace(/^["']|["']$/g, '') || null;

// ---------------------------------------------------------------- reports.json
function buildReports() {
  const base = 'docs/guides/reporting';
  const v3 = [];
  for (const f of walk(`${base}/v3/report-types`).filter((x) => !x.endsWith('overview.md'))) {
    const t = rd(f); const page = path.posix.basename(f, '.md');
    const configs = [];
    for (const tb of mdTables(t)) {
      if (!/^configuration/i.test(tb.header[0])) continue;
      const cols = tb.header.slice(1);
      cols.forEach((product, ci) => {
        const c = { product: cols.length === 1 && /^value$/i.test(product) ? null : plain(product), reportTypeId: null, maxDateRange: null, dataRetention: null, timeUnit: [], groupBy: [], format: [] };
        for (const r of tb.rows) {
          const key = plain(r[0]).toLowerCase(); const cell = r[ci + 1] ?? '';
          if (key === 'reporttypeid') c.reportTypeId = ticks(cell)[0] ?? plain(cell);
          else if (key.startsWith('maximum date range')) c.maxDateRange = plain(cell);
          else if (key.startsWith('data retention')) c.dataRetention = plain(cell);
          else if (key === 'timeunit') c.timeUnit = ticks(cell);
          else if (key === 'groupby') c.groupBy = ticks(cell);
          else if (key === 'format') c.format = ticks(cell);
        }
        configs.push(c);
      });
    }
    const byProduct = [];
    for (const sec of sections(t, 2)) {
      if (/^(Sample|Configurations|Request|Filters)/i.test(sec.title)) continue;
      const metricsIn = (s) => [...new Set([...s.matchAll(/\[([A-Za-z0-9_]+)\]\(guides\/reporting\/v3\/columns#/g)].map((m) => m[1]))].sort();
      const entry = { product: sec.title, baseMetrics: [], groupBySections: [] };
      for (const sub of sections(sec.body, 3)) {
        if (/^Base metrics/i.test(sub.title)) entry.baseMetrics = metricsIn(sub.body);
        else if (/^Group by/i.test(sub.title)) {
          const filters = [...sub.body.matchAll(/^\s*-\s+(`[^\n]+)$/gm)].map((m) => clip(plain(m[1]), 160));
          entry.groupBySections.push({ groupBy: ticks(sub.title)[0] ?? sub.title, additionalMetrics: metricsIn(sub.body), filters });
        }
      }
      if (entry.baseMetrics.length || entry.groupBySections.length) byProduct.push(entry);
    }
    v3.push({ page, file: f, title: frontTitle(t), configurations: configs, products: byProduct });
  }
  const colText = rd(`${base}/v3/columns.md`); const columns = [];
  for (const sec of sections(colText, 4)) {
    const type = (/\*\*Type\*\*:\s*([^\n]+)/.exec(sec.body) || [])[1] || null;
    const desc = (/\*\*Description\*\*:\s*([^\n]+)/.exec(sec.body) || [])[1] || null;
    const rt = [...sec.body.matchAll(/\[([A-Za-z0-9]+)\]\(guides\/reporting\/v3\/report-types/g)].map((m) => m[1]);
    columns.push({ name: sec.title, type: type && type.trim(), description: clip(plain(desc || ''), 200), reportTypes: [...new Set(rt)].sort() });
  }
  columns.sort((a, b) => a.name.localeCompare(b.name));
  const v1Fields = [];
  for (const f of walk(`${base}/ads-v1`).filter((x) => /\/(metrics|dimensions)\//.test(x) && !x.endsWith('library.md'))) {
    const rel = f.split('/ads-v1/')[1].split('/'); const kind = rel[0]; const family = rel.slice(1, -1).join('/');
    for (const sec of sections(rd(f), 2)) {
      const id = (/Reporting Field ID\*\*:\s*`([^`]+)`/.exec(sec.body) || [])[1]; if (!id) continue;
      const g = (re) => (re.exec(sec.body) || [])[1];
      const prog = g(/Program eligibility\*\*:\s*([^\n]+)/);
      v1Fields.push({
        id, kind: kind === 'metrics' ? 'metric' : 'dimension', family, name: sec.title,
        dataType: g(/Data Type\*\*:\s*`?([A-Z_a-z]+)`?/) || null,
        programs: prog ? [...prog.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]).sort() : [],
        v3NameSponsoredAds: g(/Version 3 Reporting Name \(Sponsored Ads\)\*\*:\s*`([^`]+)`/) || null,
        v3NameDsp: g(/Version 3 Reporting Name \(DSP\)\*\*:\s*`([^`]+)`/) || null,
        source: f,
      });
    }
  }
  v1Fields.sort((a, b) => a.id.localeCompare(b.id));
  const retention = [];
  for (const tb of mdTables(rd(`${base}/ads-v1/dates.md`))) {
    if (/time dimension/i.test(tb.header[0])) for (const r of tb.rows) retention.push({ timeDimension: ticks(r[0])[0] ?? plain(r[0]), dataRetention: plain(r[1]), maxReportDateRange: plain(r[2]) });
  }
  const migrations = [];
  for (const f of walk(`${base}/ads-v1/report-types`)) {
    const t = rd(f); const blocks = [...t.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => { try { return JSON.parse(m[1]); } catch { return null; } });
    const v3c = blocks[0] && blocks[0].configuration; const v1q = blocks[1] && blocks[1].reports && blocks[1].reports[0];
    if (!v3c || !v1q) continue;
    migrations.push({ v3ReportTypeId: v3c.reportTypeId, adProduct: v3c.adProduct, v3GroupBy: v3c.groupBy, v3Columns: [...(v3c.columns || [])].sort(), v1Fields: [...(v1q.query.fields || [])], v1Filters: v1q.query.filter ?? null, example: f });
  }
  migrations.sort((a, b) => a.v3ReportTypeId.localeCompare(b.v3ReportTypeId));
  const ops = operations.filter((o) => o.api === 'OfflineReport_prod_3p'.replace('_prod_3p', '') || o.api === 'AmazonAdsAPIALLReportsContract')
    .map((o) => ({ generation: o.generation, operationId: o.operationId, method: o.method, path: o.path, contentType: o.contentType, accept: o.accept }));
  const def = JSON.parse(fs.readFileSync(path.join(OUT, 'definitions', 'AmazonAdsAPIALLReportsContract.json'), 'utf8')).schemas;
  const fmt = Object.entries(def).filter(([k]) => /format/i.test(k)).map(([k, v]) => ({ schema: k, enum: v.enum ?? null }));
  const limitsText = rd(`${base}/ads-v1/limits.md`);
  return sortObj({
    deprecation: {
      v3: 'Reporting API v3 deprecated on 2027-06-30 (banner on every v3 page); migrate to v1 reporting (POST /adsApi/v1/create/reports).',
      sources: [`${base}/v3/columns.md`, `${base}/ads-v1/quickstart.md`],
    },
    v3: { operations: ops.filter((o) => o.generation === 'v0'), reportTypes: v3, columns },
    v1: {
      operations: ops.filter((o) => o.generation === 'v1'),
      dataRetention: retention, formatEnums: fmt,
      limits: { source: `${base}/ads-v1/limits.md`, http429: /429/.test(limitsText), note: 'Docs: concurrent report generation can be as low as 1 and request rate as low as 1 req/s (client-specific); exceeding returns HTTP 429; higher limits only via support ticket.' },
      fields: v1Fields, migrationExamples: migrations,
      counts: { metrics: v1Fields.filter((f) => f.kind === 'metric').length, dimensions: v1Fields.filter((f) => f.kind === 'dimension').length },
    },
  });
}

// ---------------------------------------------------------------- stream.json
function buildStream() {
  const datasets = [];
  const grab = (text, startIdx, endIdx) => {
    const fields = [];
    for (const tb of mdTables(text.slice(startIdx, endIdx))) {
      const h = tb.header.map((x) => x.toLowerCase());
      let ci = h.findIndex((x) => x === 'field id'); if (ci < 0) ci = h.findIndex((x) => x === 'field name' || x === 'field' || x === 'name');
      if (ci < 0) continue;
      const ti = h.findIndex((x) => /data type|^type$/.test(x)); const di = h.findIndex((x) => x === 'description');
      for (const r of tb.rows) { const n = ticks(r[ci])[0]; if (n) fields.push({ name: n, type: ti >= 0 ? plain(r[ti]) : null, description: di >= 0 ? clip(plain(r[di]), 140) : null }); }
    }
    return fields;
  };
  for (const f of walk('docs/guides/amazon-marketing-stream/datasets')) {
    const t = rd(f); const ms = [...t.matchAll(/(?:use the ID|the ID is) `([a-z0-9-]+)`|use the `([a-z0-9-]+)` ID|use `([a-z0-9-]+)` as the ID/g)].map((m) => Object.assign(m, { 1: m[1] || m[2] || m[3] }));
    ms.forEach((m, i) => {
      const end = i + 1 < ms.length ? ms[i + 1].index : t.length;
      const head = [...t.slice(0, m.index).matchAll(/^##+ (.+)$/gm)].filter((h) => !/^Dataset ID$/i.test(h[1])).pop();
      datasets.push({ id: m[1], version: 'v1', page: f, title: head ? head[1].trim() : null, fields: grab(t, m.index, end), subscriptionEndpoint: 'POST /streams/subscriptions' });
    });
  }
  const v2dir = 'docs/guides/amazon-marketing-stream/v2/datasets';
  const ov = mdTables(rd(`${v2dir}/overview.md`)).find((t) => /dataset id/i.test(t.header[0]));
  const grain = new Map((ov ? ov.rows : []).map((r) => [ticks(r[0])[0], plain(r[1])]));
  for (const f of walk(v2dir).filter((x) => !x.endsWith('overview.md'))) {
    const t = rd(f); const id = ((/Stream dataset ID\s*\|\s*`([^`]+)`/.exec(t)) || [])[1]; if (!id) continue;
    const win = ((/Restatement window\s*\|\s*([^|\n]+)/.exec(t)) || [])[1];
    const acct = ((/Supported account types\s*\|\s*([^|\n]+)/.exec(t)) || [])[1];
    datasets.push({ id, version: 'v2', page: f, title: frontTitle(t), grain: grain.get(id) ?? null, restatementWindow: win && win.trim(), supportedAccountTypes: acct && acct.trim(), fields: grab(t, 0, t.length), subscriptionEndpoint: 'POST /adsApi/v1/create/streamSubscriptions' });
  }
  datasets.sort((a, b) => a.version.localeCompare(b.version) || a.id.localeCompare(b.id));
  const subOps = operations.filter((o) => /StreamSubscriptions|AmazonMarketingStream/.test(o.api)).map((o) => ({ api: o.api, generation: o.generation, operationId: o.operationId, method: o.method, path: o.path, contentType: o.contentType, accept: o.accept }));
  return sortObj({
    deprecation: { v1: 'Amazon Marketing Stream v1 is shut off on 2027-06-30 (docs warning on every v1 dataset page); migrate to v2 (docs/guides/amazon-marketing-stream/v2/migrate-from-v1.md).' },
    note: 'v2 datasets carry reporting data only (ads-performance-v1, ads-converted-product-v1). v1 campaign-management, budget-usage and diagnostics datasets have no v2 dataset in the mirror.',
    subscriptionOperations: subOps, datasets,
  });
}

// ---------------------------------------------------------------- mcp-tools.json
// group -> tool -> [operationId, ...]; the token 'inferred' switches the following ids to inferred confidence
// (Amazon documents no tool -> operation table; 'direct' = same name / description as the operation).
const MCP_BACKING = {
  account_management: {
    query_advertiser_account: ['QueryAdvertiserAccount'], create_advertiser_account: ['CreateAdvertiserAccount'], update_advertiser_account: ['UpdateAdvertiserAccount'],
    update_account_currency: ['inferred', 'UpdateAdvertiserAccount'], update_account_timezone: ['inferred', 'UpdateAdvertiserAccount'], update_account_name: ['inferred', 'UpdateAdvertiserAccount'],
    query_account_link: ['QueryAccountLink'],
  },
  ads_accounts: { list_ads_accounts: ['ListAdsAccounts'], create_ads_account: ['RegisterAdsAccount'], get_ads_account: ['GetAccount'] },
  advertiser_product_group_eligibility: { query: ['QueryAdvertiserProductGroupEligibility'], create: ['CreateAdvertiserProductGroupEligibility'] },
  amazon_live: {},
  amc: {
    get_workflows: ['listWorkflows'], get_workflow: ['getWorkflow'], create_workflow: ['createWorkflow'], delete_workflow: ['deleteWorkflow'],
    get_data_sources: ['listDataSources'], get_data_source: ['getDataSource'], execute_workflow: ['createWorkflowExecution'],
    execute_query: ['inferred', 'createWorkflowExecution'], get_workflow_execution_status: ['getWorkflowExecution'], get_workflow_execution_download_url: ['getWorkflowExecutionDownloadUrls'],
  },
  billing: {
    list_invoice_summaries: ['GetBillingInvoiceSummaries'], query_billing_notifications: ['bulkGetBillingNotifications'], list_invoices: ['inferred', 'getAdvertiserInvoices'], list_billing_profile_usages: ['GetBillingProfileUsages'],
  },
  campaign_management: {
    create_campaign: ['CreateCampaign'], update_campaign: ['UpdateCampaign'], delete_campaign: ['DeleteCampaign'], query_campaign: ['QueryCampaign'],
    update_campaign_state: ['inferred', 'UpdateCampaign'], update_campaign_budget: ['inferred', 'UpdateCampaign'],
    create_ad_group: ['CreateAdGroup'], update_ad_group: ['UpdateAdGroup'], delete_ad_group: ['DeleteAdGroup'], query_ad_group: ['QueryAdGroup'],
    create_ad: ['CreateAd'], update_ad: ['UpdateAd'], delete_ad: ['DeleteAd'], query_ad: ['QueryAd'],
    create_ad_association: ['CreateAdAssociation'], update_ad_association: ['UpdateAdAssociation'], delete_ad_association: ['DeleteAdAssociation'], query_ad_association: ['QueryAdAssociation'],
    create_target: ['CreateTarget'], update_target: ['UpdateTarget'], delete_target: ['DeleteTarget'], query_target: ['QueryTarget'], update_target_bid: ['inferred', 'UpdateTarget'],
    create_portfolio: ['inferred', 'CreatePortfolios'], update_portfolio: ['inferred', 'UpdatePortfolios'], query_portfolio: ['inferred', 'ListPortfolios'],
    create_singleshot_portfolio: ['inferred', 'CreatePortfolios', 'UpdateCampaign'],
    create_singleshot_sp_campaign: ['inferred', 'SPGlobalCreateCampaign', 'SPGlobalCreateAdGroup', 'SPGlobalCreateAd', 'SPGlobalCreateTarget'],
    add_country_campaign: ['inferred', 'SPGlobalUpdateCampaign'],
    check_product_eligibility: ['inferred', 'productEligibility'],
    dsp_create_conversion_tracking_products: ['DspPostProductConversionTrackingV1'], create_bid_adjustment_rule: ['CreateBidAdjustmentRule'],
  },
  eligibility: { programs: ['ProgramEligibility'], product_list: ['productEligibility'] },
  manager_accounts: { get_manager_accounts: ['getManagerAccountsForUser'], create_manager_account: ['createManagerAccount'], associate_accounts: ['LinkAdvertisingAccountsToManagerAccountPublicAPI'], disassociate_accounts: ['UnlinkAdvertisingAccountsToManagerAccountPublicAPI'] },
  promotions: { redeem_promotion_code: ['CreatePromotionCodeRedemption'], query_promotion_offers: ['QueryPromotionOffer'], query_promotion_rewards: ['QueryPromotionReward'] },
  reporting: { create_report: ['AdsApiv1CreateReport'], create_campaign_report: ['inferred', 'AdsApiv1CreateReport'], create_inventory_report: ['inferred', 'AdsApiv1CreateReport'], create_product_report: ['inferred', 'AdsApiv1CreateReport'], retrieve_report: ['AdsApiv1RetrieveReport'], delete_report: ['AdsApiv1DeleteReport'] },
  terms_token: { create_terms_token: ['CreateTermsToken'], get_terms_token: ['GetTermsToken'] },
  test_accounts: { create_test_account: ['createAccount'], get_test_accounts: ['GetAccountInformation'] },
  users: { list_users: ['ListUsers'] },
  user_invitation: { redeem: ['RedeemUserInvitation'], get: ['GetUserInvitation'] },
  user_invitations: { create: ['CreateUserInvitations'], update: ['UpdateUserInvitations'], list: ['ListUserInvitations'] },
  user_permissions: { list_user_permissions: ['QueryUserPermissions'], delete_user_permissions: ['DeleteUserPermissions'], update_user_permissions: ['UpdateUserPermissions'] },
  user_roles: { list_user_roles: ['QueryUserRoles'] },
};
function sideEffect(name) {
  if (/^(delete|disassociate)/.test(name)) return 'destructive';
  if (/^(execute_|create_.*report$|create_report$)/.test(name)) return 'starts-job';
  if (/^(create|update|redeem|associate|add_|dsp_create)/.test(name)) return 'mutates';
  return 'none';
}
function buildMcp() {
  const byId = new Map();
  for (const o of operations) { if (!byId.has(o.operationId)) byId.set(o.operationId, []); byId.get(o.operationId).push(o); }
  const tools = []; const groups = [];
  for (const f of fs.readdirSync(path.join(REFS, 'specs', 'mcp')).filter((x) => x.endsWith('.json')).sort()) {
    const s = JSON.parse(rd(`specs/mcp/${f}`)); const group = f.replace(/\.json$/, '');
    const map = MCP_BACKING[group]; if (!map) throw new Error(`MCP group ${group} missing from MCP_BACKING`);
    let n = 0;
    for (const [p, item] of Object.entries(s.paths)) {
      const op = item.post; const name = op.operationId;
      const schema = deref(s, (op.requestBody.content['application/json'] || {}).schema) || {};
      const inputs = {};
      for (const [k, v] of Object.entries(schema.properties || {})) {
        if (k === 'skill') continue;
        const d = deref(s, v) || {};
        inputs[k] = { required: (schema.required || []).includes(k), fields: Object.fromEntries(Object.entries(d.properties || {}).map(([fk, fv]) => { const x = deref(s, fv) || {}; return [fk, { type: x.type ?? (x.oneOf ? 'oneOf' : null), required: (d.required || []).includes(fk), description: clip(x.description, 120) ?? null }]; })) };
      }
      const b = map[name]; const backing = [];
      if (b) {
        let conf = 'direct';
        for (const x of b) {
          if (x === 'inferred') { conf = 'inferred'; continue; }
          const hit = byId.get(x); if (!hit) throw new Error(`MCP ${group}/${name}: operationId ${x} not in operations.json`);
          backing.push({ operationId: x, api: hit[0].api, generation: hit[0].generation, method: hit[0].method, path: hit[0].path, confidence: conf });
        }
      }
      const se = sideEffect(name);
      tools.push({
        group, name, fullName: `${group}-${name}`, endpointPath: p, description: clip(op.description, 400), tags: op.tags || [],
        access: se === 'none' ? 'read' : 'write', sideEffect: se, inputs, backingOperations: backing,
        backingNote: backing.length ? null : 'no matching operation in the published Ads API specs',
      });
      n++;
    }
    groups.push({ group, file: `specs/mcp/${f}`, title: s.info.description, toolCount: n });
  }
  tools.sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
  return sortObj({
    status: 'open beta', docs: ['docs/mcp/mcp-overview.md', 'docs/mcp/get-started.md', 'docs/mcp/get-started-lite.md', 'docs/mcp/oauth.md'],
    endpoints: { regular: { NA: 'https://advertising-ai.amazon.com/mcp', EU: 'https://advertising-ai-eu.amazon.com/mcp', FE: 'https://advertising-ai-fe.amazon.com/mcp' }, lite: { NA: 'https://advertising-ai.amazon.com/mcp/lite', EU: 'https://advertising-ai-eu.amazon.com/mcp/lite', FE: 'https://advertising-ai-fe.amazon.com/mcp/lite' } },
    liteMetaTools: ['amazon_ads_mcp-search_tools', 'amazon_ads_mcp-describe_tools', 'amazon_ads_mcp-invoke_tool'],
    groups, toolCount: tools.length, tools,
  });
}

const reports = buildReports(); write('reports.json', reports);
const stream = buildStream(); write('stream.json', stream);
const mcp = buildMcp(); write('mcp-tools.json', mcp);
console.log(`v3 report types: ${reports.v3.reportTypes.length} (columns ${reports.v3.columns.length}); v1 fields: ${reports.v1.fields.length}; stream datasets: ${stream.datasets.length}; mcp tools: ${mcp.toolCount} in ${mcp.groups.length} groups`);

// ---------------------------------------------------------------- domain-map.json (D53: v1 default, v0 only as named exceptions)
const EXCEPTIONS = {
  'EX-PORTFOLIOS': { domain: 'portfolios', why: 'v1 has no portfolio entity (v1 campaigns only carry portfolioId and a portfolioIdFilter).', watch: 'v1 release notes; reference/amazon-ads/overview "Future vision" (rules, recommendations)' },
  'EX-BUDGET-RULES': { domain: 'budgets', why: 'Budget rules (SP/SB/SD) exist only in v0; the migration skills mark them "keep using v3/v4".', watch: 'release-notes/ads-api-v1.md for a budget-rule entity' },
  'EX-BUDGET-USAGE-RECS': { domain: 'budgets', why: 'Budget usage and budget recommendations have no v1 operation (migration skills: not migrable).', watch: 'release-notes/ads-api-v1.md; the Stream v1 budget-usage dataset has no v2 successor' },
  'EX-OPTIMIZATION-RULES': { domain: 'bid-adjustments', why: 'Rule-based bidding / optimization rules have no v1 operation. Placement and audience bid adjustments themselves ARE in v1 (campaign optimizations.bidSettings).', watch: 'v1 "rules" expansion (reference/amazon-ads/overview future vision)' },
  'EX-TARGETING-RECS': { domain: 'recommendations', why: 'Bid / keyword / product / category / theme recommendations, target promotion groups, SB headline recs, forecasts, insights and campaign diagnostics are v0 only. v1 Recommendations covers only 4 types today.', watch: 'guides/recommendations/recommendations-api/recommendation-types.md (new types)' },
  'EX-TARGETING-DISCOVERY': { domain: 'targets', why: 'Category browse, refinements, product counts, brand search, locations and audience lists used to build targets have no v1 operation.', watch: 'v1 Targets contracts' },
  'EX-EXPORTS': { domain: 'exports', why: 'Bulk async metadata export (campaigns, ad groups, ads, targets) exists only in v0; Amazon states the Exports API is NOT affected by the v3 reporting deprecation.', watch: 'release-notes/deprecations.md (Sep 2026 entry)' },
  'EX-CHANGE-HISTORY': { domain: 'change-history', why: 'POST /history exists only in v0 and covers SP and SB campaigns only (no SD, no actor).', watch: 'any v1 events/history entity' },
  'EX-PROFILES': { domain: 'accounts', why: 'Profiles remain the source of the Amazon-Advertising-API-Scope value and of marketplace / currency / timezone / account type; v1 AdvertiserAccount carries alternateIds and may replace it - verify with a real account before dropping.', watch: 'reference/amazon-ads/getting-started.md (still points to the Profiles API)' },
  'EX-TERMS-TOKEN': { domain: 'accounts', why: 'Terms token creation / lookup used by account registration has no v1 operation.', watch: 'guides/account-management/registration' },
  'EX-MANAGER-LINKING': { domain: 'accounts', why: 'Linking / unlinking advertising accounts to a manager account is v0 only (v1 ManagerAccounts: create / query / update).', watch: 'v1 ManagerAccounts contract' },
  'EX-USERS-PERMISSIONS': { domain: 'accounts', why: 'User invitations, permissions and roles are v0 only (v1 has only beta account-link invites).', watch: 'v1 beta AccountLinkInvites / AccountLinks' },
  'EX-TEST-ACCOUNTS': { domain: 'accounts', why: 'Test account creation is v0 only; needs scope advertising::test:create_account.', watch: 'guides/account-management/test-accounts' },
  'EX-ELIGIBILITY': { domain: 'accounts', why: 'Program and product eligibility checks have no GA v1 operation (v1 AdvertiserProductGroupEligibilities is beta and about product groups).', watch: 'v1 beta contracts' },
  'EX-BILLING': { domain: 'billing', why: 'Invoices, billing profiles and payment methods have no v1 operation.', watch: 'release notes' },
  'EX-BRAND-ASSETS': { domain: 'creative-assets', why: 'Creative asset library, SB media upload and store / page lookups used by SB / SD creatives are v0 only (v1 BrandStores* are query-only).', watch: 'v1 BrandStores* contracts' },
  'EX-MODERATION': { domain: 'ads', why: 'Ad moderation results (and pre-moderation) are v0 only.', watch: 'guides/moderation' },
  'EX-BRAND-ANALYTICS': { domain: 'reporting', why: 'Brand Metrics, benchmarks, Stores insights and MMM are separate v0 report APIs outside v1 reporting.', watch: 'guides/reporting/brand-metrics' },
  'EX-BRAND-SAFETY': { domain: 'targets', why: 'Sponsored Display brand-safety deny list and its status/results polling have no v1 operation.', watch: 'v1 SD Targets contract (negative brand targets)' },
  'EX-EVENTS': { domain: 'campaigns', why: 'SP /sp/v1/events is v0; v1 CreateEvent is closed beta.', watch: 'developer/betas.md' },
};
function pathException(p) {
  if (/budgetRules\/recommendations|budget\/usage|budgetRecommendations|initialBudgetRecommendation/.test(p)) return 'EX-BUDGET-USAGE-RECS';
  if (/budgetRules/.test(p)) return 'EX-BUDGET-RULES';
  if (/rules\/(optimization|campaignOptimization)|optimizationRules/.test(p)) return 'EX-OPTIMIZATION-RULES';
  if (/targets\/(categories|category)|refinements|products\/count|\/locations|\/targets\/brands|negativeTargets\/brands\/search/.test(p)) return 'EX-TARGETING-DISCOVERY';
  if (/recommendations|forecasts|insights|targetPromotionGroups|negativeTargets\/brands|bidRecommendations/.test(p)) return 'EX-TARGETING-RECS';
  if (/brandSafety/.test(p)) return 'EX-BRAND-SAFETY';
  if (/\/v1\/events/.test(p)) return 'EX-EVENTS';
  if (/^\/(media|stores\/assets|brands|pageAsins)(\/|$)|^\/sd\/(stores|media)/.test(p)) return 'EX-BRAND-ASSETS';
  return null;
}
const entityOfPath = (p) => /negative|keyword|target/i.test(p) ? 'targets' : /productAds|\/ads|creatives/i.test(p) ? 'ads' : /adGroups/.test(p) ? 'ad-groups' : /campaigns/.test(p) ? 'campaigns' : 'other';
const ENT = { campaigns: 'Campaign', 'ad-groups': 'AdGroup', ads: 'Ad', targets: 'Target' };
const opIds = new Set(operations.map((o) => o.operationId));
function v1Equivalent(o, domain) {
  const prod = { SponsoredProducts: 'SP', 'sponsored-brands-4-0': 'SB', 'sponsored-display-3-0': 'SD' }[o.api]; if (!prod || !ENT[domain]) return null;
  const verb = /\/delete$/.test(o.path) || o.method === 'DELETE' ? 'Delete' : (o.method === 'PUT' || o.method === 'PATCH') ? 'Update' : /\/list$/.test(o.path) || o.method === 'GET' ? 'Query' : 'Create';
  const id = `${prod}${verb}${ENT[domain]}`; return opIds.has(id) ? id : null;
}
const V1_ACCOUNTS = /ALL(AdvertiserAccounts|ManagerAccounts|AccountLinks|AccountLinkInvites|AccountCombinationInvitations|SellingAccounts|Sellers)Contract/;
const V1_CM = /^AmazonAdsAPI(ALL|SPGLOBAL|SP|SB|SD|ST)(Campaigns|AdGroups|AdExtensions|AdAssociations|Ads|Targets)Contract/;
const V1_OOS = /(ALL|SB)(AdvertisingDeals|AdvertisingDealTargets|BuyerSeats|CampaignForecasts|Commitments|CommitmentSpends|DealAdvertiserAccess|DealAvails|DealPerformances|DealPlanningMetrics|DealPreferences|GeoLocations|InventoryGroups|LinearTv|LocationIndexes|Publishers|Supplier)|^AmazonAdsAPIDSP/;
function classify(o, api) {
  const id = o.api;
  const mk = (domain, treatment, exception = null, note = null) => ({ domain, treatment, exception, note, v1Equivalent: treatment === 'v0-superseded' ? v1Equivalent(o, domain) : null });
  if (o.generation === 'v1') {
    if (V1_OOS.test(id) || o.adProduct === 'DSP') return mk('dsp-media-planning', 'v1-out-of-scope', null, 'Amazon DSP / deals / supplier / media planning: agency + DSP advertisers, not Seller/Vendor sponsored ads');
    if (V1_ACCOUNTS.test(id)) return mk('accounts', 'v1-default', null, /_beta$/.test(id) ? 'beta' : null);
    const m = V1_CM.exec(id); if (m) { const ent = { Campaigns: 'campaigns', AdGroups: 'ad-groups', Ads: 'ads', AdExtensions: 'ads', AdAssociations: 'ads', Targets: 'targets' }[m[2]]; return mk(ent, 'v1-default', null, m[1] === 'ALL' ? 'cross-product contract (adProduct selects SP/SB/SD/ST/DSP)' : `${m[1]}-specific contract`); }
    if (/ALLReports/.test(id)) return mk('reporting', 'v1-default');
    if (/ALLStreamSubscriptions/.test(id)) return mk('marketing-stream', 'v1-default', null, 'Stream v2 subscriptions');
    if (/ALL(Recommendations|RecommendationTypes)|SBRecommendations/.test(id)) return mk('recommendations', 'v1-default');
    if (/ALL(Labels|LabelObjectAssociations)/.test(id)) return mk('labels', 'v1-default', null, 'query-only labels');
    if (/ALLBrandStore|ALLBrandedKeywords|ALLKeywordReservation|ALLReservedTarget/.test(id)) return mk('creative-assets', 'v1-default', null, 'brand stores / SB brand keyword reservation (query or beta)');
    if (/ALLAdvertiserProductGroupEligibilities/.test(id)) return mk('accounts', 'v1-default', null, 'beta');
    if (/ALL(Promotion|Communication|Events)/.test(id)) return mk('accounts', 'v1-default', null, 'beta: promotions / communication preferences / events');
    return null;
  }
  const e = (x, note) => mk(EXCEPTIONS[x].domain, 'v0-exception', x, note);
  if (['SponsoredProducts', 'sponsored-brands-4-0', 'sponsored-display-3-0', 'sponsored-brands-3-0', 'sponsored-products-2-0'].includes(id)) {
    if (id === 'sponsored-products-2-0') return mk(entityOfPath(o.path), 'v0-deprecated', null, 'Sponsored Products v2 legacy (see release-notes/deprecations.md)');
    if (/report|snapshot/.test(o.path)) return mk('reporting', 'v0-deprecated', null, 'v2/v3 sponsored ads reporting shuts off 2027-06-30; use v1 Reports');
    if (/legacyCampaigns|migrations/.test(o.path)) return mk('campaigns', 'v0-deprecated', null, 'SB v3 -> v4 migration jobs');
    const x = pathException(o.path); if (x) return e(x);
    if (id === 'sponsored-brands-3-0') return mk(entityOfPath(o.path), 'v0-deprecated', null, 'SB v3 legacy, superseded by SB v4 and v1');
    return mk(entityOfPath(o.path), 'v0-superseded', null, `v1 ${id === 'SponsoredProducts' ? 'SP' : id === 'sponsored-brands-4-0' ? 'SB' : 'SD'} contract replaces it`);
  }
  const X = {
    Portfolios: () => e('EX-PORTFOLIOS'), 'profiles-3-0': () => e('EX-PROFILES'),
    AdvertisingAccounts: () => /termsTokens/.test(o.path) ? e('EX-TERMS-TOKEN') : mk('accounts', 'v0-deprecated', null, 'legacy account management: shutoff July 2027, replaced by v1 create/query advertiserAccounts'),
    ManagerAccount: () => /associate|disassociate/.test(o.path) ? e('EX-MANAGER-LINKING') : mk('accounts', 'v0-superseded', null, 'v1 ManagerAccounts create/query'),
    AdvertisingInvitations: () => e('EX-USERS-PERMISSIONS'), AdvertisingUserPermissionsManagement: () => e('EX-USERS-PERMISSIONS'),
    AdvertisingTestAccount: () => e('EX-TEST-ACCOUNTS'), Eligibility: () => e('EX-ELIGIBILITY'), ProductSelector: () => e('EX-ELIGIBILITY', 'product picker for ad creation'),
    AdvertisingBilling: () => e('EX-BILLING'), Advertisers: () => e('EX-BILLING', 'account budget feature flags'),
    AmazonAdsAPIExports: () => e('EX-EXPORTS'), Changehistory: () => e('EX-CHANGE-HISTORY'),
    OfflineReport: () => mk('reporting', 'v0-superseded', null, 'Reporting v3 shuts off 2027-06-30; v1 AdsApiv1CreateReport replaces it'),
    AmazonMarketingStream: () => /^\/dsp\//.test(o.path) ? mk('marketing-stream', 'v0-out-of-scope', null, 'DSP stream subscriptions') : mk('marketing-stream', 'v0-deprecated', null, 'Stream v1 shuts off 2027-06-30; v2 subscriptions go through v1 StreamSubscriptions'),
    BrandMetrics: () => e('EX-BRAND-ANALYTICS'), BrandBenchmarks: () => e('EX-BRAND-ANALYTICS'), SponsoredBrandsCategoryBenchmark: () => e('EX-BRAND-ANALYTICS'), Stores: () => e('EX-BRAND-ANALYTICS'), MarketingMixModeling: () => e('EX-BRAND-ANALYTICS', 'MMM: DSP / agency leaning'),
    BrandHome: () => e('EX-BRAND-ASSETS'), 'creative-asset-library': () => e('EX-BRAND-ASSETS'),
    Moderation: () => e('EX-MODERATION'), PreModeration: () => e('EX-MODERATION'),
    Diagnostics: () => e('EX-TARGETING-RECS', 'campaign diagnostics'), Insights: () => mk('audiences', 'v0-out-of-scope', null, 'audience overlap insights'),
    Audiences: () => /^\/dsp\//.test(o.path) ? mk('dsp-media-planning', 'v0-out-of-scope', null, 'DSP audience management') : e('EX-TARGETING-DISCOVERY', 'audience list for SD / SB targeting'), Locations: () => e('EX-TARGETING-DISCOVERY'), TargetableEntities: () => e('EX-TARGETING-DISCOVERY'),
    Posts: () => mk('other', 'v0-deprecated', null, 'Brand Posts deprecated (2025)'), BrandAidV2: () => mk('other', 'v0-out-of-scope', null, 'brand aid; not campaign management'),
    SponsoredTV: () => mk('campaigns', 'v0-out-of-scope', null, 'Sponsored TV v0: ST is in v1 (ST contracts) and is not a Seller/Vendor MVP product'),
    BidModifiers: () => mk('bid-adjustments', 'v0-out-of-scope', null, 'DSP bid modifiers (deprecations section)'),
  };
  if (X[id]) return X[id]();
  const toc = (api && api.title) || '';
  if (/Amazon DSP|Media Planning|Deprecations/.test(toc) || /^(dsp-|D16G|Discovery-|DSP)/.test(id)) return mk('dsp-media-planning', 'v0-out-of-scope', null, 'Amazon DSP / media planning (agency + DSP advertisers)');
  if (/Marketing Cloud/.test(toc)) return mk('amc', 'v0-out-of-scope', null, 'Amazon Marketing Cloud: later phase, not MVP campaign management');
  if (/Retail Ad Service|Data provider|Localization|Recommendations & insights/.test(toc) || /^(AdsDataManager|AdLibraryAPI|AmazonAttribution)$/.test(id)) return mk('other', 'v0-out-of-scope', null, 'not Seller/Vendor sponsored-ads management (retail ad service, data provider, localization, attribution, ads data manager, ad library)');
  return null;
}
{
  const apiById = new Map(apis.map((a) => [a.id, a]));
  const domainOps = []; const unclassified = [];
  for (const o of operations) {
    const c = classify(o, apiById.get(o.api));
    if (!c) { unclassified.push(`${o.api} ${o.method} ${o.path}`); continue; }
    domainOps.push({ api: o.api, operationId: o.operationId, method: o.method, path: o.path, generation: o.generation, domain: c.domain, treatment: c.treatment, exception: c.exception, v1Equivalent: c.v1Equivalent, note: c.note });
  }
  if (unclassified.length) throw new Error(`unclassified operations (${unclassified.length}): ${unclassified.slice(0, 10).join('; ')}`);
  const tally = {}; for (const d of domainOps) { const k = `${d.treatment}${d.exception ? ':' + d.exception : ''}`; tally[k] = (tally[k] || 0) + 1; }
  const byDomain = {}; for (const d of domainOps) { (byDomain[d.domain] ||= {}); byDomain[d.domain][d.treatment] = (byDomain[d.domain][d.treatment] || 0) + 1; }
  write('domain-map.json', sortObj({
    decision: 'D53: Ads API v1 default; v0 only as named exceptions', exceptions: EXCEPTIONS,
    treatments: { 'v1-default': 'use', 'v1-out-of-scope': 'v1 operation outside Seller/Vendor sponsored ads (DSP, deals, media planning)', 'v0-exception': 'use v0 until v1 has an equivalent (named exception)', 'v0-superseded': 'v1 equivalent exists; do not call', 'v0-deprecated': 'legacy or shut-off announced; do not call', 'v0-out-of-scope': 'DSP, AMC, media planning, data provider, retail ad service, etc.' },
    tally, byDomain, operations: domainOps.sort((a, b) => a.api.localeCompare(b.api) || a.path.localeCompare(b.path) || a.method.localeCompare(b.method)),
  }));
  console.log('domain-map:', JSON.stringify(sortObj(tally)));
}
console.log(`apis: ${apis.length} catalogued, ${skipped.length} skipped; operations: ${operations.length}`);
