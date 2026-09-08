import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';

const compiled = await build({
  entryPoints: ['lib/atlas/production-api.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { handleProductionApi } = await import(
  'data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64')
);

const ORGANIZATION_ID = '00000000-0000-4000-8000-000000000001';

function database() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`create table rate_buckets (
    id text primary key not null,
    count integer not null,
    expires_at integer not null
  )`);
  return {
    sql,
    prepare(query) {
      let values = [];
      return {
        bind(...bound) {
          values = bound;
          return this;
        },
        async first() {
          return sql.prepare(query).get(...values) ?? null;
        },
      };
    },
  };
}

function environment(db) {
  return {
    DB: db,
    SUPABASE_URL: 'https://exbhajwuniufgedbkipg.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'test-publishable-key-for-contracts',
    SUPABASE_SECRET_KEY: 'test-server-key-for-contracts',
    SUPABASE_ORGANIZATION_ID: ORGANIZATION_ID,
  };
}

function request(path, body) {
  return new Request(`https://atlas.test/api/production${path}`, {
    method: 'POST',
    headers: {
      Origin: 'https://atlas.test',
      'CF-Connecting-IP': '203.0.113.42',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

test('neutral Supabase credential denial is returned as a customer-safe 403, not a 502', async () => {
  const db = database();
  const env = environment(db);
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    assert.match(url, /\/rest\/v1\/rpc\/customer_open_case_session$/);
    return Response.json({ error: 'invalid_case_credentials' });
  };

  try {
    const response = await handleProductionApi(
      request('/cases/verify', { reference: 'SAV-2026-9999', code: '111111' }),
      env,
    );
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {
      error: 'Référence ou code incorrect.',
      code: 'invalid_case_credentials',
    });
  } finally {
    globalThis.fetch = previousFetch;
    db.sql.close();
  }
});

test('recovered production migrations preserve pre-MFA identity, server sessions and retention', () => {
  const adminMigration = readFileSync(
    'supabase/migrations/20260908103327_admin_operations_and_session_security.sql',
    'utf8',
  );
  const lifecycleMigration = readFileSync(
    'supabase/migrations/20260908104855_client_session_lifecycle_and_retention.sql',
    'utf8',
  );

  assert.match(adminMigration, /create or replace function app_private\.admin_identity\(\)/);
  assert.match(adminMigration, /join auth\.sessions s/);
  assert.match(adminMigration, /public\.admin_me\(\)[\s\S]*security invoker/);
  assert.match(adminMigration, /app_private\.admin_add_note/);
  assert.match(adminMigration, /revoke_case_sessions_on_code_change/);

  assert.match(lifecycleMigration, /return jsonb_build_object\('error','invalid_case_credentials'\)/);
  assert.match(lifecycleMigration, /not exists\(select 1 from public\.organizations where id=v_session\.organization_id and active\)/);
  assert.match(lifecycleMigration, /create or replace function public\.purge_technical_history\(\)/);
  assert.match(lifecycleMigration, /grant execute on function public\.purge_technical_history\(\) to service_role/);
});
