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
        async all() {
          return { results: sql.prepare(query).all(...values) };
        },
        async run() {
          const result = sql.prepare(query).run(...values);
          return { meta: { changes: Number(result.changes) } };
        },
      };
    },
  };
}

function environment(db = database()) {
  return {
    DB: db,
    SUPABASE_URL: 'https://exbhajwuniufgedbkipg.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'test-publishable-key-for-contracts',
    SUPABASE_SECRET_KEY: 'test-server-key-for-contracts',
    SUPABASE_ORGANIZATION_ID: ORGANIZATION_ID,
  };
}

function productionRequest(path, { method = 'GET', body, cookie, origin = 'https://atlas.test' } = {}) {
  const headers = new Headers({ Origin: origin, 'CF-Connecting-IP': '203.0.113.10' });
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  if (cookie) headers.set('Cookie', cookie);
  return new Request(`https://atlas.test/api/production${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function caseSession() {
  return {
    access_token: 'a'.repeat(64),
    expires_at: new Date(Date.now() + 20 * 60_000).toISOString(),
    case: {
      id: '10000000-0000-4000-8000-000000000001',
      reference: 'SAV-2026-1042',
      kind: 'repair',
      title: 'Réparation téléviseur',
      description: 'La pièce est en cours d’acheminement.',
      status: 'waiting_part',
      warranty_status: 'covered',
      warranty_label: 'Garantie constructeur',
      quote_cents: null,
      refund_cents: null,
      currency: 'EUR',
      delivery_mode: 'Retrait magasin',
      estimated_at: new Date(Date.now() + 86_400_000).toISOString(),
      version: 2,
      updated_at: new Date().toISOString(),
      product: { name: 'Téléviseur', category: 'Image', sku: 'TV-01' },
      store: { name: 'Magasin Centre', city: 'Paris' },
      events: [
        {
          id: '20000000-0000-4000-8000-000000000001',
          status: 'waiting_part',
          label: 'Pièce commandée',
          details: { detail: 'Arrivée estimée demain.' },
          occurred_at: new Date().toISOString(),
        },
      ],
    },
  };
}

test('Supabase migration enables RLS on every application table and keeps customer RPCs server-only', () => {
  const migration = readFileSync(
    'supabase/migrations/202609030001_production_foundation.sql',
    'utf8',
  );
  const tables = [...migration.matchAll(/create table if not exists public\.([a-z_]+)/g)].map(
    (match) => match[1],
  );
  assert.equal(tables.length, 17);
  for (const table of tables)
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security;`));

  for (const fn of [
    'customer_open_case_session\\(uuid, text, text\\)',
    'customer_case_snapshot\\(text\\)',
    'customer_close_case_session\\(text\\)',
  ]) {
    assert.match(migration, new RegExp(`revoke all on function public\\.${fn} from public, anon, authenticated;`));
    assert.match(migration, new RegExp(`grant execute on function public\\.${fn} to service_role;`));
  }
  assert.match(migration, /crypt\(p_plaintext_code, gen_salt\('bf', 12\)\)/);
  assert.match(migration, /digest\(v_token, 'sha256'\)/);
  assert.match(migration, /revoke all on function app_private\.case_snapshot\(uuid\) from public, anon, authenticated;/);
  assert.match(migration, /foreign key \(organization_id, case_id\)/);
  assert.doesNotMatch(migration, /grant execute on function public\.customer_[^;]+ to anon/);
});

test('Production config fails closed and never exposes missing secret names', async () => {
  const db = database();
  try {
    const response = await handleProductionApi(productionRequest('/health'), { DB: db });
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.code, 'supabase_not_configured');
    assert.doesNotMatch(JSON.stringify(body), /SECRET_KEY|PUBLISHABLE_KEY|ORGANIZATION_ID/);
  } finally {
    db.sql.close();
  }
});

