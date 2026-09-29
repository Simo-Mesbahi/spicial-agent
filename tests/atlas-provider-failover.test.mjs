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
const { providerCompletion, completionPayload, providerTrace, routingMetadata } = await import(
  'data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64')
);
const base = {
  LLM_PROVIDER: 'gemini',
  LLM_ENABLED_PROVIDERS: 'gemini,groq,openai',
  LLM_BUDGET_MODE: 'approved',
  LLM_AUTO_FAILOVER: 'true',
  LLM_FALLBACK_PROVIDER: 'groq',
  GEMINI_MODEL: 'gemini-3.1-flash-lite',
  GEMINI_API_KEY: 'SECRET-GEMINI',
  GROQ_MODEL: 'openai/gpt-oss-120b',
  GROQ_API_KEY: 'SECRET-GROQ',
  OPENAI_MODEL: 'approved-model',
  OPENAI_API_KEY: 'SECRET-OPENAI',
  OPENAI_REASONING_EFFORT: 'none',
};
const hosts = {
  gemini: 'generativelanguage.googleapis.com',
  groq: 'api.groq.com',
  openai: 'api.openai.com',
};
const models = { gemini: base.GEMINI_MODEL, groq: base.GROQ_MODEL, openai: base.OPENAI_MODEL };
const ok = {
  choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '{"ok":true}' } }],
  usage: { prompt_tokens: 5, completion_tokens: 2 },
};
function mock(t, handler) {
  const previous = globalThis.fetch;
  globalThis.fetch = handler;
  t.after(() => {
    globalThis.fetch = previous;
  });
}
function input(env) {
  return {
    ...completionPayload(env, [{ role: 'user', content: 'Return JSON.' }], [], false, 900),
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'test',
        strict: true,
        schema: {
          type: 'object',
          properties: { text: { type: 'string', maxLength: 50 } },
          required: ['text'],
          additionalProperties: false,
        },
      },
    },
  };
}
for (const primary of Object.keys(hosts))
  for (const secondary of Object.keys(hosts)) {
    if (primary === secondary) continue;
    test(`${primary} -> ${secondary}: one failover, destination parameters, request-local routing and usage`, async (t) => {
      const env = { ...base, LLM_PROVIDER: primary, LLM_FALLBACK_PROVIDER: secondary };
      const payload = input(env),
        snapshot = structuredClone(payload),
        requests = [];
      mock(t, async (url, init) => {
        requests.push({ url, body: JSON.parse(init.body), key: init.headers.Authorization });
        return requests.length === 1 ? Response.json({}, { status: 503 }) : Response.json(ok);
      });
      const trace = providerTrace();
      await providerCompletion(env, payload, AbortSignal.timeout(1000), trace);
      await providerCompletion(env, payload, AbortSignal.timeout(1000), trace);
      assert.deepEqual(
        requests.map((r) => new URL(r.url).hostname),
        [hosts[primary], hosts[secondary], hosts[secondary]],
      );
      for (const request of requests.slice(1)) {
        assert.equal(request.body.model, models[secondary]);
        assert.equal(request.body.max_completion_tokens, 900);
        assert.equal(request.body.max_tokens, undefined);
        assert.equal(request.key, `Bearer SECRET-${secondary.toUpperCase()}`);
        assert.equal(
          request.body.reasoning_effort,
          secondary === 'groq' ? 'low' : secondary === 'gemini' ? 'minimal' : 'none',
        );
        assert.equal(request.body.include_reasoning, secondary === 'groq' ? false : undefined);
        assert.equal(
          request.body.response_format.json_schema.schema.properties.text.maxLength,
          secondary === 'gemini' ? undefined : 50,
        );
      }
      assert.deepEqual(payload, snapshot);
      assert.equal(env.LLM_PROVIDER, primary);
      assert.equal(trace.calls, 3);
      assert.equal(trace.inputTokens, 10);
      assert.equal(trace.usageComplete, false); // Failed attempt has unknown usage.
      assert.equal(trace.failoverUsed, true);
      assert.deepEqual(
        routingMetadata(trace, { provider: primary, model: models[primary] }).providerFailover,
        { from: primary, to: secondary, recovered: true },
      );
      assert.doesNotMatch(JSON.stringify(trace), /SECRET|Return JSON/);
      assert.equal(providerTrace().activeProvider, null);
    });
  }

