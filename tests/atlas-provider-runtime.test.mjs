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

for (const array of [false, true])
  test(`Gemini ${array ? 'array' : 'object'} error preserves HTTP and RPC status without raw data`, async (t) => {
    const config = {
      LLM_PROVIDER: 'gemini',
      LLM_BUDGET_MODE: 'free',
      GEMINI_MODEL: 'gemini-2.5-flash',
      GEMINI_API_KEY: 'PRIVATE-GEMINI-KEY',
    };
    const error = {
      error: {
        code: 404,
        status: 'NOT_FOUND',
        message: 'PRIVATE-GEMINI-KEY PRIVATE-CUSTOMER',
        details: [{ token: 'PRIVATE-TOKEN' }],
      },
    };
    mock(t, async (_url, init) => {
      assert.equal(JSON.parse(init.body).reasoning_effort, 'none');
      return Response.json(array ? [error] : error, { status: 404 });
    });
    const trace = providerTrace();
    await assert.rejects(
      providerCompletion(config, completionPayload(config, []), AbortSignal.timeout(1000), trace),
      (e) => e.diagnostic.code === 'NOT_FOUND',
    );
    assert.equal(trace.calls, 1);
    assert.equal(trace.attempts[0].provider, 'gemini');
    assert.equal(trace.attempts[0].model, 'gemini-2.5-flash');
    assert.deepEqual(trace.attempts[0].diagnostic, {
      reason: 'upstream_rejected',
      httpStatus: 404,
      code: 'NOT_FOUND',
      parameter: null,
    });
    assert.doesNotMatch(JSON.stringify(trace), /PRIVATE/);
  });
for (const code of [
  'insufficient_quota',
  'credit_balance_exhausted',
  'organization_spend_limit_exceeded',
  'project_spend_limit_exceeded',
  'organization_usage_limit_exceeded',
  'rate_limit_exceeded',
  'slow_down',
])
  test(`Safe trace retains quota/rate distinction: ${code}`, async (t) => {
    mock(t, async () =>
      Response.json(
        { error: { code, type: 'insufficient_quota', message: 'PRIVATE' } },
        { status: 429 },
      ),
    );
    const trace = providerTrace();
    await assert.rejects(providerCompletion(env, payload, AbortSignal.timeout(1000), trace));
    assert.equal(trace.attempts[0].diagnostic.code, code);
    assert.equal(trace.attempts[0].httpStatus, 429);
    assert.doesNotMatch(JSON.stringify(trace), /PRIVATE|secret-test-key/);
  });
test('Unknown codes, Google status fields and error types never leak to trace', async (t) => {
  mock(t, async () =>
    Response.json(
      [
        {
          error: {
            code: 'PRIVATE1',
            status: 'PRIVATE2',
            type: 'PRIVATE3',
            param: 'PRIVATE4',
            message: 'PRIVATE5',
          },
        },
      ],
      { status: 404 },
    ),
  );
  const trace = providerTrace();
  await assert.rejects(providerCompletion(env, payload, AbortSignal.timeout(1000), trace));
  assert.deepEqual(trace.attempts[0].diagnostic, {
    reason: 'upstream_rejected',
    httpStatus: 404,
    code: null,
    parameter: null,
  });
  assert.doesNotMatch(JSON.stringify(trace), /PRIVATE/);
});
test('A key accidentally placed in the model name is redacted from trace metadata', async (t) => {
  const config = { ...env, OPENAI_MODEL: 'prefix-' + env.OPENAI_API_KEY };
  mock(t, async () => Response.json({}, { status: 404 }));
  const trace = providerTrace();
  await assert.rejects(
    providerCompletion(config, completionPayload(config, []), AbortSignal.timeout(1000), trace),
  );
  assert.doesNotMatch(JSON.stringify(trace), /secret-test-key/);
});
