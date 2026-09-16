import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { build } from 'esbuild';
const output = await build({
  entryPoints: ['lib/atlas/production-api.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { handleProductionApi } = await import(
  'data:text/javascript;base64,' + Buffer.from(output.outputFiles[0].text).toString('base64')
);
const qrOutput = await build({ entryPoints: ['lib/atlas/mfa-qr.ts'], bundle: true, platform: 'browser', format: 'esm', write: false });
const { mfaQrGeometry } = await import('data:text/javascript;base64,' + Buffer.from(qrOutput.outputFiles[0].text).toString('base64'));
function database() {
  const sql = new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys=ON');
  for (const f of readdirSync('drizzle')
    .filter((f) => f.endsWith('.sql'))
    .sort())
    sql.exec(readFileSync('drizzle/' + f, 'utf8'));
  return {
    sql,
    prepare(query) {
      let args = [];
      return {
        bind(...values) {
          args = values;
          return this;
        },
        async first() {
          return sql.prepare(query).get(...args) ?? null;
        },
        async all() {
          return { results: sql.prepare(query).all(...args) };
        },
        async run() {
          return { meta: { changes: Number(sql.prepare(query).run(...args).changes) } };
        },
      };
    },
    async batch(statements) {
      sql.exec('BEGIN');
      try {
        const r = [];
        for (const stmt of statements) r.push(await stmt.run());
        sql.exec('COMMIT');
        return r;
      } catch (e) {
        sql.exec('ROLLBACK');
        throw e;
      }
    },
  };
}

const uid = '00000000-0000-4000-8000-000000000900',
  org = '00000000-0000-4000-8000-000000000001',
  fid = '00000000-0000-4000-8000-000000000901',
  cid = '00000000-0000-4000-8000-000000000902';
const access = 'preauth-access-test-token',
  refresh = 'short-refresh';
function setup(t) {
  const DB = database();
  t.after(() => DB.sql.close());
  const previous = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = previous;
  });
  const state = { factors: [], posts: 0, deletes: 0, error: null, gate: null, aal: 'aal1', enrollmentOverride: null };
  const identity = () => ({
    user_id: uid,
    email: 'admin@example.test',
    aal: state.aal,
    memberships: [
      { organization_id: org, organization_name: 'Test', role: 'super_admin', display_name: null },
    ],
  });
  globalThis.fetch = async (url, options = {}) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/admin_me')) return Response.json(identity());
    if (state.error)
      return Response.json({ code: state.error.code }, { status: state.error.status });
    if (path.endsWith('/token'))
      return Response.json({
        access_token: access,
        refresh_token: refresh,
        user: { id: uid, email: 'admin@example.test', factors: state.factors },
      });
    if (path.endsWith('/user')) return Response.json({ id: uid, factors: state.factors });
    if (options.method === 'DELETE') {
      state.deletes++;
      state.factors = state.factors.filter((f) => !path.endsWith(f.id));
      return Response.json({ id: fid });
    }
    if (path.endsWith('/factors')) {
      state.posts++;
      if (state.gate) await state.gate;
      state.factors = [
        {
          id: fid,
          factor_type: 'totp',
          status: 'unverified',
          friendly_name: 'SAV SC Administration',
        },
      ];
      return Response.json(state.enrollmentOverride ?? {
        id: fid,
        type: 'totp',
        totp: {
          qr_code: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
          secret: 'JBSWY3DPEHPK3PXP',
          uri: 'otpauth://totp/Test?secret=JBSWY3DPEHPK3PXP',
        },
      });
    }
    if (path.endsWith('/challenge')) return Response.json({ id: cid });
    if (path.endsWith('/verify')) {
      const body = JSON.parse(options.body);
      assert.equal(body.challenge_id, cid);
      if (body.code !== '123456')
        return Response.json({ code: 'mfa_verification_failed' }, { status: 422 });
      state.aal = 'aal2';
      state.factors[0].status = 'verified';
      return Response.json({
        access_token: 'verified-access-token-test',
        refresh_token: 'new-short',
        user: { id: uid, factors: state.factors },
      });
    }
    throw Error('Unexpected mock path ' + path);
  };
  const env = {
    DB,
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'publish-test',
    SUPABASE_SECRET_KEY: 'server-secret-never-print',
    SUPABASE_ORGANIZATION_ID: org,
  };
  const call = (
    path,
    body,
    cookies = `savsc_admin_preauth=${access}; savsc_admin_preauth_refresh=${refresh}`,
  ) =>
    handleProductionApi(
      new Request('https://atlas.test/api/production/admin/' + path, {
        method: body ? 'POST' : 'GET',
        headers: { cookie: cookies, 'content-type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
      env,
    );
  return { state, call, env };
}
test('missing MFA migration fails explicitly before creating or deleting an Auth factor', async (t) => {
  const { state, call, env } = setup(t);
  env.DB.sql.exec('DROP TABLE mfa_enrollments');
  for (const [path, body] of [['mfa/enroll', {}], ['mfa/state', undefined]]) {
    const response = await call(path, body);
    assert.equal(response.status, 503);
    const result = await response.json();
    assert.equal(result.code, 'mfa_storage_not_ready');
    assert.doesNotMatch(JSON.stringify(result), /server-secret|preauth-access|short-refresh|SELECT|INSERT/);
  }
  t.mock.method(env.DB, 'prepare', () => {
    throw new Error('D1 query failed', { cause: new Error('no such table: mfa_enrollments') });
  });
  const wrapped = await call('mfa/enroll', {});
  assert.equal(wrapped.status, 503);
  assert.equal((await wrapped.json()).code, 'mfa_storage_not_ready');
  assert.equal(state.posts, 0);
  assert.equal(state.deletes, 0);
});

test('complete mocked login/enrollment/refresh/challenge/verify yields AAL2 and HttpOnly cookies', async (t) => {
  const { state, call, env } = setup(t);
  const login = await call('login', { email: 'admin@example.test', password: 'test-password' });
  assert.equal(login.status, 200);
  assert.equal((await login.json()).status, 'mfa_required');
  const response = await call('mfa/enroll', {});
  assert.equal(response.status, 200);
  const enrollment = await response.json();
  assert.equal(enrollment.factorId, fid);
  assert.ok(enrollment.totp.qr_code.includes('<svg'));
  assert.deepEqual((await (await call('mfa/state')).json()).enrollment, enrollment);
  assert.deepEqual(await (await call('mfa/enroll', {})).json(), enrollment);
  assert.equal(state.posts, 1);
  assert.ok(
    !JSON.stringify(env.DB.sql.prepare('SELECT * FROM mfa_enrollments').all()).includes(
      enrollment.totp.secret,
    ),
  );
  const bad = await call('mfa/verify', { factorId: fid, code: '000000' });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).code, 'invalid_mfa_code');
  const verified = await call('mfa/verify', { factorId: fid, code: '123456' });
  assert.equal(verified.status, 200);
  const payload = await verified.json();
  assert.equal(payload.admin.aal, 'aal2');
  assert.ok(!JSON.stringify(payload).includes('token'));
  assert.match(verified.headers.get('set-cookie'), /HttpOnly/);
  assert.match(verified.headers.get('set-cookie'), /savsc_admin_access/);
  assert.equal(env.DB.sql.prepare('SELECT payload FROM mfa_enrollments').get().payload, '');
});
test('orphan unverified factor is removed via Auth DELETE then recreated, never verified factors', async (t) => {
  const { state, call } = setup(t);
  state.factors = [
    { id: fid, factor_type: 'totp', status: 'unverified', friendly_name: 'SAV SC Administration' },
  ];
  assert.equal((await call('mfa/enroll', {})).status, 200);
  assert.equal(state.deletes, 1);
  assert.equal(state.posts, 1);
  state.factors[0].status = 'verified';
  assert.equal((await call('mfa/enroll', {})).status, 409);
  assert.equal(state.deletes, 1);
});
test('concurrent enroll calls create only one factor', async (t) => {
  const { state, call } = setup(t);
  let release;
  state.gate = new Promise((r) => {
    release = r;
  });
  const first = call('mfa/enroll', {});
  while (!state.posts) await new Promise((r) => setTimeout(r, 1));
  const second = await call('mfa/enroll', {});
  assert.equal(second.status, 409);
  assert.equal((await second.json()).code, 'mfa_in_progress');
  release();
  assert.equal((await first).status, 200);
  assert.equal(state.posts, 1);
});
test('separate preauth session cannot retrieve or rotate active enrollment', async (t) => {
  const { call, state } = setup(t);
  await call('mfa/enroll', {});
  const cookies = `savsc_admin_preauth=${access}; savsc_admin_preauth_refresh=different-refresh`;
  assert.equal((await (await call('mfa/state', undefined, cookies)).json()).enrollment, null);
  assert.equal((await call('mfa/enroll', {}, cookies)).status, 409);
  assert.equal(state.posts, 1);
});
test('expired cache is restarted safely and expired preauth is explicit', async (t) => {
  const { call, state, env } = setup(t);
  await call('mfa/enroll', {});
  env.DB.sql.exec('UPDATE mfa_enrollments SET expires_at=0');
  assert.equal((await (await call('mfa/state')).json()).enrollment, null);
  assert.equal((await call('mfa/enroll', {})).status, 200);
  assert.equal(state.deletes, 1);
  assert.equal((await (await call('mfa/enroll', {}, '')).json()).code, 'preauth_expired');
  state.error = { code: 'bad_jwt', status: 401 };
  assert.equal((await (await call('mfa/state')).json()).code, 'preauth_expired');
});
test('MFA upstream failures retain safe distinct codes', async (t) => {
  const { state, call } = setup(t);
  for (const [upstream, status, expected] of [
    ['mfa_challenge_expired', 422, 'mfa_challenge_expired'],
    ['mfa_factor_name_conflict', 422, 'mfa_factor_exists'],
    ['mfa_totp_enroll_not_enabled', 403, 'mfa_disabled'],
    ['invalid_upstream_response', 502, 'invalid_mfa_response'],
    ['upstream_timeout', 504, 'mfa_timeout'],
    ['unexpected_failure', 500, 'mfa_upstream_error'],
  ]) {
    state.error = { code: upstream, status };
    const result = await (await call('mfa/enroll', {})).json();
    assert.equal(result.code, expected);
    assert.ok(!JSON.stringify(result).includes('server-secret'));
  }
});

