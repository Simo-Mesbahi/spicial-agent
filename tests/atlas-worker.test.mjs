import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

// Run the application transports in workerd, not a replacement global fetch.
// Only the remote services are simulated. No real key, email or paid call.
const bundled = await build({
  stdin: {
    resolveDir: process.cwd(),
    contents: `
      import { handleProductionApi } from './lib/atlas/production-api';
      import { handleApi } from './lib/atlas/api';
      export default { fetch(req, env) {
        return new URL(req.url).pathname.startsWith('/api/production/')
          ? handleProductionApi(req, env) : handleApi(req, env);
      }};`,
  },
  bundle: true, format: 'esm', write: false,
});
const organizationId = '00000000-0000-4000-8000-000000000001';
const settings = {
  APP_EDITION: 'internal',
  SUPABASE_URL: 'https://fixture.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_worker-fixture',
  SUPABASE_SECRET_KEY: 'sb_secret_worker-fixture',
  SUPABASE_ORGANIZATION_ID: organizationId,
};
async function runtime(outboundService, overrides = {}) {
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true, script: bundled.outputFiles[0].text,
    compatibilityDate: '2026-08-01', compatibilityFlags: ['nodejs_compat'],
    bindings: { ...settings, ...overrides }, d1Databases: ['DB'], outboundService,
  }));
  try {
    const db = await mf.getD1Database('DB');
    for (const file of (await readdir('drizzle')).filter(f => f.endsWith('.sql')).sort()) {
      const sql = await readFile(`drizzle/${file}`, 'utf8');
      for (const statement of sql.split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean))
        await db.prepare(statement).run();
    }
    return mf;
  } catch (error) { await mf.dispose(); throw error; }
}
function call(mf, path, { body, cookie = '', csrf = '', method } = {}) {
  return mf.dispatchFetch('https://app.example' + path, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: {
      Origin: 'https://app.example', 'Content-Type': 'application/json',
      Cookie: cookie, 'x-atlas-csrf': csrf,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const snapshot = {
  id: '00000000-0000-4000-8000-000000000401', reference: 'SAV-2026-1042',
  kind: 'repair', title: 'Réparation de test', description: 'Diagnostic enregistré',
  status: 'diagnosis', warranty_status: 'covered', warranty_label: 'Sous garantie',
  quote_cents: null, refund_cents: null, currency: 'EUR', delivery_mode: null,
  estimated_at: null, version: 1, updated_at: '2026-09-10T09:00:00Z',
  product: null, store: null, events: [],
};

test('Cloudflare: health reaches Auth and PostgREST with valid HTTP requests', async () => {
  const calls = [];
  const mf = await runtime(async req => {
    calls.push(new URL(req.url).pathname);
    const isAuth = req.url.includes('/auth/');
    assert.equal(req.headers.get('apikey'), isAuth ? settings.SUPABASE_PUBLISHABLE_KEY : settings.SUPABASE_SECRET_KEY);
    return Response.json(isAuth ? { version: 'test' } : [{ id: organizationId, active: true }]);
  });
  try {
    const response = await call(mf, '/api/production/health');
    assert.equal(response.status, 200);
    assert.equal((await response.json()).database, 'reachable');
    assert.deepEqual(calls.sort(), ['/auth/v1/health', '/rest/v1/organizations']);
  } finally { await mf.dispose(); }
});

test('Cloudflare: reference/code verification, cookie reuse, denial and session closing', async () => {
  const expires = new Date(Date.now() + 20 * 60_000).toISOString();
  const mf = await runtime(async req => {
    assert.equal(req.headers.get('apikey'), settings.SUPABASE_SECRET_KEY);
    const body = await req.json();
    if (req.url.endsWith('/customer_open_case_session')) {
      if (body.p_code !== '482731') return Response.json({ error: 'invalid_case_credentials' });
      return Response.json({ access_token: 'a'.repeat(64), expires_at: expires, case: snapshot });
    }
    assert.equal(body.p_access_token, 'a'.repeat(64));
    if (req.url.endsWith('/customer_case_snapshot')) return Response.json({ expires_at: expires, case: snapshot });
    if (req.url.endsWith('/customer_close_case_session')) return Response.json({ ok: true });
    throw new Error('Unexpected RPC');
  });
  try {
    const denied = await call(mf, '/api/production/cases/verify', { body: { reference: snapshot.reference, code: '111111' } });
    assert.equal(denied.status, 403);
    const opened = await call(mf, '/api/production/cases/verify', { body: { reference: snapshot.reference, code: '482731' } });
    assert.equal(opened.status, 200, await opened.clone().text());
    const visible = await opened.text();
    assert.ok(visible.includes(snapshot.reference));
    assert.doesNotMatch(visible, /482731|a{64}|sb_secret/);
    const header = opened.headers.get('set-cookie');
    assert.match(header, /HttpOnly.*SameSite=Strict.*Secure/);
    const cookie = header.split(';')[0];
    assert.equal((await call(mf, '/api/production/cases/current', { cookie })).status, 200);
    const closed = await call(mf, '/api/production/cases/current', { cookie, method: 'DELETE' });
    assert.equal(closed.status, 200);
    assert.match(closed.headers.get('set-cookie'), /Max-Age=0/);
  } finally { await mf.dispose(); }
});

test('Cloudflare: administrator sign-in stops at MFA and never returns session tokens', async () => {
  const token = 'eyJhbGciOiJub25lIn0.' + Buffer.from('{"aal":"aal1"}').toString('base64url') + '.fixture-signature';
  const mf = await runtime(async req => {
    if (req.url.includes('/auth/v1/token')) return Response.json({
      access_token: token, refresh_token: 'r'.repeat(48), expires_in: 3600,
      user: { id: snapshot.id, email: 'admin@example.invalid', factors: [] },
    });
    assert.equal(req.headers.get('authorization'), 'Bearer ' + token);
    return Response.json({ user_id: snapshot.id, email: 'admin@example.invalid', aal: 'aal1', memberships: [{
      organization_id: organizationId, organization_name: 'Test', role: 'super_admin', display_name: 'Test',
    }] });
  });
  try {
    const response = await call(mf, '/api/production/admin/login', { body: { email: 'admin@example.invalid', password: 'fixture-password-only' } });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.status, 'mfa_required');
    assert.equal(data.enrollmentRequired, true);
    assert.doesNotMatch(JSON.stringify(data), /fixture-signature|rrrrr/);
    assert.match(response.headers.get('set-cookie'), /savsc_admin_preauth=/);
    assert.equal((await call(mf, '/api/production/admin/session')).status, 401);
  } finally { await mf.dispose(); }
});

test('Cloudflare: Supabase redirects are rejected without forwarding credentials', async () => {
  const calls = [];
  const mf = await runtime(async req => {
    calls.push(req.url);
    assert.equal(new URL(req.url).hostname, 'fixture.supabase.co');
    return new Response(null, { status: 307, headers: { Location: 'https://external.example/collect' } });
  });
  try {
    const response = await call(mf, '/api/production/health');
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, 'data_unavailable');
    assert.equal(calls.length, 2);
    assert.ok(calls.every(url => !url.includes('external.example')));
  } finally { await mf.dispose(); }
});

for (const redirect of [false, true]) test(`Cloudflare: Gemini ${redirect ? 'blocks redirects and labels the fallback' : 'completes the authorized tool loop'}`, async () => {
  const calls = [];
  const mf = await runtime(async req => {
    assert.equal(req.url, 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
    assert.equal(req.headers.get('authorization'), 'Bearer fixture-gemini-key');
    calls.push(await req.json());
    if (redirect) return new Response(null, { status: 302, headers: { Location: 'https://external.example/collect' } });
    return Response.json({ choices: [{ message: calls.length === 1
      ? { role: 'assistant', content: null, tool_calls: [{ id: 'case-fixture', function: { name: 'get_case', arguments: '{}' } }] }
      : { role: 'assistant', content: 'Je consulte uniquement le dossier autorisé.' },
    }], usage: { prompt_tokens: 12, completion_tokens: 8 } });
  }, { LLM_PROVIDER: 'gemini', LLM_BUDGET_MODE: 'free', GEMINI_API_KEY: 'fixture-gemini-key' });
  try {
    const session = await call(mf, '/api/session', { body: {} });
    assert.equal(session.status, 201);
    const cookie = session.headers.get('set-cookie').split(';')[0];
    const data = await session.json(), csrf = data.space.csrf, row = data.cases[0];
    assert.equal((await call(mf, '/api/verify', { cookie, csrf, body: { reference: row.reference, code: row.demoCode } })).status, 200);
    const reply = await call(mf, '/api/chat', { cookie, csrf, body: { caseId: row.id, message: 'Où en est mon dossier ?' } });
    assert.equal(reply.status, 200);
    const result = await reply.json();
    assert.equal(result.metadata.mode, redirect ? 'demo' : 'gemini');
    if (redirect) assert.equal(result.metadata.fallback, 'provider_unavailable');
    assert.equal(calls.length, redirect ? 1 : 2);
    assert.doesNotMatch(JSON.stringify(calls), new RegExp(row.demoCode));
  } finally { await mf.dispose(); }
});
