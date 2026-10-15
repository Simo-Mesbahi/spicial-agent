import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

async function compiled(entry) {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
  });
  return import(
    'data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64')
  );
}
const { handleAdminOperationsApi } = await compiled('lib/atlas/admin-operations-api.ts');
const { csv, entitySaveSchema, batchCaseSchema } = await compiled('lib/atlas/admin-business.ts');
const org = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const id = '00000000-0000-4000-8000-000000000301';
const caseId = '00000000-0000-4000-8000-000000000401';
const requestId = '00000000-0000-4000-8000-000000000701';
const env = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'test-publishable-key',
  SUPABASE_SECRET_KEY: 'test-secret-key',
  SUPABASE_ORGANIZATION_ID: org,
};
const customer = {
  external_id: null,
  first_name: 'Client',
  last_name: 'Synthétique',
  email: 'customer@example.invalid',
  phone: null,
};
const record = {
  id,
  kind: 'customer',
  revision: 2,
  data: customer,
  linkedCases: 1,
  canEdit: true,
  updatedAt: '2026-10-14T12:00:00Z',
};
function req(path, body, headers = {}) {
  return new Request('https://atlas.test/api/production/admin/operations/business' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Cookie: 'savsc_admin_access=test-access-token',
      ...(body === undefined
        ? {}
        : { 'Content-Type': 'application/json', Origin: 'https://atlas.test' }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
}
async function withRpc(handlers, run, { role = 'super_admin', aal = 'aal2' } = {}) {
  const previous = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (input, init) => {
    const name = String(input).split('/').at(-1);
    const body = init?.body ? JSON.parse(init.body) : null;
    seen.push({ name, body, authorization: new Headers(init?.headers).get('Authorization') });
    if (name === 'admin_me')
      return Response.json({
        user_id: '00000000-0000-4000-8000-000000000900',
        email: 'admin@example.invalid',
        aal,
        memberships: [
          {
            organization_id: org,
            organization_name: 'Test synthétique',
            role,
            display_name: 'Admin test',
          },
        ],
      });
    if (!handlers[name]) throw new Error('Unexpected RPC: ' + name);
    const value = await handlers[name](body);
    return value instanceof Response ? value : Response.json(value);
  };
  try {
    return await run(seen);
  } finally {
    globalThis.fetch = previous;
  }
}

test('business directory requires authentication and never executes a business RPC anonymously', async () => {
  const response = await handleAdminOperationsApi(
    new Request(
      `https://atlas.test/api/production/admin/operations/business/entities?organizationId=${org}&kind=customer`,
    ),
    env,
  );
  assert.equal(response.status, 401);
});
test('business directory is organization-scoped and validates its response contract', async () =>
  withRpc(
    {
      admin_entities: (body) => {
        assert.equal(body.p_organization_id, org);
        assert.equal(body.p_kind, 'customer');
        assert.equal(body.p_offset, 30);
        return { items: [record], total: 31, canCreate: true };
      },
    },
    async (seen) => {
      const response = await handleAdminOperationsApi(
        req(`/entities?organizationId=${org}&kind=customer&offset=30&search=Client`),
        env,
      );
      assert.equal(response.status, 200);
      assert.equal((await response.json()).items[0].revision, 2);
      assert.equal(seen.at(-1).authorization, 'Bearer test-access-token');
    },
  ));
test('cross-organization directory access is rejected before business SQL', async () =>
  withRpc({}, async (seen) => {
    const response = await handleAdminOperationsApi(
      req(`/entities?organizationId=${other}&kind=customer`),
      env,
    );
    assert.equal(response.status, 403);
    assert.equal(seen.length, 1);
  }));
test('AAL1 cannot access reference data', async () =>
  withRpc(
    {},
    async (seen) => {
      const response = await handleAdminOperationsApi(
        req(`/entities?organizationId=${org}&kind=customer`),
        env,
      );
      assert.equal(response.status, 403);
      assert.equal((await response.json()).code, 'mfa_required');
      assert.equal(seen.length, 1);
    },
    { aal: 'aal1' },
  ));
test('entity save uses the revision, actor session and stable command id', async () =>
  withRpc(
    {
      admin_save_entity: (body) => {
        assert.deepEqual(body, {
          p_organization_id: org,
          p_kind: 'customer',
          p_id: id,
          p_expected_revision: 1,
          p_data: customer,
          p_request_id: requestId,
        });
        return record;
      },
    },
    async () => {
      const response = await handleAdminOperationsApi(
        req('/entity/save', {
          organizationId: org,
          kind: 'customer',
          id,
          expectedRevision: 1,
          data: customer,
          requestId,
        }),
        env,
      );
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), record);
    },
  ));