for (const status of [400, 401, 403, 404, 422, 429, 302]) {
  test(`HTTP ${status} never switches provider`, async (t) => {
    let calls = 0;
    mock(t, async () => {
      calls++;
      return Response.json({ error: { code: 'insufficient_quota' } }, { status });
    });
    const trace = providerTrace();
    await assert.rejects(providerCompletion(base, input(base), AbortSignal.timeout(1000), trace));
    assert.equal(calls, 1);
    assert.equal(trace.failoverUsed, false);
  });
}
for (const body of [
  { choices: [] },
  { choices: [{ message: { role: 'assistant', content: null, refusal: 'No' } }] },
]) {
  test('invalid or refused output never switches provider', async (t) => {
    let calls = 0;
    mock(t, async () => {
      calls++;
      return Response.json(body);
    });
    await assert.rejects(
      providerCompletion(base, input(base), AbortSignal.timeout(1000), providerTrace()),
      (e) => e.reason === 'invalid_upstream_response',
    );
    assert.equal(calls, 1);
  });
}
test('two failures stop after the single fallback; no third provider', async (t) => {
  mock(t, async () => Response.json({}, { status: 502 }));
  const trace = providerTrace();
  await assert.rejects(providerCompletion(base, input(base), AbortSignal.timeout(1000), trace));
  assert.deepEqual(
    trace.attempts.map((a) => a.provider),
    ['gemini', 'groq'],
  );
  assert.equal(
    routingMetadata(trace, { provider: 'gemini', model: base.GEMINI_MODEL }).providerFailover
      .recovered,
    false,
  );
});
for (const changes of [
  { LLM_AUTO_FAILOVER: undefined },
  { LLM_AUTO_FAILOVER: 'false' },
  { LLM_FALLBACK_PROVIDER: 'gemini' },
  { LLM_FALLBACK_PROVIDER: 'compatible' },
  { LLM_ENABLED_PROVIDERS: 'gemini' },
  { GROQ_API_KEY: undefined },
  { LLM_FALLBACK_PROVIDER: 'openai', LLM_BUDGET_MODE: 'free' },
  { P1_RELEASE_MODE: 'on' },
  { P1_RELEASE_MODE: 'canary' },
  { P1_RELEASE_MODE: 'shadow' },
]) {
  test(`disabled, revoked, unapproved or P1 route stays on primary: ${JSON.stringify(changes)}`, async (t) => {
    const env = { ...base, ...changes },
      trace = providerTrace();
    mock(t, async () => Response.json({}, { status: 503 }));
    await assert.rejects(providerCompletion(env, input(env), AbortSignal.timeout(1000), trace));
    assert.deepEqual(
      trace.attempts.map((a) => a.provider),
      ['gemini'],
    );
  });
}
test('explicit single-provider probes/qualified calls do not use even a previously selected fallback', async (t) => {
  mock(t, async () => Response.json({}, { status: 503 }));
  const trace = providerTrace();
  trace.activeProvider = 'groq';
  await assert.rejects(
    providerCompletion(base, input(base), AbortSignal.timeout(1000), trace, {
      allowFailover: false,
    }),
  );
  assert.deepEqual(
    trace.attempts.map((a) => a.provider),
    ['gemini'],
  );
});
test('network failure uses the fallback without another retry', async (t) => {
  let calls = 0;
  mock(t, async () => {
    if (++calls === 1) throw new Error('SECRET-network');
    return Response.json(ok);
  });
  const trace = providerTrace();
  await providerCompletion(base, input(base), AbortSignal.timeout(1000), trace);
  assert.equal(calls, 2);
  assert.equal(trace.attempts[0].error, 'network_or_timeout');
  assert.doesNotMatch(JSON.stringify(trace), /SECRET/);
});
test('primary timeout reserves time for the secondary within the original deadline', async (t) => {
  const keepAlive = setTimeout(() => {}, 2000);
  t.after(() => clearTimeout(keepAlive));
  const env = { ...base, LLM_REQUEST_TIMEOUT_MS: '1000' };
  mock(t, async (url, init) => {
    if (new URL(url).hostname === hosts.groq) return Response.json(ok);
    return new Promise((_, reject) =>
      init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }),
    );
  });
  const trace = providerTrace(),
    deadline = AbortSignal.timeout(1000);
  await providerCompletion(env, input(env), deadline, trace);
  assert.equal(deadline.aborted, false);
  assert.equal(trace.calls, 2);
  assert.equal(trace.attempts[0].error, 'network_or_timeout');
});
test('caller cancellation does not start a secondary request', async (t) => {
  const controller = new AbortController();
  let calls = 0;
  mock(t, async () => {
    calls++;
    controller.abort();
    throw controller.signal.reason;
  });
  await assert.rejects(providerCompletion(base, input(base), controller.signal, providerTrace()));
  assert.equal(calls, 1);
});
test('parallel requests keep independent routing state', async (t) => {
  mock(t, async (url) =>
    new URL(url).hostname === hosts.gemini ? Response.json({}, { status: 503 }) : Response.json(ok),
  );
  const traces = Array.from({ length: 8 }, () => providerTrace());
  await Promise.all(
    traces.map((trace) => providerCompletion(base, input(base), AbortSignal.timeout(1000), trace)),
  );
  for (const trace of traces)
    assert.deepEqual(
      trace.attempts.map((a) => a.provider),
      ['gemini', 'groq'],
    );
});
