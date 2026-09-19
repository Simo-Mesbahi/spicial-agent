import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { database } from './helpers/atlas-fixture.mjs';
const compiled = await build({
  stdin: {
    contents:
      "export { syntheticProviderHealth } from './lib/atlas/provider-health'; export { handleAdminOperationsApi } from './lib/atlas/admin-operations-api'; export {handleApi} from './lib/atlas/api';",
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { syntheticProviderHealth, handleAdminOperationsApi, handleApi } = await import(
  'data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64')
);
const org = '00000000-0000-4000-8000-000000000001';
const identity = {
  user_id: '00000000-0000-4000-8000-000000000900',
  email: 'test@example.test',
  aal: 'aal2',
  memberships: [
    { organization_id: org, organization_name: 'Test', role: 'super_admin', display_name: null },
  ],
};
function setup(t) {
  const DB = database();
  t.after(() => DB.sql.close());
  const previous = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = previous;
  });
  return {
    DB,
    LLM_PROVIDER: 'openai',
    LLM_BUDGET_MODE: 'approved',
    OPENAI_MODEL: 'configured-model',
    OPENAI_API_KEY: 'secret-test-key',
    SUPABASE_ORGANIZATION_ID: org,
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'pub',
    SUPABASE_SECRET_KEY: 'secret',
    APP_ENVIRONMENT: 'LOCAL',
  };
}
const success = () =>
  Response.json({
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'OK' } }],
    usage: { prompt_tokens: 6, completion_tokens: 1 },
  });
const request = (options = {}) =>
  new Request(
    'https://atlas.test/api/production/admin/operations/provider-health?organizationId=' + org,
    {
      method: 'POST',
      headers: {
        cookie: 'savsc_admin_access=test-access-token',
        origin: 'https://atlas.test',
        'content-type': 'application/json',
        ...options.headers,
      },
      body: '{}',
      ...options,
    },
  );
test('probe authenticates AAL2 and role, rejects cross-site/missing origin and non-POST', async (t) => {
  const env = setup(t);
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json(identity);
  };
  assert.equal((await handleAdminOperationsApi(request({ headers: {} }), env)).status, 401);
  for (const changed of [
    { ...identity, aal: 'aal1' },
    { ...identity, memberships: [{ ...identity.memberships[0], role: 'analyst' }] },
  ]) {
    globalThis.fetch = async () => Response.json(changed);
    assert.equal((await handleAdminOperationsApi(request(), env)).status, 403);
  }
  globalThis.fetch = async () => Response.json(identity);
  assert.equal(
    (
      await handleAdminOperationsApi(
        request({
          headers: { cookie: 'savsc_admin_access=test-access-token', origin: 'https://evil.test' },
        }),
        env,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await handleAdminOperationsApi(
        request({ headers: { cookie: 'savsc_admin_access=test-access-token' } }),
        env,
      )
    ).status,
    403,
  );
  assert.equal(
    (await handleAdminOperationsApi(request({ method: 'GET', body: undefined }), env)).status,
    405,
  );
  assert.equal(calls, 0);
});
test('probe runs shared transport once, persists cache and retains positive tokens', async (t) => {
  const env = setup(t);
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    if (url.includes('admin_me')) return Response.json(identity);
    calls++;
    assert.equal(JSON.parse(init.body).max_completion_tokens, 128);
    return success();
  };
  const first = await (await handleAdminOperationsApi(request(), env)).json();
  assert.equal(first.status, 'healthy');
  assert.equal(first.cached, false);
  assert.ok(first.trace.inputTokens > 0);
  const second = await (await handleAdminOperationsApi(request(), env)).json();
  assert.equal(second.cached, true);
  assert.equal(calls, 1);
  assert.doesNotMatch(JSON.stringify(first), /secret-test-key/);
});
test('concurrent probes cannot multiply spend; shared quota survives key rotation', async (t) => {
  const env = setup(t);
  let calls = 0;
  let release;
  const wait = new Promise((r) => {
    release = r;
  });
  globalThis.fetch = async () => {
    calls++;
    await wait;
    return success();
  };
  const one = syntheticProviderHealth(env, 'scope');
  // Yield to the first async DB claim without blocking the provider response.
  await new Promise((r) => setTimeout(r, 10));
  const two = await syntheticProviderHealth(env, 'scope');
  assert.equal(two.reason, 'probe_in_progress');
  release();
  assert.equal((await one).status, 'healthy');
  const rotated = await syntheticProviderHealth({ ...env, OPENAI_API_KEY: 'rotated-key' }, 'scope');
  assert.equal(rotated.reason, 'probe_rate_limited');
  assert.equal(calls, 1);
});
test('failures are cached as degraded, and demo or zero quota never call provider', async (t) => {
  const env = setup(t);
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ error: { code: 'invalid_api_key' } }, { status: 401 });
  };
  const failed = await syntheticProviderHealth(env, 'scope');
  assert.equal(failed.status, 'degraded');
  assert.equal(failed.reason, 'upstream_auth');
  assert.equal((await syntheticProviderHealth(env, 'scope')).cached, true);
  assert.equal(calls, 1);
  assert.equal(
    (await syntheticProviderHealth({ ...env, LLM_PROVIDER: 'demo' }, 'demo')).reason,
    'provider_disabled',
  );
  assert.equal(
    (await syntheticProviderHealth({ ...env, LLM_DAILY_LIMIT: '0' }, 'zero')).reason,
    'probe_rate_limited',
  );
  assert.equal(calls, 1);
});
test('liveness/readiness never run paid synthetic requests', async (t) => {
  const env = setup(t);
  globalThis.fetch = async () => {
    throw new Error('must not call');
  };
  assert.equal((await handleApi(new Request('https://atlas.test/api/live'), {})).status, 200);
  const ready = await (await handleApi(new Request('https://atlas.test/api/ready'), env)).json();
  assert.equal(ready.synthetic, false);
  assert.equal(ready.status, 'ready');
});