test('Case verification returns only the filtered snapshot and a hardened cookie', async () => {
  const env = environment();
  const previousFetch = globalThis.fetch;
  let upstreamRequest;
  globalThis.fetch = async (input, init) => {
    upstreamRequest = { url: String(input), init };
    return Response.json(caseSession());
  };
  try {
    const response = await handleProductionApi(
      productionRequest('/cases/verify', {
        method: 'POST',
        body: { reference: 'SAV-2026-1042', code: '482731' },
      }),
      env,
    );
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.case.reference, 'SAV-2026-1042');
    assert.equal(body.access_token, undefined);
    assert.equal(body.code, undefined);
    assert.doesNotMatch(JSON.stringify(body), /482731|a{64}/);
    const setCookie = response.headers.get('set-cookie') ?? '';
    assert.match(setCookie, /savsc_case_access=/);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Strict/i);
    assert.match(setCookie, /Secure/i);
    assert.equal(upstreamRequest.url.endsWith('/rest/v1/rpc/customer_open_case_session'), true);
    assert.equal(new Headers(upstreamRequest.init.headers).get('apikey'), env.SUPABASE_SECRET_KEY);
  } finally {
    globalThis.fetch = previousFetch;
    env.DB.sql.close();
  }
});

test('Invalid case credentials use one neutral customer response', async () => {
  const env = environment();
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({ code: 'P0001', message: 'invalid_case_credentials' }, { status: 400 });
  try {
    const response = await handleProductionApi(
      productionRequest('/cases/verify', {
        method: 'POST',
        body: { reference: 'SAV-2026-9999', code: '111111' },
      }),
      env,
    );
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {
      error: 'Référence ou code incorrect.',
      code: 'invalid_case_credentials',
    });
  } finally {
    globalThis.fetch = previousFetch;
    env.DB.sql.close();
  }
});

test('Cross-site mutations are rejected before any upstream request', async () => {
  const env = environment();
  const previousFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return Response.json(caseSession());
  };
  try {
    const response = await handleProductionApi(
      productionRequest('/cases/verify', {
        method: 'POST',
        origin: 'https://attacker.example',
        body: { reference: 'SAV-2026-1042', code: '482731' },
      }),
      env,
    );
    assert.equal(response.status, 403);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = previousFetch;
    env.DB.sql.close();
  }
});

test('An MFA admin session refreshes securely when only the refresh cookie remains', async () => {
  const env = environment();
  const previousFetch = globalThis.fetch;
  const payload = Buffer.from(JSON.stringify({ aal: 'aal2' })).toString('base64url');
  const accessToken = `eyJhbGciOiJub25lIn0.${payload}.${'s'.repeat(32)}`;
  const refreshToken = 'r'.repeat(48);
  const calls = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, headers: new Headers(init.headers) });
    if (url.includes('/auth/v1/token?grant_type=refresh_token'))
      return Response.json({
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: 3600,
        user: {
          id: '30000000-0000-4000-8000-000000000001',
          email: 'admin@example.com',
          factors: [],
        },
      });
    if (url.endsWith('/rest/v1/rpc/admin_me'))
      return Response.json({
        user_id: '30000000-0000-4000-8000-000000000001',
        email: 'admin@example.com',
        aal: 'aal2',
        memberships: [
          {
            organization_id: ORGANIZATION_ID,
            organization_name: 'SAV SC Assistant AI',
            role: 'super_admin',
            display_name: 'Responsable',
          },
        ],
      });
    throw new Error(`Unexpected upstream request: ${url}`);
  };
  try {
    const response = await handleProductionApi(
      productionRequest('/admin/session', {
        cookie: `savsc_admin_refresh=${refreshToken}`,
      }),
      env,
    );
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.admin.aal, 'aal2');
    assert.match(response.headers.get('set-cookie') ?? '', /savsc_admin_access=/);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].headers.get('apikey'), env.SUPABASE_PUBLISHABLE_KEY);
    assert.equal(calls[1].headers.get('authorization'), `Bearer ${accessToken}`);
  } finally {
    globalThis.fetch = previousFetch;
    env.DB.sql.close();
  }
});
