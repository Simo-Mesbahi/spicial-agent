import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const compiled = await build({
  entryPoints: ['lib/atlas/client.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { requestJson, ApiRequestError, mergeMessages, newRequestId } = await import(
  'data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64')
);

test('Request identifiers remain unique without secure-context-only randomUUID', () => {
  const ids = Array.from({ length: 100 }, () => newRequestId());
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[a-f0-9]{32}$/);
});

test('Client keeps HTTP status and server errors for expired sessions', async (t) => {
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ error: 'Session expirée.' }, { status: 401 }),
  );
  await assert.rejects(
    requestJson('/api/snapshot'),
    (error) =>
      error instanceof ApiRequestError &&
      error.status === 401 &&
      error.message === 'Session expirée.',
  );
});

test('Client bounds a stalled response body and cancels the stream', async (t) => {
  let cancelled = false;
  t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(
        new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
      ),
  );
  await assert.rejects(requestJson('/api/snapshot', {}, 25), /trop de temps/);
  assert.equal(cancelled, true);
});

test('Client rejects oversized, malformed and non-object replies', async (t) => {
  const responses = [
    () => new Response('{}', { headers: { 'content-length': String(3 * 1024 * 1024) } }),
    () => new Response('<html>Temporary failure</html>', { status: 502 }),
    () => Response.json(null),
    () => Response.json([]),
  ];
  t.mock.method(globalThis, 'fetch', async () => responses.shift()());
  for (let i = 0; i < 4; i++) await assert.rejects(requestJson('/api/snapshot'), ApiRequestError);
});

test('Network loss never automatically repeats a submitted operation', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    throw new TypeError('network');
  });
  await assert.rejects(requestJson('/api/chat', { method: 'POST' }), /connexion/);
  assert.equal(calls, 1);
});

test('Chat replies render immediately and merge with snapshots without duplicates', () => {
  const old = { id: 'a', created_at: 10, content: 'Question' };
  const reply = { id: 'b', created_at: 11, content: 'Réponse' };
  assert.deepEqual(mergeMessages([old], [old, reply]), [old, reply]);
  assert.deepEqual(mergeMessages([reply, old], [reply]), [old, reply]);
  const history = Array.from({ length: 120 }, (_, i) => ({ id: String(i), created_at: i }));
  assert.equal(mergeMessages(history, []).length, 100);
  assert.equal(mergeMessages(history, [])[0].created_at, 20);
});
