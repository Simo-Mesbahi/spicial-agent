import test from 'node:test';
import assert from 'node:assert/strict';
import {
  syntheticModelHealth,
  clearSyntheticHealthCacheForTests,
} from '../lib/atlas/llm-health.ts';

const openaiEnv = {
  LLM_PROVIDER: 'openai',
  LLM_BUDGET_MODE: 'approved',
  OPENAI_MODEL: 'gpt-5.6-luna',
  OPENAI_API_KEY: 'test-secret-key',
};

test('synthetic LLM health performs one bounded real-shaped probe and caches it', async () => {
  clearSyntheticHealthCacheForTests();
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls++;
    assert.equal(url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(init.redirect, 'manual');
    assert.equal(init.headers.Authorization, 'Bearer test-secret-key');
    const body = JSON.parse(init.body);
    assert.equal(body.model, 'gpt-5.6-luna');
    assert.equal(body.reasoning_effort, 'none');
    assert.equal(body.max_completion_tokens, 8);
    assert.equal(body.store, false);
    assert.equal(body.tools, undefined);
    return Response.json(
      {
        choices: [{ message: { content: 'OK' } }],
        usage: { prompt_tokens: 7, completion_tokens: 1 },
      },
      { headers: { 'x-request-id': 'req_health_123' } },
    );
  };
  try {
    const first = await syntheticModelHealth(openaiEnv, 1_000_000);
    assert.equal(first.status, 'healthy');
    assert.equal(first.cached, false);
    assert.equal(first.provider, 'openai');
    assert.equal(first.model, 'gpt-5.6-luna');
    assert.equal(first.inputTokens, 7);
    assert.equal(first.outputTokens, 1);
    assert.equal(first.upstreamStatus, 200);
    assert.equal(first.upstreamRequestId, 'req_health_123');

    const second = await syntheticModelHealth(openaiEnv, 1_000_100);
    assert.equal(second.status, 'healthy');
    assert.equal(second.cached, true);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
    clearSyntheticHealthCacheForTests();
  }
});

test('synthetic LLM health normalizes provider rejection without exposing raw error text', async () => {
  clearSyntheticHealthCacheForTests();
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        error: {
          message: 'SECRET INTERNAL PROVIDER DETAIL',
          type: 'invalid_request_error',
          code: 'unsupported_parameter',
        },
      }),
      {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'x-request-id': 'req_bad_payload_456',
        },
      },
    );
  try {
    const result = await syntheticModelHealth(openaiEnv, 2_000_000);
    assert.equal(result.status, 'degraded');
    assert.equal(result.failureReason, 'upstream_request_rejected');
    assert.equal(result.upstreamStatus, 400);
    assert.equal(result.upstreamCode, 'unsupported_parameter');
    assert.equal(result.upstreamRequestId, 'req_bad_payload_456');
    assert.doesNotMatch(JSON.stringify(result), /SECRET INTERNAL PROVIDER DETAIL/);
    assert.doesNotMatch(JSON.stringify(result), /test-secret-key/);
  } finally {
    globalThis.fetch = original;
    clearSyntheticHealthCacheForTests();
  }
});

test('synthetic LLM health distinguishes network failure and malformed successful output', async () => {
  const original = globalThis.fetch;
  try {
    clearSyntheticHealthCacheForTests();
    globalThis.fetch = async () => {
      throw new Error('ECONNRESET SECRET');
    };
    const network = await syntheticModelHealth(openaiEnv, 3_000_000);
    assert.equal(network.status, 'degraded');
    assert.equal(network.failureReason, 'network_or_timeout');
    assert.equal(network.upstreamStatus, null);

    clearSyntheticHealthCacheForTests();
    globalThis.fetch = async () =>
      Response.json(
        { choices: [{ message: { content: null } }] },
        { headers: { 'x-request-id': 'req_malformed_789' } },
      );
    const malformed = await syntheticModelHealth(openaiEnv, 4_000_000);
    assert.equal(malformed.status, 'degraded');
    assert.equal(malformed.failureReason, 'invalid_upstream_response');
    assert.equal(malformed.upstreamStatus, 200);
    assert.equal(malformed.upstreamRequestId, 'req_malformed_789');
  } finally {
    globalThis.fetch = original;
    clearSyntheticHealthCacheForTests();
  }
});

test('demo synthetic health is disabled and never calls a provider', async () => {
  clearSyntheticHealthCacheForTests();
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new Error('unexpected');
  };
  try {
    const result = await syntheticModelHealth({ LLM_PROVIDER: 'demo' }, 5_000_000);
    assert.equal(result.status, 'disabled');
    assert.equal(result.provider, 'demo');
    assert.equal(result.failureReason, null);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = original;
    clearSyntheticHealthCacheForTests();
  }
});
