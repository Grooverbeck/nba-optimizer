// Anonymous, read-only Sorare GraphQL access. No API key, no login, no mutations.
const ENDPOINT = 'https://api.sorare.com/graphql';
const PAUSE_MS = 400;

let lastRequest = 0;
export async function query(name, text, variables = {}) {
  const wait = lastRequest + PAUSE_MS - Date.now();
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastRequest = Date.now();
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ operationName: name, query: text, variables }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body || body.errors) {
    const msg = body?.errors?.map(e => e.message).join('; ') || `HTTP ${res.status}`;
    throw new Error(`Sorare ${name}: ${msg}`);
  }
  return body.data;
}
