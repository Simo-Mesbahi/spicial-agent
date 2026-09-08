import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const compiled = await build({
  entryPoints: ['lib/atlas/admin-operations-api.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { handleAdminOperationsApi } = await import(
  'data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64')
);

const ORGANIZATION_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_ORGANIZATION_ID = '00000000-0000-4000-8000-000000000002';
const CASE_ID = '00000000-0000-4000-8000-000000000401';

function environment() {
  return {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'test-publishable-key',
    SUPABASE_SECRET_KEY: 'test-secret-key',
    SUPABASE_ORGANIZATION_ID: ORGANIZATION_ID,
  };
}

function adminIdentity(role = 'super_admin') {
  return {
    user_id: '00000000-0000-4000-8000-000000000900',
    email: 'admin@example.test',
    aal: 'aal2',
    memberships: [
      {
        organization_id: ORGANIZATION_ID,
        organization_name: 'Maison Atlas',
        role,
        display_name: 'Admin test',
      },
    ],
  };
}

function adminRequest(path, init = {}) {
  return new Request(`https://atlas.test/api/production/admin/operations${path}`, {
    ...init,
    headers: {
      Cookie: 'savsc_admin_access=test-access-token',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
}

function overview() {
  return {
    generated_at: new Date().toISOString(),
    period_days: 30,
    cases: {
      total: 2,
      open: 1,
      overdue: 0,
      without_eta: 0,
      stale: 0,
      resolved: 1,
      avg_resolution_hours: 12.5,
    },
    by_status: { waiting_part: 1, resolved: 1 },
    trend: [{ day: '2026-09-08', opened: 1, closed: 0 }],
    performance: {
      requests_24h: 10,
      error_rate_24h: 0,
      avg_latency_ms_24h: 32,
      p95_latency_ms_24h: 51,
      denied_24h: 1,
      rate_limited_24h: 0,
    },
    routes: [{ route: '/api/production/cases/current', requests: 8, errors: 0, avg_ms: 30 }],
    documents: { total: 12, published: 10, review: 2, expired: 0 },
    assistant: { messages_24h: 4, conversations: 2 },
    handoffs: { open: 1, unassigned: 1 },
  };
}

test('operations require an authenticated admin session', async () => {
  const response = await handleAdminOperationsApi(
    new Request(`https://atlas.test/api/production/admin/operations/overview?organizationId=${ORGANIZATION_ID}`),
    environment(),
  );
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, 'admin_session_expired');
});

test('overview is returned only for an allowed AAL2 organization', async () => {
  const previousFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    seen.push(url);
    if (url.endsWith('/rest/v1/rpc/admin_me')) return Response.json(adminIdentity());
    if (url.endsWith('/rest/v1/rpc/admin_overview')) return Response.json(overview());
    throw new Error(`Unexpected URL: ${url}`);
  };
  try {
    const response = await handleAdminOperationsApi(
      adminRequest(`/overview?organizationId=${ORGANIZATION_ID}`),
      environment(),
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.overview.cases.open, 1);
    assert.equal(body.overview.performance.p95_latency_ms_24h, 51);
    assert.equal(seen.length, 2);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('cross-organization access is rejected before business RPC execution', async () => {
  const previousFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (input) => {
    calls += 1;
    const url = String(input);
    if (url.endsWith('/rest/v1/rpc/admin_me')) return Response.json(adminIdentity());
    throw new Error(`Unexpected business RPC: ${url}`);
  };
  try {
    const response = await handleAdminOperationsApi(
      adminRequest(`/overview?organizationId=${OTHER_ORGANIZATION_ID}`),
      environment(),
    );
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, 'organization_denied');
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('cross-site note mutation is refused before the note RPC', async () => {
  const previousFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (input) => {
    calls += 1;
    const url = String(input);
    if (url.endsWith('/rest/v1/rpc/admin_me')) return Response.json(adminIdentity('adviser'));
    throw new Error(`Unexpected business RPC: ${url}`);
  };
  try {
    const response = await handleAdminOperationsApi(
      adminRequest('/case/note', {
        method: 'POST',
        headers: { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' },
        body: JSON.stringify({
          organizationId: ORGANIZATION_ID,
          caseId: CASE_ID,
          version: 1,
          note: 'Note de test',
          visible: false,
          requestId: '12345678-1234-4234-8234-123456789012',
        }),
      }),
      environment(),
    );
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, 'invalid_origin');
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('optimistic concurrency conflicts are exposed as a safe 409', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/rest/v1/rpc/admin_me')) return Response.json(adminIdentity('adviser'));
    if (url.endsWith('/rest/v1/rpc/admin_add_note'))
      return Response.json({ code: '40001', message: 'version_conflict' }, { status: 400 });
    throw new Error(`Unexpected URL: ${url}`);
  };
  try {
    const response = await handleAdminOperationsApi(
      adminRequest('/case/note', {
        method: 'POST',
        headers: { Origin: 'https://atlas.test', 'Sec-Fetch-Site': 'same-origin' },
        body: JSON.stringify({
          organizationId: ORGANIZATION_ID,
          caseId: CASE_ID,
          version: 1,
          note: 'Le client a été rappelé.',
          visible: false,
          requestId: '12345678-1234-4234-8234-123456789012',
        }),
      }),
      environment(),
    );
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), {
      error: 'Les données ont changé. Actualisez avant de réessayer.',
      code: 'version_conflict',
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});