for (const [name, presentation] of [
  ['absent', {}],
  ['null', {qr_code: null, uri: null}],
  ['empty', {qr_code: '', uri: ''}],
  ['oversized image', {qr_code: 'x'.repeat(200001)}],
]) {
  test(`MFA enrollment tolerates ${name} presentation without creating duplicate factors`, async (t) => {
    const {state, call} = setup(t);
    state.enrollmentOverride = {id: fid, totp: {secret: 'JBSWY3DPEHPK3PXP', ...presentation}};
    const response = await call('mfa/enroll', {});
    assert.equal(response.status, 200);
    const enrollment = await response.json();
    assert.equal(enrollment.factorId, fid);
    assert.equal(enrollment.totp.qr_code, '');
    assert.equal(enrollment.totp.uri, '');
    assert.ok(mfaQrGeometry(enrollment.totp.uri, enrollment.totp.secret), 'accepted enrollment must generate a local QR');
    assert.deepEqual((await (await call('mfa/state')).json()).enrollment, enrollment);
    assert.deepEqual(await (await call('mfa/enroll', {})).json(), enrollment);
    assert.equal(state.posts, 1);
  });
}
for (const [name, responseBody] of [
  ['missing secret', {id: fid, totp: {}}],
  ['invalid secret', {id: fid, totp: {secret: 'not-a-valid-secret'}}],
  ['invalid factor', {id: 'invalid', totp: {secret: 'JBSWY3DPEHPK3PXP'}}],
]) {
  test(`MFA enrollment rejects ${name} without leaking response data`, async (t) => {
    const {state, call} = setup(t);
    state.enrollmentOverride = responseBody;
    const response = await call('mfa/enroll', {});
    assert.equal(response.status, 502);
    const body = await response.json();
    assert.equal(body.code, 'invalid_mfa_enrollment');
    assert.ok(!JSON.stringify(body).includes('JBSWY3DPEHPK3PXP'));
  });
}
