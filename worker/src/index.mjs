// Cloudflare Worker: twice a day it reads the anonymous Sorare data the optimizer needs and stores it in R2
// as one JSON file, under the same name the CLI uses in data/. No key, no login, no public address.
// A failed run leaves a note under errors/, so a missing night can be explained.
import { collect } from '../../src/collect.mjs';

const stamp = iso => iso.replace(/[:.]/g, '-');

export async function run(env, read = collect) {
  const started = new Date().toISOString();
  try {
    // A run makes about 55 requests on a big night. That needs the paid Workers plan: the free one allows 50.
    const snapshot = await read({ manager: env.MANAGER });
    await env.DATA.put(`${stamp(snapshot.fetchedAt)}.json`, JSON.stringify(snapshot), { httpMetadata: { contentType: 'application/json' } });
  } catch (e) {
    await env.DATA.put(`errors/${stamp(started)}.txt`, String(e?.stack ?? e));
  }
  // The local sync reads this list: it can fetch single files but cannot list the bucket.
  const keys = [];
  let cursor;
  do {
    const page = await env.DATA.list({ cursor });
    keys.push(...page.objects.map(o => o.key).filter(k => k !== 'index.json'));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  await env.DATA.put('index.json', JSON.stringify(keys.sort()), { httpMetadata: { contentType: 'application/json' } });
  return keys;
}

export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(run(env));
  },
};
