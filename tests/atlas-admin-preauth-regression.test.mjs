import { test } from 'node:test';
import assert from 'node:assert/strict';
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

test('background admin session expiry never destroys an in-progress MFA preauth flow', async () => {
  const request = new Request('https://atlas.test/api/production/admin/session', {
    headers: {
      cookie: 'savsc_admin_preauth=preauth-access; savsc_admin_preauth_refresh=preauth-refresh',
    },
  });

  const response = session.adminSessionExpiredResponse(request);
  assert.equal(response.status, 401);
  const cookies = response.headers.get('set-cookie') ?? '';

  assert.match(cookies, /savsc_admin_access=/);
  assert.match(cookies, /savsc_admin_refresh=/);
  assert.doesNotMatch(cookies, /savsc_admin_preauth=/);
  assert.doesNotMatch(cookies, /savsc_admin_preauth_refresh=/);

  const body = await response.json();
  assert.equal(body.code, 'admin_session_idle_expired');
});

test('hard authentication cleanup still clears both admin and preauth credentials', () => {
  const request = new Request('https://atlas.test/api/production/admin/session');
  const upstream = new Response('{}', { status: 401, headers: { 'content-type': 'application/json' } });
  const response = session.withClearedAdminCookies(request, upstream);
  const cookies = response.headers.get('set-cookie') ?? '';

  for (const name of [
    'savsc_admin_access',
    'savsc_admin_refresh',
    'savsc_admin_preauth',
    'savsc_admin_preauth_refresh',
  ]) {
    assert.match(cookies, new RegExp(`${name}=`));
  }
});
