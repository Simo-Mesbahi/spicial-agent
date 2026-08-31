import test from 'node:test';
import assert from 'node:assert/strict';
import { boundedJson, JsonLimitError } from '../lib/atlas/bounded-json.ts';

test('JSON reader preserves multibyte characters split between chunks and accepts the exact limit', async () => {
  const data = new TextEncoder().encode(JSON.stringify({ text: 'échange' }));
  let offset = 0;
  const response = new Response(
    new ReadableStream({
      pull(controller) {
        if (offset === data.length) controller.close();
        else controller.enqueue(data.slice(offset, ++offset));
      },
    }),
  );
  assert.deepEqual(await boundedJson(response, data.length), { text: 'échange' });
});

test('JSON reader cancels oversized chunked streams and does not drain the rest', async () => {
  let cancelled = false;
  let reads = 0;
  const response = new Response(
    new ReadableStream({
      pull(controller) {
        reads++;
        controller.enqueue(new Uint8Array(32));
      },
      cancel() {
        cancelled = true;
      },
    }),
  );
  await assert.rejects(boundedJson(response, 16), JsonLimitError);
  assert.equal(cancelled, true);
  assert.ok(reads <= 2);
});

test('JSON reader cancels a stalled upstream on abort', async () => {
  const controller = new AbortController();
  let cancelled = false;
  const response = new Response(
    new ReadableStream({
      cancel() {
        cancelled = true;
      },
    }),
  );
  const reading = boundedJson(response, 8192, controller.signal);
  controller.abort(new Error('test deadline'));
  await assert.rejects(reading, /test deadline/);
  assert.equal(cancelled, true);
});

test('JSON reader rejects declared oversize, invalid UTF-8, malformed JSON and empty bodies', async () => {
  await assert.rejects(
    boundedJson(new Response('{}', { headers: { 'Content-Length': '9000' } }), 8192),
    JsonLimitError,
  );
  await assert.rejects(boundedJson(new Response(new Uint8Array([255])), 8192));
  await assert.rejects(boundedJson(new Response('{broken'), 8192), SyntaxError);
  await assert.rejects(boundedJson(new Response(null), 8192), SyntaxError);
});
