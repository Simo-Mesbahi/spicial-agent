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
      import { handleAdminOperationsApi } from './lib/atlas/admin-operations-api';
      export default { fetch(req, env) {
        if(new URL(req.url).pathname.startsWith('/api/production/admin/operations/')) return handleAdminOperationsApi(req,env);
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

test('Cloudflare: protected synthetic provider health persists its cache in D1', async () => {
  let completions = 0;
  const mf = await runtime(async req => {
    if (req.url.endsWith('/admin_me')) return Response.json({
      user_id: '00000000-0000-4000-8000-000000000900', email: 'admin@example.test', aal: 'aal2',
      memberships: [{ organization_id: organizationId, organization_name: 'Test', role: 'super_admin', display_name: null }],
    });
    assert.equal(req.url, 'https://api.openai.com/v1/chat/completions');
    completions++;
    const payload = await req.json();
    assert.equal(payload.model, 'configured-test-model');
    assert.equal(payload.max_completion_tokens, 128);
    return Response.json({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'OK' } }], usage: { prompt_tokens: 6, completion_tokens: 1 } });
  }, { LLM_PROVIDER: 'openai', OPENAI_MODEL: 'configured-test-model', OPENAI_API_KEY: 'test-key', LLM_BUDGET_MODE: 'approved' });
  try {
    const path = '/api/production/admin/operations/provider-health?organizationId=' + organizationId;
    const first = await call(mf, path, { body: {}, cookie: 'savsc_admin_access=test-token' });
    assert.equal(first.status, 200, await first.clone().text());
    assert.equal((await first.json()).status, 'healthy');
    const second = await call(mf, path, { body: {}, cookie: 'savsc_admin_access=test-token' });
    assert.equal((await second.json()).cached, true);
    assert.equal(completions, 1);
  } finally { await mf.dispose(); }
});

test('Cloudflare: structured chat persists bounded state and idempotency atomically in D1', async () => {
  let completions = 0;
  let stealLease = false;
  let db;
  const mf = await runtime(async req => {
    assert.equal(req.url, 'https://api.openai.com/v1/chat/completions');
    completions++;
    const payload = await req.json();
    assert.equal(payload.tools, undefined);
    const context = JSON.parse(payload.messages[1].content);
    if (completions > 1) assert.equal(context.session.recentTurns.length, 1);
    if (stealLease) await db.prepare("UPDATE conversation_states SET lock_id='new-owner'").run();
    return Response.json({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({
      language: 'fr', preferredResponseLanguage: null, intent: 'casual', subIntent: 'wellbeing', topic: null,
      guidance: 'none', guidancePreference: 'keep', reference: 'none', selectedCaseId: null, referencedProduct: null,
      referencesPreviousTurn: false, conversationRepair: false, requiresCase: false, requiresKnowledge: false,
      requiresClarification: false, requiresHuman: false, confidence: 0.95, style: { length: 'keep', emoji: 'keep' },
      retrievalQuery: null, response: 'Merci de demander ! Et vous ?',
    }) } }], usage: { prompt_tokens: 40, completion_tokens: 80 } });
  }, { LLM_PROVIDER: 'openai', OPENAI_MODEL: 'test-model', OPENAI_API_KEY: 'test-key', LLM_BUDGET_MODE: 'approved', LLM_ORCHESTRATOR: 'structured' });
  try {
    db = await mf.getD1Database('DB');
    const session = await call(mf, '/api/session', { body: {} });
    const cookie = session.headers.get('set-cookie').split(';')[0];
    const { space } = await session.json();
    const request = { cookie, csrf: space.csrf, body: { message: 'dis moi toi cv ?', requestId: 'worker-p1-retry' } };
    const first = await call(mf, '/api/chat', request);
    assert.equal(first.status, 200, await first.clone().text());
    const body = await first.json();
    assert.equal(body.metadata.orchestrator, 'structured');
    assert.equal(body.metadata.stateVersion, 1);
    assert.deepEqual(await (await call(mf, '/api/chat', request)).json(), body);
    assert.equal(completions, 1);
    stealLease = true;
    const failed = await call(mf, '/api/chat', { ...request, body: { message: 'suite', requestId: 'worker-p1-stale' } });
    assert.equal(failed.status, 409);
    assert.match(await failed.clone().text(), /déjà en cours|already|cours/i);
    assert.equal((await db.prepare('SELECT count(*) AS n FROM messages').first()).n, 2);
    assert.equal((await db.prepare('SELECT version FROM conversation_states').first()).version, 1);
    assert.equal((await db.prepare('SELECT count(*) AS n FROM chat_requests').first()).n, 1);
    assert.equal((await db.prepare('SELECT lock_id FROM conversation_states').first()).lock_id, 'new-owner');
  } finally { await mf.dispose(); }
});

