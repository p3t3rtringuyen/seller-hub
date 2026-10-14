#!/usr/bin/env node
// Reports which variables named in .env.example are set in .env.local — names only, never
// values — so agents can check resources without reading secrets.
// Usage: node scripts/check-env.mjs [PREFIX ...]   (exit code 1 if any checked name is missing)
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const examplePath = join(root, '.env.example');
const localPath = join(root, '.env.local');

const parse = (file) =>
  new Map(
    readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const at = line.indexOf('=');
        const value = line.slice(at + 1).replace(/\s+#.*$/, '').trim();
        return [line.slice(0, at).trim(), value];
      }),
  );

if (!existsSync(examplePath)) {
  console.error('.env.example not found');
  process.exit(2);
}

const prefixes = process.argv.slice(2);
const names = [...parse(examplePath).keys()].filter(
  (name) => prefixes.length === 0 || prefixes.some((prefix) => name.startsWith(prefix)),
);
const local = existsSync(localPath) ? parse(localPath) : new Map();

let missing = 0;
for (const name of names) {
  const set = Boolean(local.get(name));
  if (!set) missing += 1;
  console.log(`${set ? 'SET    ' : 'MISSING'} ${name}`);
}
if (!existsSync(localPath)) console.log('(.env.local does not exist yet)');
process.exit(missing > 0 ? 1 : 0);
