import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const output = await build({
  entryPoints: ['lib/atlas/admin-session-server.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const session = await import(
  'data:text/javascript;base64,' + Buffer.from(output.outputFiles[0].text).toString('base64')
);

function database() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`
    CREATE TABLE rate_buckets (
      id TEXT PRIMARY KEY NOT NULL,
      count INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
  `);
  const db = {
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
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    },
  };
  return { sql, db };
}

const refresh = 'refresh-token-admin-A';
const rotated = 'refresh-token-admin-B';
const baseNow = 1_800_000_000_000;

test('admin server gate protects every privileged API but leaves login, logout and MFA bootstrap reachable', () => {
  assert.equal(session.isProtectedAdminApi('/api/production/admin/session'), true);
  assert.equal(session.isProtectedAdminApi('/api/production/admin/dashboard'), true);
  assert.equal(session.isProtectedAdminApi('/api/production/admin/operations/overview'), true);
  assert.equal(session.isProtectedAdminApi('/api/production/admin/login'), false);
  assert.equal(session.isProtectedAdminApi('/api/production/admin/logout'), false);
  assert.equal(session.isProtectedAdminApi('/api/production/admin/mfa/state'), false);
  assert.equal(session.isProtectedAdminApi('/api/production/config'), false);
  assert.equal(session.isAdminAuthenticationCompletion('/api/production/admin/login'), true);
  assert.equal(session.isAdminAuthenticationCompletion('/api/production/admin/mfa/verify'), true);
});

test('refresh cookie and explicit user-activity signal are parsed without exposing token material', async () => {
  const request = new Request('https://atlas.test/api/production/admin/session', {
    headers: {
      cookie: `other=1; savsc_admin_refresh=${encodeURIComponent(refresh)}; x=2`,
      [session.ADMIN_ACTIVITY_HEADER]: '1',
    },
  });
  assert.equal(session.adminRefreshToken(request), refresh);
  assert.equal(session.isAdminActivityRequest(request), true);
  const key = await session.adminServerSessionKey(refresh);
  assert.match(key, /^admin-session-v1:[a-f0-9]{64}$/);
  assert.doesNotMatch(key, /refresh-token-admin/);

  const headers = new Headers();
  headers.append('Set-Cookie', 'savsc_admin_access=abc; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600');
  headers.append('Set-Cookie', `savsc_admin_refresh=${encodeURIComponent(rotated)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600`);
  const response = new Response('{}', { headers });
  assert.equal(session.adminRefreshTokenFromResponse(response), rotated);
});

test('server session starts at 15 minutes, only explicit activity extends it, and absolute lifetime is capped', async (t) => {
  const { sql, db } = database();
  t.after(() => sql.close());

  assert.equal((await session.inspectAdminServerSession(db, refresh, baseNow)).state, 'missing');
  const registered = await session.registerAdminServerSession(db, refresh, baseNow);
  assert.equal(registered.deadline, baseNow + session.ADMIN_SERVER_IDLE_MS);

  const active = await session.inspectAdminServerSession(db, refresh, baseNow + 60_000);
  assert.equal(active.state, 'active');
  assert.equal(active.deadline, registered.deadline, 'a read-only health probe must not extend inactivity');

  const touchedAt = baseNow + 5 * 60_000;
  assert.equal(await session.touchAdminServerSession(db, refresh, touchedAt), true);
  const touched = await session.inspectAdminServerSession(db, refresh, touchedAt + 1);
  assert.equal(touched.deadline, touchedAt + session.ADMIN_SERVER_IDLE_MS);

  const key = await session.adminServerSessionKey(refresh);
  sql.prepare('UPDATE rate_buckets SET count=?, expires_at=? WHERE id=?').run(
    baseNow - session.ADMIN_SERVER_ABSOLUTE_MS,
    baseNow + session.ADMIN_SERVER_IDLE_MS,
    key,
  );
  assert.equal((await session.inspectAdminServerSession(db, refresh, baseNow)).state, 'expired');
  assert.equal(sql.prepare('SELECT id FROM rate_buckets WHERE id=?').get(key), undefined);
});

test('idle expiry fails closed and removes its server-side marker', async (t) => {
  const { sql, db } = database();
  t.after(() => sql.close());
  await session.registerAdminServerSession(db, refresh, baseNow);
  const result = await session.inspectAdminServerSession(
    db,
    refresh,
    baseNow + session.ADMIN_SERVER_IDLE_MS,
  );
  assert.equal(result.state, 'expired');
  assert.equal(await session.touchAdminServerSession(db, refresh, baseNow + session.ADMIN_SERVER_IDLE_MS), false);
});

test('refresh-token rotation preserves original creation time and inactivity deadline', async (t) => {
  const { sql, db } = database();
  t.after(() => sql.close());
  await session.registerAdminServerSession(db, refresh, baseNow);
  await session.touchAdminServerSession(db, refresh, baseNow + 2 * 60_000);
  const before = await session.inspectAdminServerSession(db, refresh, baseNow + 2 * 60_000 + 1);

  await session.rotateAdminServerSession(db, refresh, rotated, baseNow + 2 * 60_000 + 2);
  assert.equal((await session.inspectAdminServerSession(db, refresh, baseNow + 2 * 60_000 + 3)).state, 'missing');
  const after = await session.inspectAdminServerSession(db, rotated, baseNow + 2 * 60_000 + 3);
  assert.equal(after.state, 'active');
  assert.equal(after.createdAt, before.createdAt);
  assert.equal(after.deadline, before.deadline);

  await session.revokeAdminServerSession(db, rotated);
  assert.equal((await session.inspectAdminServerSession(db, rotated, baseNow + 2 * 60_000 + 4)).state, 'missing');
});

test('expired response is private, neutral and clears every admin/preauth cookie', async () => {
  const request = new Request('https://atlas.test/api/production/admin/session');
  const response = session.adminSessionExpiredResponse(request);
  assert.equal(response.status, 401);
  assert.match(response.headers.get('cache-control') ?? '', /no-store/);
  const body = await response.json();
  assert.equal(body.code, 'admin_session_idle_expired');
  assert.doesNotMatch(JSON.stringify(body), /refresh-token|access-token/i);
  const cookies = response.headers.get('set-cookie') ?? '';
  for (const name of ['savsc_admin_access', 'savsc_admin_refresh', 'savsc_admin_preauth', 'savsc_admin_preauth_refresh']) {
    assert.match(cookies, new RegExp(`${name}=`));
  }
  assert.match(cookies, /Max-Age=0/);
});

test('admin UI sends server activity only from real interaction path and keeps background probe passive', () => {
  const source = readFileSync('app/admin/admin-session-guard.tsx', 'utf8');
  assert.match(source, /SERVER_ACTIVITY_THROTTLE_MS = 30_000/);
  assert.match(source, /X-SAVSC-Admin-Activity/);
  assert.match(source, /productionRequest\(\s*'\/admin\/session',\s*\{ headers: \{ \[SERVER_ACTIVITY_HEADER\]: '1' \} \}/s);
  assert.match(source, /const health = window\.setInterval\(\(\) => void probeSession\(true\), SESSION_HEALTHCHECK_MS\)/);
  assert.match(source, /including côté serveur|y compris côté serveur/);
});
