import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const built = await build({
  entryPoints: ['lib/atlas/provider-runtime.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { providerCompletion, completionPayload, providerTrace } = await import(
  'data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64')
);
const env = {
  LLM_PROVIDER: 'openai',
  LLM_BUDGET_MODE: 'approved',
  OPENAI_MODEL: 'test-configured-model',
  OPENAI_API_KEY: 'secret-test-key',
};
const payload = completionPayload(env, [{ role: 'user', content: 'hello' }]);
const ok = {
  choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'OK' } }],
  usage: { prompt_tokens: 4, completion_tokens: 1 },
};
function mock(t, fn) {
  const previous = globalThis.fetch;
  globalThis.fetch = fn;
  t.after(() => {
    globalThis.fetch = previous;
  });
}
for (const [status, reason] of [
  [400, 'upstream_request_rejected'],
  [401, 'upstream_auth'],
  [403, 'upstream_auth'],
  [422, 'upstream_request_rejected'],
  [429, 'upstream_rate_limited'],
  [500, 'upstream_unavailable'],
  [502, 'upstream_unavailable'],
  [503, 'upstream_unavailable'],
  [302, 'upstream_rejected'],
]) {
  test(`HTTP ${status} retains safe classification and parameter, never provider secrets`, async (t) => {
    mock(t, async () =>
      Response.json(
        {
          error: {
            code: 'unsupported_value',
            param: 'reasoning_effort',
            message: 'secret-test-key private customer',
          },
        },
        { status },
      ),
    );
    const trace = providerTrace();
    await assert.rejects(
      providerCompletion(env, payload, AbortSignal.timeout(1000), trace),
      (error) => {
        assert.equal(error.reason, reason);
        assert.equal(error.diagnostic.httpStatus, status);
        if (status !== 302) assert.equal(error.diagnostic.parameter, 'reasoning_effort');
        assert.doesNotMatch(JSON.stringify(error), /secret-test-key|private customer/);
        return true;
      },
    );
    assert.equal(trace.calls, 1);
    assert.equal(trace.attempts[0].error, reason);
    assert.ok(trace.latencyMs > 0);
  });
}
test('untrusted diagnostic fields are discarded, even when short strings', async (t) => {
  mock(t, async () =>
    Response.json({ error: { code: 'password123', param: 'secret-test-key' } }, { status: 400 }),
  );
  await assert.rejects(
    providerCompletion(env, payload, AbortSignal.timeout(1000), providerTrace()),
    (e) => e.diagnostic.code === null && e.diagnostic.parameter === null,
  );
});
test('server opt-in reasoning; no hidden retry or change of provider', () => {
  assert.equal(payload.reasoning_effort, undefined);
  assert.equal(
    completionPayload({ ...env, OPENAI_REASONING_EFFORT: 'none' }, []).reasoning_effort,
    'none',
  );
  assert.throws(
    () => completionPayload({ ...env, OPENAI_REASONING_EFFORT: 'invalid' }, []),
    /raisonnement/,
  );
});
test('200 records usage and validates final content', async (t) => {
  mock(t, async (_url, init) => {
    assert.equal(init.redirect, 'manual');
    return Response.json(ok);
  });
  const trace = providerTrace();
  await providerCompletion(env, payload, AbortSignal.timeout(1000), trace);
  assert.equal(trace.inputTokens, 4);
  assert.equal(trace.outputTokens, 1);
  assert.equal(trace.usageComplete, true);
});
for (const [name, response] of [
  ['invalid JSON', () => new Response('{broken')],
  [
    'empty answer',
    () => Response.json({ ...ok, choices: [{ message: { role: 'assistant', content: ' ' } }] }),
  ],
  ['invalid schema', () => Response.json({ choices: [] })],
  [
    'partial answer',
    () =>
      Response.json({
        ...ok,
        choices: [{ finish_reason: 'length', message: { role: 'assistant', content: 'part' } }],
      }),
  ],
  [
    'missing tool call',
    () =>
      Response.json({
        ...ok,
        choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: 'OK' } }],
      }),
  ],
  ['oversize body', () => new Response('x'.repeat(65537))],
])
  test(name + ' fails closed', async (t) => {
    mock(t, async () => response());
    await assert.rejects(
      providerCompletion(env, payload, AbortSignal.timeout(1000), providerTrace()),
      (e) => e.reason === 'invalid_upstream_response',
    );
  });
test('deadline covers body read, cancels stream and retains network classification', async (t) => {
  let cancelled = false;
  mock(
    t,
    async () =>
      new Response(
        new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
      ),
  );
  const trace = providerTrace();
  await assert.rejects(
    providerCompletion(env, payload, AbortSignal.timeout(20), trace),
    (e) => e.reason === 'network_or_timeout',
  );
  assert.equal(cancelled, true);
});
test('usage is retained when a later provider round fails', async (t) => {
  let count = 0;
  mock(t, async () =>
    ++count === 1 ? Response.json(ok) : Response.json({ error: {} }, { status: 503 }),
  );
  const trace = providerTrace();
  await providerCompletion(env, payload, AbortSignal.timeout(1000), trace);
  await assert.rejects(providerCompletion(env, payload, AbortSignal.timeout(1000), trace));
  assert.equal(trace.inputTokens, 4);
  assert.equal(trace.outputTokens, 1);
  assert.equal(trace.calls, 2);
  assert.equal(trace.usageComplete, false);
});
