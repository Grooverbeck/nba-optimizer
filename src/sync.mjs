#!/usr/bin/env node
// Usage: node src/sync.mjs
// Copies the raw data the Cloudflare Worker has stored in R2 into data/ (only files that are missing here).
// Needs `npm install` in worker/ and a Wrangler login on this machine.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUCKET = 'nba-optimizer-data';
const wrangler = (...args) => execFileSync(process.execPath, [join(ROOT, 'worker', 'node_modules', 'wrangler', 'bin', 'wrangler.js'), ...args],
  { cwd: join(ROOT, 'worker'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });

// Keys are file names the Worker wrote; anything else in the list is ignored.
export const wanted = (keys, have) => keys.filter(k => /^\d{4}-\d\d-\d\dT[\d-]+Z\.json$/.test(k) && !have(k));
export const failed = keys => keys.filter(k => /^errors\/[\w-]+\.txt$/.test(k));

function main() {
  const keys = JSON.parse(wrangler('r2', 'object', 'get', `${BUCKET}/index.json`, '--remote', '--pipe'));
  mkdirSync(join(ROOT, 'data'), { recursive: true });
  const missing = wanted(keys, k => existsSync(join(ROOT, 'data', k)));
  for (const key of missing) {
    wrangler('r2', 'object', 'get', `${BUCKET}/${key}`, '--remote', '--file', join(ROOT, 'data', key));
    console.log(`geholt: ${key}`);
  }
  console.log(`${keys.length - failed(keys).length} Dateien in der Cloud, ${missing.length} neu geholt.`);
  if (failed(keys).length) console.log(`Fehlgeschlagene Läufe (${failed(keys).length}): ${failed(keys).map(k => k.slice(7, -4)).join(', ')}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