test('entity correction rejects forged properties and malformed email before SQL', async () =>
  withRpc({}, async (seen) => {
    for (const data of [
      { ...customer, organization_id: other },
      { ...customer, email: 'bad email' },
    ]) {
      const response = await handleAdminOperationsApi(
        req('/entity/save', {
          organizationId: org,
          kind: 'customer',
          id,
          expectedRevision: 1,
          data,
          requestId,
        }),
        env,
      );
      assert.equal(response.status, 400);
    }
    assert.equal(seen.filter((call) => call.name !== 'admin_me').length, 0);
  }));
test('cross-site entity mutation is rejected', async () =>
  withRpc({}, async (seen) => {
    const response = await handleAdminOperationsApi(
      req(
        '/entity/save',
        {
          organizationId: org,
          kind: 'customer',
          id,
          expectedRevision: 1,
          data: customer,
          requestId,
        },
        { Origin: 'https://foreign.example', 'Sec-Fetch-Site': 'cross-site' },
      ),
      env,
    );
    assert.equal(response.status, 403);
    assert.equal(seen.length, 1);
  }));
test('malformed and oversized business bodies return client errors', async () =>
  withRpc({}, async () => {
    const broken = await handleAdminOperationsApi(req('/entity/save', '{broken'), env);
    assert.equal(broken.status, 400);
    const huge = await handleAdminOperationsApi(
      req('/entity/save', JSON.stringify({ value: 'x'.repeat(40 * 1024) })),
      env,
    );
    assert.equal(huge.status, 413);
  }));
test('database conflicts and role denials stay explicit', async () => {
  for (const [code, status] of [
    ['40001', 409],
    ['40P01', 409],
    ['42501', 403],
  ])
    await withRpc(
      {
        admin_save_entity: () =>
          Response.json({ code, message: 'synthetic failure' }, { status: 400 }),
      },
      async () => {
        const response = await handleAdminOperationsApi(
          req('/entity/save', {
            organizationId: org,
            kind: 'customer',
            id,
            expectedRevision: 1,
            data: customer,
            requestId,
          }),
          env,
        );
        assert.equal(response.status, status);
      },
    );
});
test('restoration preserves the reason and optimistic case version', async () =>
  withRpc(
    {
      admin_restore_case: (body) => {
        assert.equal(body.p_expected_version, 4);
        assert.equal(body.p_reason, 'Erreur de classement');
        return { ok: true, id: caseId, reference: 'SAV-QA-001', version: 5 };
      },
    },
    async () => {
      const response = await handleAdminOperationsApi(
        req('/case/restore', {
          organizationId: org,
          caseId,
          expectedVersion: 4,
          reason: 'Erreur de classement',
          requestId,
        }),
        env,
      );
      assert.equal(response.status, 200);
      assert.equal((await response.json()).version, 5);
    },
  ));
test('batch validation rejects duplicates and excessive selections', () => {
  const base = {
    organizationId: org,
    requestId,
    action: 'note',
    note: 'Note synthétique',
    visible: false,
  };
  assert.equal(
    batchCaseSchema.safeParse({ ...base, items: [{ id: caseId, version: 1 }] }).success,
    true,
  );
  assert.equal(
    batchCaseSchema.safeParse({
      ...base,
      items: [
        { id: caseId, version: 1 },
        { id: caseId, version: 1 },
      ],
    }).success,
    false,
  );
  assert.equal(
    batchCaseSchema.safeParse({
      ...base,
      items: Array.from({ length: 26 }, (_, i) => ({
        id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        version: 1,
      })),
    }).success,
    false,
  );
});
test('batch forwards all versions as one atomic command', async () =>
  withRpc(
    {
      admin_batch_cases: (body) => {
        assert.equal(body.p_action, 'deadline');
        assert.deepEqual(body.p_items, [{ id: caseId, version: 3 }]);
        assert.equal(body.p_payload.estimatedAt, null);
        return { ok: true, count: 1, items: [{ id: caseId, version: 4 }] };
      },
    },
    async () => {
      const response = await handleAdminOperationsApi(
        req('/cases/batch', {
          organizationId: org,
          requestId,
          action: 'deadline',
          items: [{ id: caseId, version: 3 }],
          estimatedAt: null,
        }),
        env,
      );
      assert.equal(response.status, 200);
    },
  ));
