import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { build } from 'esbuild';
import {
  mergeConfiguration,
  saveConfiguration,
  validateBackend,
  provisionAdmin,
  grantAdmin,
} from '../scripts/backend.mjs';

const config = {
  SUPABASE_URL: 'https://project-test.supabase.co',
  SUPABASE_ORGANIZATION_ID: '00000000-0000-4000-8000-000000000001',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test-value-long-enough',
  SUPABASE_SECRET_KEY: 'sb_secret_test-value-long-enough',
};
test('Granting an existing administrator neither recreates the user nor changes their password', async () => {
  const calls = [];
  await grantAdmin(config, { email: 'owner@example.invalid', displayName: 'Responsable' }, async (url, init) => {
    calls.push({ url, init });
    return Response.json({ ok: true });
  });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.endsWith('/rest/v1/rpc/bootstrap_admin'));
  assert.equal(calls[0].init.headers.apikey, config.SUPABASE_SECRET_KEY);
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    p_organization_id: config.SUPABASE_ORGANIZATION_ID,
    p_email: 'owner@example.invalid', p_role: 'super_admin', p_display_name: 'Responsable',
  });
  await assert.rejects(() => grantAdmin(config, { email: 'invalid', displayName: 'Name' }), /email invalide/);
});
test('Backend configuration preserves unrelated values and replaces duplicate definitions', () => {
  const next = mergeConfiguration(
    '# local\nOTHER=value\nLLM_PROVIDER=demo\nexport LLM_PROVIDER=ollama\n',
    { LLM_PROVIDER: 'gemini', GEMINI_API_KEY: 'example-key' },
  );
  assert.deepEqual(parseEnv(next), {
    OTHER: 'value',
    LLM_PROVIDER: 'gemini',
    GEMINI_API_KEY: 'example-key',
  });
  assert.equal(next.match(/LLM_PROVIDER=/g).length, 1);
  assert.throws(() => mergeConfiguration('', { GEMINI_API_KEY: 'injected\nOTHER=1' }));
});
test('Secrets are written privately and symlink targets are refused', async () => {
  const dir = await mkdtemp(resolve(tmpdir(), 'savsc-config-'));
  try {
    await saveConfiguration(config, dir);
    const file = resolve(dir, '.dev.vars');
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.deepEqual(parseEnv(await readFile(file, 'utf8')), config);
    await rm(file);
    await symlink(resolve(dir, 'elsewhere'), file);
    await assert.rejects(() => saveConfiguration(config, dir), /fichier régulier/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('Backend setup refuses swapped keys and unexpected key destinations', () => {
  assert.equal(validateBackend(config), config);
  assert.throws(() =>
    validateBackend({ ...config, SUPABASE_SECRET_KEY: config.SUPABASE_PUBLISHABLE_KEY }),
  );
  assert.throws(() => validateBackend({ ...config, SUPABASE_URL: 'https://attacker.example' }));
});
test('Admin provisioning is server-only and reports a partial role failure accurately', async () => {
  const calls = [];
  await assert.rejects(
    () =>
      provisionAdmin(
        config,
        {
          email: 'admin@example.invalid',
          password: 'a-secret-for-tests-only',
          displayName: 'Test',
        },
        async (url, init) => {
          calls.push({ url, init });
          assert.equal(init.headers.apikey, config.SUPABASE_SECRET_KEY);
          if (url.endsWith('/admin/users'))
            return Response.json({ id: '00000000-0000-4000-8000-000000000101' });
          return Response.json({ message: 'sensitive upstream detail' }, { status: 500 });
        },
      ),
    /compte Auth est créé/,
  );
  assert.equal(calls.length, 2);
  assert.equal(JSON.parse(calls[0].init.body).email_confirm, true);
  assert.doesNotMatch(calls[1].init.body, /a-secret-for-tests-only/);
});

async function compile(path) {
  const result = await build({
    entryPoints: [path],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
  });
  return import(
    'data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64')
  );
}
test('Client and Supabase deadlines cover a stalled body after successful headers', async () => {
  const { productionRequest } = await compile('lib/atlas/production-client.ts');
  const { supabaseRequest } = await compile('lib/atlas/supabase.ts');
  const previous = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{'));
        },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  try {
    await assert.rejects(
      () => productionRequest('/config', {}, 20),
      (e) => e.code === 'timeout',
    );
    await assert.rejects(
      () =>
        supabaseRequest(config, '/rest/v1/rpc/test', {
          mode: { kind: 'privileged' },
          timeoutMs: 20,
        }),
      (e) => e.code === 'upstream_timeout',
    );
  } finally {
    globalThis.fetch = previous;
  }
});
