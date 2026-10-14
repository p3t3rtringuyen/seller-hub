#!/usr/bin/env node
// Mirrors the Amazon Ads API documentation into refs/amazon-ads: every OpenAPI spec and every
// markdown page listed in the docs site's own tables of contents (advertising.amazon.com/API/docs).
// Read-only data for the catalogue builders and for people; never committed (refs/ is gitignored).
// Usage: node scripts/fetch-ads-refs.mjs [--specs-only | --docs-only]
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DOCS_CDN = 'https://d3a0d0y2hgofx6.cloudfront.net/en-us/';
const SPEC_CDN = 'https://d1y2lf8k3vrkfu.cloudfront.net/openapi/en-us/';
// Relative `openapi` refs in the TOCs resolve here (observed in the docs site's own requests).
const RELATIVE_SPEC_BASE = 'https://d3a0d0y2hgofx6.cloudfront.net/openapi/en-us/';
// The three CloudFront hosts Amazon's own TOCs point to; nothing else is fetched.
const ALLOWED_HOSTS = new Set([
  new URL(DOCS_CDN).host,
  new URL(SPEC_CDN).host,
  'dtrnk0o2zy01c.cloudfront.net',
]);
const TOCS = {
  'toc2.json': `${DOCS_CDN}toc2.json`,
  'reference_prod.json': `${SPEC_CDN}toc/per_entity_toc/reference_prod.json`,
  'reference_prod_beta.json': `${SPEC_CDN}toc/per_entity_toc_beta/reference_prod.json`,
};
const CONCURRENCY = 6;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'refs', 'amazon-ads');
const mode = process.argv[2];

const fetchBytes = async (url, attempts = 3) => {
  if (!ALLOWED_HOSTS.has(new URL(url).host)) throw new Error(`host not allowed: ${url}`);
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (attempt >= attempts) throw new Error(`${url}: ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
};

const save = async (relativePath, bytes) => {
  const target = join(out, relativePath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
};

// Walks a TOC tree, yielding every node that names a markdown page or an OpenAPI spec, with the
// trail of section names above it.
function* entries(node, trail = []) {
  if (Array.isArray(node)) {
    for (const child of node) yield* entries(child, trail);
    return;
  }
  if (!node || typeof node !== 'object') return;
  const here = node.name ? [...trail, node.name] : trail;
  if (typeof node.markdown === 'string') yield { kind: 'doc', ref: node.markdown, trail: here };
  if (typeof node.openapi === 'string') yield { kind: 'spec', ref: node.openapi, trail: here };
  for (const [key, value] of Object.entries(node)) {
    if (key !== 'redirects' && typeof value === 'object') yield* entries(value, here);
  }
}

const pool = async (items, worker) => {
  const results = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await worker(items[index]);
      }
    }),
  );
  return results;
};

const tocs = {};
for (const [name, url] of Object.entries(TOCS)) {
  const bytes = await fetchBytes(url);
  await save(join('toc', name), bytes);
  tocs[name] = JSON.parse(bytes.toString('utf8'));
}

// One record per distinct file; the first TOC trail that names it becomes its title.
const files = new Map();
for (const toc of Object.values(tocs)) {
  for (const entry of entries(toc)) {
    const url =
      entry.kind === 'doc'
        ? new URL(entry.ref.replace(/^\/+/, ''), DOCS_CDN).href
        : new URL(entry.ref, RELATIVE_SPEC_BASE).href;
    if (files.has(url)) continue;
    const path =
      entry.kind === 'doc'
        ? join('docs', entry.ref.replace(/^\/+/, ''))
        : join('specs', new URL(url).pathname.replace(/^.*?\/openapi\/en-us\//, ''));
    files.set(url, { kind: entry.kind, title: entry.trail.join(' › '), url, path });
  }
}

const wanted = [...files.values()].filter(
  (file) =>
    !mode ||
    (mode === '--specs-only' && file.kind === 'spec') ||
    (mode === '--docs-only' && file.kind === 'doc'),
);

let done = 0;
const results = await pool(wanted, async (file) => {
  try {
    const bytes = await fetchBytes(file.url);
    await save(file.path, bytes);
    done += 1;
    if (done % 50 === 0) console.log(`${done}/${wanted.length}`);
    return {
      ...file,
      path: file.path.replaceAll('\\', '/'),
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  } catch (error) {
    return { ...file, path: file.path.replaceAll('\\', '/'), error: error.message };
  }
});

results.sort((a, b) => a.path.localeCompare(b.path));
await save('manifest.json', `${JSON.stringify(results, null, 2)}\n`);

const failed = results.filter((file) => file.error);
const total = (kind) => results.filter((file) => file.kind === kind && !file.error);
const megabytes = (list) => (list.reduce((sum, file) => sum + file.bytes, 0) / 1e6).toFixed(1);
const lines = [
  '# Amazon Ads API docs mirror',
  '',
  `Fetched ${new Date().toISOString().slice(0, 10)} by \`scripts/fetch-ads-refs.mjs\` from the CDNs`,
  'behind advertising.amazon.com/API/docs. Source of each file: `manifest.json` (url, sha256).',
  '',
  `- Specs: ${total('spec').length} files, ${megabytes(total('spec'))} MB → \`specs/\``,
  `- Docs pages: ${total('doc').length} files, ${megabytes(total('doc'))} MB → \`docs/\``,
  `- Failed: ${failed.length}`,
  '',
  '## Specs',
  '',
  ...total('spec').map((file) => `- \`${file.path}\` — ${file.title}`),
  '',
  '## Failed',
  '',
  ...failed.map((file) => `- ${file.url} — ${file.error}`),
  '',
];
await save('INDEX.md', lines.join('\n'));

console.log(
  `specs ${total('spec').length} (${megabytes(total('spec'))} MB), docs ${total('doc').length} ` +
    `(${megabytes(total('doc'))} MB), failed ${failed.length}`,
);
process.exit(failed.length > 0 ? 1 : 0);
