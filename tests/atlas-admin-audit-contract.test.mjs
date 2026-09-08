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

function env() {
  return {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'test-publishable-key',
    SUPABASE_SECRET_KEY: 'test-secret-key',
    SUPABASE_ORGANIZATION_ID: ORGANIZATION_ID,
  };
}

test('audit accepts historical events with a nullable entity_type', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/rest/v1/rpc/admin_me')) {
      return Response.json({
        user_id: '00000000-0000-4000-8000-000000000900',
        email: 'admin@example.test',
        aal: 'aal2',
        memberships: [{
          organization_id: ORGANIZATION_ID,
          organization_name: 'Maison Atlas',
          role: 'super_admin',
          display_name: 'Admin test',
        }],
      });
    }
    if (url.endsWith('/rest/v1/rpc/admin_audit')) {
      return Response.json({
        items: [{
          id: '00000000-0000-4000-8000-000000000777',
          action: 'case.access',
          outcome: 'denied',
          entity_type: null,
          entity_id: null,
          actor_user_id: null,
          created_at: '2026-09-08T16:00:00+00:00',
        }],
        total: 1,
      });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  try {
    const response = await handleAdminOperationsApi(
      new Request(`https://atlas.test/api/production/admin/operations/audit?organizationId=${ORGANIZATION_ID}`, {
        headers: { Cookie: 'savsc_admin_access=test-access-token' },
      }),
      env(),
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.audit.items[0].entity_type, null);
    assert.equal(body.audit.items[0].outcome, 'denied');
  } finally {
    globalThis.fetch = previousFetch;
  }
});