test('Cloudflare: production chat uses authenticated Supabase snapshots and atomically persists its reply', async () => {
  const token = 'c'.repeat(64), expires_at = new Date(Date.now() + 1800000).toISOString();
  let calls = 0, revoked = false;
  const current = { ...snapshot };
  const mf = await runtime(async req => {
    const path = new URL(req.url).pathname;
    if (path.endsWith('/customer_open_case_session')) return Response.json({ access_token: token, expires_at, case: current });
    if (path.endsWith('/customer_case_snapshot')) {
      assert.equal((await req.json()).p_access_token, token);
      return revoked ? Response.json({ code: 'P0001', message: 'invalid_case_session' }, { status: 400 }) : Response.json({ expires_at, case: current });
    }
    if (path.endsWith('/customer_close_case_session')) { revoked = true; return Response.json(null); }
    if (path.endsWith('/chat/completions')) {
      calls++; current.status = 'ready'; current.version = 2;
      const understanding = { language: 'fr', preferredResponseLanguage: null, intent: 'case_lookup', subIntent: 'status', topic: 'repair', guidance: 'business_direct', guidancePreference: 'keep', reference: 'active', selectedCaseId: null, referencedProduct: null, referencesPreviousTurn: false, conversationRepair: false, requiresCase: true, requiresKnowledge: false, requiresClarification: false, requiresHuman: false, confidence: .95, style: { length: 'keep', emoji: 'keep' }, retrievalQuery: null, response: '' };
      return Response.json({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(understanding) } }], usage: { prompt_tokens: 100, completion_tokens: 70 } });
    }
    throw new Error('Unexpected outbound request: ' + path);
  }, { LLM_ORCHESTRATOR: 'structured', LLM_PROVIDER: 'openai', LLM_BUDGET_MODE: 'approved', OPENAI_MODEL: 'test-model', OPENAI_API_KEY: 'test-key' });
  try {
    const verified = await call(mf, '/api/production/cases/verify', { body: { reference: snapshot.reference, code: '123456' } });
    assert.equal(verified.status, 200);
    const cookie = verified.headers.get('set-cookie').split(';')[0];
    const state = await (await call(mf, '/api/production/chat', { cookie })).json();
    const body = { message: 'Où en est ma réparation ?', requestId: crypto.randomUUID() };
    const response = await call(mf, '/api/production/chat', { cookie, csrf: state.csrf, body });
    const reply = await response.json();
    assert.equal(response.status, 200, JSON.stringify(reply)); assert.match(reply.content, /retrait/);
    assert.equal(reply.metadata.caseEvidence.version, 2);
    assert.equal(reply.metadata.fallback, null);
    assert.equal(reply.metadata.plan, 'case');
    const replay = await (await call(mf, '/api/production/chat', { cookie, csrf: state.csrf, body })).json();
    assert.equal(replay.id, reply.id); assert.equal(calls, 1);
    const db = await mf.getD1Database('DB');
    assert.equal((await db.prepare('SELECT count(*) n FROM cases').first()).n, 0);
    assert.equal((await db.prepare('SELECT count(*) n FROM messages').first()).n, 2);
    assert.equal((await call(mf, '/api/production/cases/current', { method: 'DELETE', cookie })).status, 200);
    assert.equal((await db.prepare('SELECT count(*) n FROM messages').first()).n, 0);
    assert.equal((await call(mf, '/api/production/chat', { cookie })).status, 401);
  } finally { await mf.dispose(); }
});

