import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../worker/src/index.mjs';
import { failed, wanted } from '../src/sync.mjs';

// A bucket that behaves like the R2 binding as far as the Worker uses it; lists come in pages of two.
function bucket(initial = {}) {
  const files = new Map(Object.entries(initial));
  return { files,
    async put(key, value) { files.set(key, value); },
    async list({ cursor } = {}) {
      const keys = [...files.keys()].sort(), from = cursor ? Number(cursor) : 0;
      return { objects: keys.slice(from, from + 2).map(key => ({ key })), truncated: from + 2 < keys.length, cursor: String(from + 2) };
    } };
}

test('the Worker stores the raw data under the CLI file name and lists all files', async () => {
  const DATA = bucket({ '2026-11-24T21-30-05-000Z.json': '{}', '2026-11-25T09-30-04-000Z.json': '{}', 'index.json': '[]' });
  const snapshot = { fetchedAt: '2026-11-25T21:30:07.123Z', manager: 'luckyphil', cards: [] };
  const keys = await run({ DATA, MANAGER: 'luckyphil' }, async ({ manager }) => ({ ...snapshot, manager }));
  assert.deepEqual(JSON.parse(DATA.files.get('2026-11-25T21-30-07-123Z.json')), snapshot);
  assert.deepEqual(keys, ['2026-11-24T21-30-05-000Z.json', '2026-11-25T09-30-04-000Z.json', '2026-11-25T21-30-07-123Z.json']);
  assert.deepEqual(JSON.parse(DATA.files.get('index.json')), keys);
});

test('a failed run leaves a note and the list still gets written', async () => {
  const DATA = bucket();
  const keys = await run({ DATA, MANAGER: 'luckyphil' }, async () => { throw new Error('Sorare NbaBoard: HTTP 429'); });
  assert.equal(keys.length, 1);
  assert.match(keys[0], /^errors\/2\d{3}-\d\d-\d\dT[\d-]+Z\.txt$/);
  assert.match(DATA.files.get(keys[0]), /HTTP 429/);
  assert.deepEqual(failed(keys), keys);
});

test('the sync fetches only raw data files that are missing locally', () => {
  const keys = ['2026-11-25T09-30-04-000Z.json', '2026-11-25T21-30-07-123Z.json', 'errors/2026-11-26T09-30-00-000Z.txt', '../evil.json', 'notes.txt'];
  assert.deepEqual(wanted(keys, k => k.startsWith('2026-11-25T09')), ['2026-11-25T21-30-07-123Z.json']);
});
