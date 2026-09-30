import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

async function load(path) {
  const result = await build({ entryPoints: [path], bundle: true, platform: 'node', format: 'esm', write: false });
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
}
const { loadAdminCasePage } = await load('lib/atlas/admin-case-list.ts');
const { latestRequest } = await load('lib/atlas/latest-request.ts');
const { handleProductionApi } = await load('lib/atlas/production-api.ts');
const org = '00000000-0000-4000-8000-000000000001';
const filters = { search: 'dossier été & retour', service: 'sav', archive: 'active', status: 'waiting_part' };

test('case navigation reaches all 65 records while retaining submitted filters and scope', async () => {
  const calls = [];
  const rows = Array.from({ length: 65 }, (_, id) => ({ id }));
  const read = async path => {
    const params = new URL(path, 'https://test.invalid').searchParams;
    calls.push(params);
    const offset = Number(params.get('offset'));
    return { items: rows.slice(offset, offset + Number(params.get('limit'))), total: rows.length };
  };
  const pages = [];
  for (const offset of [0, 30, 60]) pages.push(await loadAdminCasePage(read, org, filters, offset));
  assert.deepEqual(pages.flatMap(page => page.items), rows);
  assert.deepEqual(pages.map(page => page.items.length), [30, 30, 5]);
  for (const params of calls) {
    assert.equal(params.get('organizationId'), org);
    assert.equal(params.get('search'), filters.search);
    assert.equal(params.get('serviceType'), 'sav');
    assert.equal(params.get('status'), 'waiting_part');
    assert.equal(params.get('archive'), 'active');
    assert.equal(params.get('limit'), '30');
  }
});

test('concurrent archiving corrects a vanished final page once, without a retry loop', async () => {
  const offsets = [];
  const result = await loadAdminCasePage(async path => {
    const offset = Number(new URL(path, 'https://test.invalid').searchParams.get('offset'));
    offsets.push(offset);
    return { items: offset === 30 ? [{ id: 'remaining' }] : [], total: 31 };
  }, org, filters, 60);
  assert.deepEqual(offsets, [60, 30]);
  assert.equal(result.offset, 30);
  assert.equal(result.items[0].id, 'remaining');
});

test('superseded reads and session cancellation cannot restore stale records or errors', async () => {
  const reads = latestRequest();
  let finishOld;
  let oldSignal;
  const first = reads.run(signal => { oldSignal = signal; return new Promise(resolve => { finishOld = resolve; }); });
  assert.equal(await reads.run(async () => 'new organization'), 'new organization');
  assert.equal(oldSignal.aborted, true);
  finishOld('old organization');
  assert.equal(await first, null);
  let fail;
  const pending = reads.run(() => new Promise((_, reject) => { fail = reject; }));
  reads.cancel();
  fail(new Error('late unauthorized response'));
  assert.equal(await pending, null);
  await assert.rejects(reads.run(async () => { throw new Error('current failure'); }), /current failure/);
});

function fixture(t, { aal = 'aal2' } = {}) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (String(url).endsWith('/admin_me')) return Response.json({
      user_id: '00000000-0000-4000-8000-000000000900', email: 'admin@example.test', aal,
      memberships: [{ organization_id: org, organization_name: 'Synthetic', role: 'sav_manager', display_name: null }],
    });
    assert.ok(String(url).endsWith('/admin_list_cases_v2'));
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer user-token');
    calls.push(JSON.parse(init.body));
    return Response.json({ items: [{ id: 'case-page-two' }], total: 65 });
  });
  const env = { SUPABASE_URL: 'https://test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'public-test', SUPABASE_SECRET_KEY: 'private-test', SUPABASE_ORGANIZATION_ID: org };
  return { calls, get: (query, organization = org) => handleProductionApi(new Request(`https://atlas.test/api/production/admin/cases?organizationId=${organization}&${query}`, { headers: { Cookie: 'savsc_admin_access=user-token' } }), env) };
}

test('case list API forwards validated pagination using the caller authorization', async t => {
  const { get, calls } = fixture(t);
  const response = await get('offset=30&limit=30&serviceType=sav&status=waiting_part&archive=archived');
  assert.equal(response.status, 200);
  assert.equal((await response.json()).total, 65);
  assert.equal(calls[0].p_offset, 30);
  assert.equal(calls[0].p_status, 'waiting_part');
  assert.equal(calls[0].p_archive_filter, 'archived');
});

test('invalid case pagination and filters are rejected before the database RPC', async t => {
  const { get, calls } = fixture(t);
  for (const query of ['offset=1.5', 'offset=Infinity', 'offset=-1', 'offset=2147483648', 'limit=101', 'limit=NaN', 'limit=0', 'status=arbitrary', 'kind=arbitrary', 'serviceType=unknown', 'archive=unknown']) {
    const response = await get(query);
    assert.equal(response.status, 400, query);
  }
  assert.equal(calls.length, 0);
});

test('case pagination still requires MFA', async t => {
  const { get, calls } = fixture(t, { aal: 'aal1' });
  assert.equal((await get('offset=30')).status, 403);
  assert.equal(calls.length, 0);
});

test('case pagination refuses a foreign organization before listing records', async t => {
  const { get, calls } = fixture(t);
  assert.equal((await get('offset=30', '00000000-0000-4000-8000-000000000002')).status, 403);
  assert.equal(calls.length, 0);
});
