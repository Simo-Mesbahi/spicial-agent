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

test('admin mutations accept only the exact configured public origin behind a rewriting proxy', async () => {
  const previousFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (input) => {
    calls += 1;
    const url = String(input);
    if (url.endsWith('/rest/v1/rpc/admin_me')) return Response.json(adminIdentity('adviser'));
    if (url.endsWith('/rest/v1/rpc/admin_add_note'))
      return Response.json({
        ok: true,
        version: 2,
        event_id: '00000000-0000-4000-8000-000000000777',
      });
    throw new Error(`Unexpected URL: ${url}`);
  };

  try {
    const env = {
      ...environment(),
      APP_ENVIRONMENT: 'LOCAL',
      APP_PUBLIC_ORIGIN: 'https://support.example.com',
    };
    const response = await handleAdminOperationsApi(
      new Request('http://127.0.0.1:5173/api/production/admin/operations/case/note', {
        method: 'POST',
        headers: {
          Cookie: 'savsc_admin_access=test-access-token',
          'Content-Type': 'application/json',
          Origin: 'https://support.example.com',
          'Sec-Fetch-Site': 'same-origin',
        },
        body: JSON.stringify({
          organizationId: ORGANIZATION_ID,
          caseId: CASE_ID,
          version: 1,
          note: 'Le client a été rappelé.',
          visible: false,
          requestId: '12345678-1234-4234-8234-123456789012',
        }),
      }),
      env,
    );

    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(calls, 2);
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


test('case management options are bounded and require the authenticated admin context', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/rest/v1/rpc/admin_me')) return Response.json(adminIdentity('super_admin'));
    if (url.endsWith('/rest/v1/rpc/admin_case_form_options'))
      return Response.json({
        stores: [
          {
            id: '00000000-0000-4000-8000-000000000101',
            code: 'PAR-001',
            name: 'Maison Atlas Paris',
            city: 'Paris',
          },
        ],
      });
    throw new Error(`Unexpected URL: ${url}`);
  };
  try {
    const response = await handleAdminOperationsApi(
      adminRequest(`/case/options?organizationId=${ORGANIZATION_ID}`),
      environment(),
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.stores.length, 1);
    assert.equal(body.stores[0].code, 'PAR-001');
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('case creation forwards only validated server contract fields and returns one-time access code', async () => {
  const previousFetch = globalThis.fetch;
  const rpcBodies = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.endsWith('/rest/v1/rpc/admin_me')) return Response.json(adminIdentity('super_admin'));
    if (url.endsWith('/rest/v1/rpc/admin_create_case')) {
      rpcBodies.push(JSON.parse(init.body));
      return Response.json({
        ok: true,
        id: CASE_ID,
        reference: 'SAV-2026-000001',
        version: 1,
        access_code: '48172635',
        access_code_available: true,
        replayed: false,
      });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  try {
    const response = await handleAdminOperationsApi(
      adminRequest('/case/create', {
        method: 'POST',
        headers: { Origin: 'https://atlas.test', 'Sec-Fetch-Site': 'same-origin' },
        body: JSON.stringify({
          organizationId: ORGANIZATION_ID,
          serviceType: 'sav',
          kind: 'repair',
          title: 'Téléviseur en panne',
          description: 'Écran noir intermittent.',
          customer: {
            externalId: 'C-42',
            firstName: 'Camille',
            lastName: 'Martin',
            email: 'camille@example.test',
            phone: '+352000000',
          },
          product: {
            externalId: 'P-42',
            sku: 'TV-42',
            name: 'Téléviseur OLED',
            category: 'Image & son',
            serialNumber: 'SER-42',
          },
          storeId: '00000000-0000-4000-8000-000000000101',
          warrantyStatus: 'covered',
          warrantyLabel: 'Garantie constructeur',
          quoteCents: null,
          refundCents: null,
          currency: 'EUR',
          deliveryMode: 'Retrait magasin',
          estimatedAt: '2026-09-30T10:00:00.000Z',
          requestId: '12345678-1234-4234-8234-123456789012',
        }),
      }),
      environment(),
    );
    assert.equal(response.status, 201, await response.clone().text());
    const body = await response.json();
    assert.equal(body.reference, 'SAV-2026-000001');
    assert.equal(body.access_code, '48172635');
    assert.equal(rpcBodies.length, 1);
    assert.equal(rpcBodies[0].p_payload.service_type, 'sav');
    assert.equal(rpcBodies[0].p_payload.customer_email, 'camille@example.test');
    assert.equal(rpcBodies[0].p_payload.product_serial_number, 'SER-42');
    assert.equal('serviceType' in rpcBodies[0].p_payload, false);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('case creation rejects a kind outside its service before any case mutation RPC', async () => {
  const previousFetch = globalThis.fetch;
  let mutationCalls = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/rest/v1/rpc/admin_me')) return Response.json(adminIdentity('super_admin'));
    mutationCalls += 1;
    throw new Error(`Unexpected mutation RPC: ${url}`);
  };
  try {
    const response = await handleAdminOperationsApi(
      adminRequest('/case/create', {
        method: 'POST',
        headers: { Origin: 'https://atlas.test', 'Sec-Fetch-Site': 'same-origin' },
        body: JSON.stringify({
          organizationId: ORGANIZATION_ID,
          serviceType: 'customer_service',
          kind: 'repair',
          title: 'Demande invalide',
          requestId: '12345678-1234-4234-8234-123456789012',
        }),
      }),
      environment(),
    );
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, 'invalid_case_create');
    assert.equal(mutationCalls, 0);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('case update, lifecycle transition, access rotation and archive use dedicated audited RPCs', async () => {
  const previousFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.endsWith('/rest/v1/rpc/admin_me')) return Response.json(adminIdentity('super_admin'));
    const body = JSON.parse(init.body ?? '{}');
    seen.push({ url, body });
    if (url.endsWith('/rest/v1/rpc/admin_update_case'))
      return Response.json({ ok: true, id: CASE_ID, reference: 'SAV-2026-1042', version: 2, changed_fields: ['title'] });
    if (url.endsWith('/rest/v1/rpc/admin_transition_case'))
      return Response.json({ ok: true, id: CASE_ID, reference: 'SAV-2026-1042', version: 3, status: 'diagnosis' });
    if (url.endsWith('/rest/v1/rpc/admin_rotate_case_access_code'))
      return Response.json({ ok: true, id: CASE_ID, reference: 'SAV-2026-1042', version: 4, access_code: '99112233', access_code_available: true, replayed: false });
    if (url.endsWith('/rest/v1/rpc/admin_archive_case'))
      return Response.json({ ok: true, id: CASE_ID, reference: 'SAV-2026-1042', version: 5, archived: true });
    throw new Error(`Unexpected URL: ${url}`);
  };
  try {
    const commonHeaders = { Origin: 'https://atlas.test', 'Sec-Fetch-Site': 'same-origin' };
    const requestId = () => crypto.randomUUID();

    const updated = await handleAdminOperationsApi(
      adminRequest('/case/update', {
        method: 'POST',
        headers: commonHeaders,
        body: JSON.stringify({
          organizationId: ORGANIZATION_ID,
          caseId: CASE_ID,
          expectedVersion: 1,
          title: 'Titre corrigé',
          description: 'Description',
          customerId: null,
          productId: null,
          storeId: null,
          warrantyStatus: 'unknown',
          warrantyLabel: null,
          quoteCents: null,
          refundCents: null,
          currency: 'EUR',
          deliveryMode: null,
          estimatedAt: null,
          requestId: requestId(),
        }),
      }),
      environment(),
    );
    assert.equal(updated.status, 200);

    const transitioned = await handleAdminOperationsApi(
      adminRequest('/case/transition', {
        method: 'POST',
        headers: commonHeaders,
        body: JSON.stringify({
          organizationId: ORGANIZATION_ID,
          caseId: CASE_ID,
          expectedVersion: 2,
          status: 'diagnosis',
          note: 'Diagnostic démarré.',
          customerVisible: true,
          requestId: requestId(),
        }),
      }),
      environment(),
    );
    assert.equal(transitioned.status, 200);

    const rotated = await handleAdminOperationsApi(
      adminRequest('/case/access-code', {
        method: 'POST',
        headers: commonHeaders,
        body: JSON.stringify({
          organizationId: ORGANIZATION_ID,
          caseId: CASE_ID,
          expectedVersion: 3,
          requestId: requestId(),
        }),
      }),
      environment(),
    );
    assert.equal(rotated.status, 200);
    assert.equal((await rotated.json()).access_code, '99112233');

    const archived = await handleAdminOperationsApi(
      adminRequest('/case/archive', {
        method: 'POST',
        headers: commonHeaders,
        body: JSON.stringify({
          organizationId: ORGANIZATION_ID,
          caseId: CASE_ID,
          expectedVersion: 4,
          reason: 'Dossier de test clôturé et archivé.',
          requestId: requestId(),
        }),
      }),
      environment(),
    );
    assert.equal(archived.status, 200);

    assert.deepEqual(
      seen.map((entry) => new URL(entry.url).pathname.split('/').at(-1)),
      ['admin_update_case', 'admin_transition_case', 'admin_rotate_case_access_code', 'admin_archive_case'],
    );
    assert.equal(seen[1].body.p_customer_visible, true);
    assert.equal(seen[3].body.p_reason, 'Dossier de test clôturé et archivé.');
  } finally {
    globalThis.fetch = previousFetch;
  }
});


test('case entity lookup is manager-only, bounded and forwards a trimmed customer query', async () => {
  const previousFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    seen.push({ url, body: init.body ? JSON.parse(init.body) : null });
    if (url.endsWith('/rest/v1/rpc/admin_me'))
      return Response.json(adminIdentity('sav_manager'));
    if (url.endsWith('/rest/v1/rpc/admin_case_entity_search'))
      return Response.json({
        entity_type: 'customer',
        query: 'camille',
        items: [
          {
            id: '00000000-0000-4000-8000-000000000201',
            external_id: 'C-42',
            first_name: 'Camille',
            last_name: 'Martin',
            email: 'camille@example.test',
            phone: '+352000000',
            display_name: 'Camille Martin',
            rank: 118.5,
          },
        ],
      });
    throw new Error(`Unexpected URL: ${url}`);
  };
  try {
    const response = await handleAdminOperationsApi(
      adminRequest(
        `/case/entities?organizationId=${ORGANIZATION_ID}&type=customer&q=%20camille%20`,
      ),
      environment(),
    );
    assert.equal(response.status, 200, await response.clone().text());
    const body = await response.json();
    assert.equal(body.entity_type, 'customer');
    assert.equal(body.query, 'camille');
    assert.equal(body.items.length, 1);
    assert.equal(body.items[0].display_name, 'Camille Martin');

    const business = seen.find((entry) =>
      entry.url.endsWith('/rest/v1/rpc/admin_case_entity_search'),
    );
    assert.ok(business);
    assert.deepEqual(business.body, {
      p_organization_id: ORGANIZATION_ID,
      p_entity_type: 'customer',
      p_query: 'camille',
      p_limit: 12,
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('short entity queries return no directory data and skip the business RPC', async () => {
  const previousFetch = globalThis.fetch;
  let businessCalls = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/rest/v1/rpc/admin_me'))
      return Response.json(adminIdentity('sc_manager'));
    businessCalls += 1;
    throw new Error(`Unexpected business RPC: ${url}`);
  };
  try {
    const response = await handleAdminOperationsApi(
      adminRequest(
        `/case/entities?organizationId=${ORGANIZATION_ID}&type=customer&q=ab`,
      ),
      environment(),
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      entity_type: 'customer',
      query: 'ab',
      items: [],
    });
    assert.equal(businessCalls, 0);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('advisers cannot enumerate customer or product lookup data', async () => {
  const previousFetch = globalThis.fetch;
  let businessCalls = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/rest/v1/rpc/admin_me'))
      return Response.json(adminIdentity('adviser'));
    businessCalls += 1;
    throw new Error(`Unexpected business RPC: ${url}`);
  };
  try {
    const response = await handleAdminOperationsApi(
      adminRequest(
        `/case/entities?organizationId=${ORGANIZATION_ID}&type=product&q=oled`,
      ),
      environment(),
    );
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, 'admin_access_denied');
    assert.equal(businessCalls, 0);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('product entity lookup rejects malformed upstream payloads fail-closed', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/rest/v1/rpc/admin_me'))
      return Response.json(adminIdentity('super_admin'));
    if (url.endsWith('/rest/v1/rpc/admin_case_entity_search'))
      return Response.json({
        entity_type: 'product',
        query: 'oled',
        items: [{ id: 'not-a-uuid', name: 'OLED' }],
      });
    throw new Error(`Unexpected URL: ${url}`);
  };
  try {
    const response = await handleAdminOperationsApi(
      adminRequest(
        `/case/entities?organizationId=${ORGANIZATION_ID}&type=product&q=oled`,
      ),
      environment(),
    );
    assert.equal(response.status, 502);
    assert.equal((await response.json()).code, 'invalid_entity_search_response');
  } finally {
    globalThis.fetch = previousFetch;
  }
});