test('filtered export contains no access code and neutralizes spreadsheet formulae', async () =>
  withRpc(
    {
      admin_export_cases: (body) => {
        assert.equal(body.p_search, 'filtre soumis');
        assert.equal(body.p_service, 'sav');
        assert.equal(body.p_archive, 'active');
        return {
          items: [
            {
              reference: 'QA-EXPORT-001',
              service_type: 'sav',
              kind: 'repair',
              title: '=HYPERLINK("bad")',
              status: 'diagnosis',
              customer: 'Client QA',
              product: 'Produit',
              store: 'Magasin',
              estimated_at: null,
              updated_at: '2026-10-14T00:00:00Z',
              archived_at: null,
              access_code: 'must-not-leak',
            },
          ],
          total: 1,
          generatedAt: '2026-10-14T00:00:00Z',
        };
      },
    },
    async () => {
      const response = await handleAdminOperationsApi(
        req('/cases/export', {
          organizationId: org,
          search: 'filtre soumis',
          service: 'sav',
          archive: 'active',
          status: '',
        }),
        env,
      );
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.count, 1);
      assert.match(body.csv, /'=HYPERLINK\(""bad""\)/);
      assert.doesNotMatch(body.csv, /must-not-leak/);
    },
  ));
test('partial or malformed exports are refused instead of downloading incomplete data', async () =>
  withRpc(
    { admin_export_cases: () => ({ items: [], total: 3, generatedAt: '2026-10-14T00:00:00Z' }) },
    async () => {
      const response = await handleAdminOperationsApi(
        req('/cases/export', { organizationId: org }),
        env,
      );
      assert.equal(response.status, 502);
    },
  ));
test('message history uses an opaque pair cursor and rejects incomplete cursors', async () =>
  withRpc(
    {
      admin_case_messages: (body) => {
        assert.equal(body.p_case_id, caseId);
        assert.equal(body.p_before_time, '2026-10-14T00:00:00Z');
        assert.equal(body.p_before_id, id);
        return { items: [], hasMore: false, nextCursor: null };
      },
    },
    async (seen) => {
      const bad = await handleAdminOperationsApi(
        req(`/messages?organizationId=${org}&caseId=${caseId}&beforeId=${id}`),
        env,
      );
      assert.equal(bad.status, 400);
      const good = await handleAdminOperationsApi(
        req(
          `/messages?organizationId=${org}&caseId=${caseId}&beforeId=${id}&beforeTime=2026-10-14T00:00:00Z`,
        ),
        env,
      );
      assert.equal(good.status, 200);
      assert.equal(seen.filter((call) => call.name === 'admin_case_messages').length, 1);
    },
  ));
test('system/tool messages and internal metadata cannot enter the conversation response', async () =>
  withRpc(
    {
      admin_case_messages: () => ({
        items: [
          {
            id,
            role: 'system',
            content: 'internal instructions',
            createdAt: '2026-10-14T00:00:00Z',
            conversationId: caseId,
          },
        ],
        hasMore: false,
        nextCursor: null,
      }),
    },
    async () => {
      const response = await handleAdminOperationsApi(
        req(`/messages?organizationId=${org}&caseId=${caseId}`),
        env,
      );
      assert.equal(response.status, 502);
    },
  ));
test('CSV preserves Unicode, quote escaping, line breaks and formula protection', () => {
  const result = csv([
    ['Référence', 'العربية'],
    ['a;"b', 'ligne 1\nligne 2'],
    ['  =SUM(1)', '\t+cmd'],
    [null, 42],
  ]);
  assert.ok(result.startsWith('\ufeff'));
  assert.match(result, /'  =SUM\(1\)/);
  assert.match(result, /'\t\+cmd/);
  assert.ok(result.includes('"a;""b"'));
  assert.ok(result.includes('"ligne 1\nligne 2"'));
  assert.ok(result.includes('العربية'));
});
test('empty customers and unexpected entity fields are rejected by the editor contract', () => {
  const base = { organizationId: org, requestId, kind: 'customer', id: null, expectedRevision: 0 };
  assert.equal(entitySaveSchema.safeParse({ ...base, data: customer }).success, true);
  assert.equal(
    entitySaveSchema.safeParse({
      ...base,
      data: Object.fromEntries(Object.keys(customer).map((key) => [key, null])),
    }).success,
    false,
  );
  assert.equal(
    entitySaveSchema.safeParse({ ...base, data: { ...customer, role: 'super_admin' } }).success,
    false,
  );
});

test('recognized business failures are actionable and arbitrary SQL messages remain hidden',async()=>{
  for(const [message,expectedCode] of [['export_limit_exceeded','export_limit_exceeded'],['secret-customer@example.invalid','invalid_operation']])
    await withRpc({admin_export_cases:()=>Response.json({code:'22023',message},{status:400})},async()=>{
      const response=await handleAdminOperationsApi(req('/cases/export',{organizationId:org}),env);
      assert.equal(response.status,400);const result=await response.json();assert.equal(result.code,expectedCode);
      assert.doesNotMatch(result.error,/secret-customer/);
    });
});