test('Cloudflare: authenticated production chat uses hybrid evidence with one completion and one embedding', async () => {
  const token = 'd'.repeat(64),
    expires_at = new Date(Date.now() + 1800000).toISOString();
  const content = 'Le retour doit être examiné selon la procédure publiée.';
  const contentHash = Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content))),
    (x) => x.toString(16).padStart(2, '0'),
  ).join('');
  let completions = 0,
    embeddings = 0;
  const mf = await runtime(
    async (req) => {
      const path = new URL(req.url).pathname;
      if (path.endsWith('/customer_open_case_session'))
        return Response.json({ access_token: token, expires_at, case: snapshot });
      if (path.endsWith('/customer_case_snapshot'))
        return Response.json({ expires_at, case: snapshot });
      if (path.endsWith('/chat/completions')) {
        completions++;
        const u = {
          language: 'fr',
          preferredResponseLanguage: null,
          intent: 'information',
          subIntent: 'procedure',
          topic: 'return',
          guidance: 'business_direct',
          guidancePreference: 'keep',
          reference: 'none',
          selectedCaseId: null,
          referencedProduct: null,
          referencesPreviousTurn: false,
          conversationRepair: false,
          requiresCase: false,
          requiresKnowledge: true,
          requiresClarification: false,
          requiresHuman: false,
          confidence: 0.95,
          style: { length: 'keep', emoji: 'keep' },
          retrievalQuery: 'retour sans emballage',
          response: '',
        };
        return Response.json({
          choices: [
            { finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(u) } },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 80 },
        });
      }
      if (path.endsWith('/embeddings')) {
        embeddings++;
        return Response.json({
          data: [{ index: 0, embedding: [1, ...Array(767).fill(0)] }],
          usage: { prompt_tokens: 7 },
        });
      }
      if (path.endsWith('/knowledge_hybrid_candidates')) {
        const body = await req.json();
        assert.equal(body.p_organization_id, organizationId);
        assert.equal(body.p_locale, 'fr-FR');
        assert.ok(body.p_embedding);
        return Response.json([
          {
            organization_id: organizationId,
            document_id: '00000000-0000-4000-8000-000000000701',
            series_id: '00000000-0000-4000-8000-000000000701',
            revision: 1,
            status: 'published',
            chunk_id: '00000000-0000-4000-8000-000000000702',
            title: 'Politique de retour',
            category: 'Service client',
            version: '1',
            locale: 'fr-FR',
            market: 'GLOBAL',
            effective_from: null,
            effective_until: null,
            chunk_ordinal: 0,
            content,
            content_hash: contentHash,
            channel: 'vector',
            rank: 0.95,
          },
        ]);
      }
      throw new Error('Unexpected request ' + path);
    },
    {
      LLM_ORCHESTRATOR: 'structured',
      LLM_PROVIDER: 'openai',
      LLM_BUDGET_MODE: 'approved',
      OPENAI_MODEL: 'test-model',
      OPENAI_API_KEY: 'test-key',
      RAG_MODE: 'hybrid',
      EMBEDDING_PROVIDER: 'openai',
      EMBEDDING_MODEL: 'text-embedding-3-small',
      EMBEDDING_API_KEY: 'embedding-test-key',
    },
  );
  try {
    const verified = await call(mf, '/api/production/cases/verify', {
      body: { reference: snapshot.reference, code: '123456' },
    });
    assert.equal(verified.status, 200);
    const cookie = verified.headers.get('set-cookie').split(';')[0];
    const state = await (await call(mf, '/api/production/chat', { cookie })).json();
    const body = { message: 'Puis-je retourner sans la boîte ?', requestId: crypto.randomUUID() };
    const response = await call(mf, '/api/production/chat', { cookie, csrf: state.csrf, body });
    const reply = await response.json();
    assert.equal(response.status, 200, JSON.stringify(reply));
    assert.equal(reply.metadata.fallback, null);
    assert.equal(reply.metadata.plan, 'knowledge');
    assert.match(
      reply.content,
      /procédure publiée/,
      JSON.stringify({ reply, embeddings, completions }),
    );
    assert.equal(reply.metadata.sources[0].id, '00000000-0000-4000-8000-000000000701');
    assert.equal(
      (await call(mf, '/api/production/chat', { cookie, csrf: state.csrf, body })).status,
      200,
    );
    assert.equal(completions, 1);
    assert.equal(embeddings, 1);
  } finally {
    await mf.dispose();
  }
});

test('Cloudflare: shadow drafting respects D1 budget, refreshes access and never releases generated claims', async () => {
  const token = 'e'.repeat(64),
    expires_at = new Date(Date.now() + 1800000).toISOString();
  const current = { ...snapshot };
  let completions = 0;
  const mf = await runtime(
    async (req) => {
      const path = new URL(req.url).pathname;
      if (path.endsWith('/customer_open_case_session'))
        return Response.json({ access_token: token, expires_at, case: current });
      if (path.endsWith('/customer_case_snapshot'))
        return Response.json({ expires_at, case: current });
      if (path.endsWith('/chat/completions')) {
        completions++;
        const payload = await req.json();
        let output;
        if (payload.response_format?.json_schema?.name === 'natural_response_draft') {
          assert.equal(payload.tools, undefined);
          assert.equal(payload.max_completion_tokens, 900);
          current.status = 'ready';
          current.version = 2;
          output = {
            language: 'fr',
            sentences: [
              {
                text: 'UNVERIFIED remboursement de 9999 euros effectué.',
                evidenceRefs: ['case.refund'],
              },
            ],
          };
        } else
          output = {
            language: 'fr',
            preferredResponseLanguage: null,
            intent: 'case_lookup',
            subIntent: 'status',
            topic: 'repair',
            guidance: 'business_direct',
            guidancePreference: 'keep',
            reference: 'active',
            selectedCaseId: null,
            referencedProduct: null,
            referencesPreviousTurn: false,
            conversationRepair: false,
            requiresCase: true,
            requiresKnowledge: false,
            requiresClarification: false,
            requiresHuman: false,
            confidence: 0.95,
            style: { length: 'keep', emoji: 'keep' },
            retrievalQuery: null,
            response: '',
          };
        return Response.json({
          choices: [
            {
              finish_reason: 'stop',
              message: { role: 'assistant', content: JSON.stringify(output) },
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
        });
      }
      throw new Error('Unexpected request ' + path);
    },
    {
      LLM_ORCHESTRATOR: 'structured',
      LLM_PROVIDER: 'openai',
      LLM_BUDGET_MODE: 'approved',
      OPENAI_MODEL: 'test-model',
      OPENAI_API_KEY: 'test-key',
      LLM_GENERATION_MODE: 'shadow',
      LLM_GENERATION_DAILY_LIMIT: '1',
    },
  );
  try {
    const verified = await call(mf, '/api/production/cases/verify', {
      body: { reference: snapshot.reference, code: '123456' },
    });
    assert.equal(verified.status, 200);
    const cookie = verified.headers.get('set-cookie').split(';')[0];
    const state = await (await call(mf, '/api/production/chat', { cookie })).json();
    const body = { message: 'Où en est ma réparation ?', requestId: crypto.randomUUID() };
    const res = await call(mf, '/api/production/chat', { cookie, csrf: state.csrf, body });
    const reply = await res.json();
    assert.equal(res.status, 200, JSON.stringify(reply));
    assert.match(reply.content, /retrait/);
    assert.doesNotMatch(JSON.stringify(reply), /UNVERIFIED|9999 euros/);
    assert.equal(reply.metadata.generation.outcome, 'candidate_generated');
    assert.equal(reply.metadata.generation.released, false);
    assert.equal(reply.metadata.caseEvidence.version, 2);
    assert.equal(reply.metadata.providerCalls, 2);
    assert.deepEqual(
      await (await call(mf, '/api/production/chat', { cookie, csrf: state.csrf, body })).json(),
      reply,
    );
    assert.equal(completions, 2);
    const db = await mf.getD1Database('DB');
    assert.equal(
      (
        await db
          .prepare('SELECT count FROM rate_buckets WHERE id=?')
          .bind('generation:' + organizationId)
          .first()
      ).count,
      1,
    );
    assert.doesNotMatch(
      JSON.stringify(await db.prepare('SELECT content,metadata FROM messages').all()),
      /UNVERIFIED|9999 euros/,
    );
  } finally {
    await mf.dispose();
  }
});

test('Cloudflare: factual audit refreshes after the judge and invalidates changed evidence', async () => {
  const token = 'e'.repeat(64),
    expires_at = new Date(Date.now() + 1800000).toISOString();
  const current = { ...snapshot };
  let completions = 0;
  const mf = await runtime(
    async (req) => {
      const path = new URL(req.url).pathname;
      if (path.endsWith('/customer_open_case_session'))
        return Response.json({ access_token: token, expires_at, case: current });
      if (path.endsWith('/customer_case_snapshot'))
        return Response.json({ expires_at, case: current });
      if (path.endsWith('/chat/completions')) {
        completions++;
        const payload = await req.json();
        let output;
        if (payload.response_format?.json_schema?.name === 'natural_response_draft') {
          assert.equal(payload.tools, undefined);
          assert.equal(payload.max_completion_tokens, 900);
          output = {
            language: 'fr',
            sentences: [
              {
                text: 'UNVERIFIED remboursement de 9999 euros effectué.',
                evidenceRefs: ['case.refund'],
              },
            ],
          };
        } else if (payload.response_format?.json_schema?.name === 'factual_validation') {
          assert.equal(payload.max_completion_tokens, 1200);
          assert.equal(payload.tools, undefined);
          current.status = 'ready'; current.version = 2;
          output = { language: 'fr', sentences: [{ index: 0, kind: 'factual', verdict: 'supported', issues: [], citations: [{ ref: 'case.refund', quote: 'null' }] }] };
        } else
          output = {
            language: 'fr',
            preferredResponseLanguage: null,
            intent: 'case_lookup',
            subIntent: 'status',
            topic: 'repair',
            guidance: 'business_direct',
            guidancePreference: 'keep',
            reference: 'active',
            selectedCaseId: null,
            referencedProduct: null,
            referencesPreviousTurn: false,
            conversationRepair: false,
            requiresCase: true,
            requiresKnowledge: false,
            requiresClarification: false,
            requiresHuman: false,
            confidence: 0.95,
            style: { length: 'keep', emoji: 'keep' },
            retrievalQuery: null,
            response: '',
          };
        return Response.json({
          choices: [
            {
              finish_reason: 'stop',
              message: { role: 'assistant', content: JSON.stringify(output) },
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
        });
      }
      throw new Error('Unexpected request ' + path);
    },
    {
      LLM_ORCHESTRATOR: 'structured',
      LLM_PROVIDER: 'openai',
      LLM_BUDGET_MODE: 'approved',
      OPENAI_MODEL: 'test-model',
      OPENAI_API_KEY: 'test-key',
      LLM_GENERATION_MODE: 'shadow',
      LLM_GENERATION_DAILY_LIMIT: '1',
      LLM_VALIDATION_MODE: 'shadow',
      LLM_VALIDATION_DAILY_LIMIT: '1',
    },
  );
  try {
    const verified = await call(mf, '/api/production/cases/verify', {
      body: { reference: snapshot.reference, code: '123456' },
    });
    assert.equal(verified.status, 200);
    const cookie = verified.headers.get('set-cookie').split(';')[0];
    const state = await (await call(mf, '/api/production/chat', { cookie })).json();
    const body = { message: 'Où en est ma réparation ?', requestId: crypto.randomUUID() };
    const res = await call(mf, '/api/production/chat', { cookie, csrf: state.csrf, body });
    const reply = await res.json();
    assert.equal(res.status, 200, JSON.stringify(reply));
    assert.match(reply.content, /retrait/);
    assert.doesNotMatch(JSON.stringify(reply), /UNVERIFIED|9999 euros/);
    assert.equal(reply.metadata.generation.outcome, 'candidate_generated');
    assert.equal(reply.metadata.generation.released, false);
    assert.deepEqual(reply.metadata.validation, { outcome: 'blocked', released: false });
    assert.equal(reply.metadata.caseEvidence.version, 2);
    assert.equal(reply.metadata.providerCalls, 3);
    assert.deepEqual(
      await (await call(mf, '/api/production/chat', { cookie, csrf: state.csrf, body })).json(),
      reply,
    );
    assert.equal(completions, 3);
    const db = await mf.getD1Database('DB');
    assert.equal(
      (
        await db
          .prepare('SELECT count FROM rate_buckets WHERE id=?')
          .bind('validation:' + organizationId)
          .first()
      ).count,
      1,
    );
    assert.doesNotMatch(
      JSON.stringify(await db.prepare('SELECT content,metadata FROM messages').all()),
      /UNVERIFIED|9999 euros/,
    );
  } finally {
    await mf.dispose();
  }
});
