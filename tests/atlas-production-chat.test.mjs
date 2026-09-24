import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { database } from './helpers/atlas-fixture.mjs';
const bundle = await build({
  stdin: {
    contents: `export {handleProductionApi} from './lib/atlas/production-api'; export * from './lib/atlas/case-adapter'; export {renderCaseFacts} from './lib/atlas/case-facts-renderer'; export {createReleaseAttestation} from './lib/atlas/p1-release-attestation';`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { handleProductionApi, productionCaseAdapter, normalizeCase, renderCaseFacts, createReleaseAttestation } = await import(
  'data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64')
);
const org = '00000000-0000-4000-8000-000000000001';
const caseId = '00000000-0000-4000-8000-000000000401';
const snapshot = {
  id: caseId,
  reference: 'SAV-2026-1042',
  kind: 'repair',
  title: 'Réparation',
  description: 'PRIVATE DESCRIPTION',
  status: 'diagnosis',
  warranty_status: 'covered',
  warranty_label: 'Sous garantie',
  quote_cents: 12345,
  refund_cents: null,
  currency: 'USD',
  delivery_mode: null,
  estimated_at: null,
  version: 1,
  updated_at: '2026-09-10T09:00:00Z',
  product: { name: 'Télévision', category: null, sku: 'PRIVATE SKU' },
  store: null,
  events: [],
};
const output = (changes = {}) => ({
  language: 'fr',
  preferredResponseLanguage: null,
  intent: 'casual',
  subIntent: 'wellbeing',
  topic: null,
  guidance: 'none',
  guidancePreference: 'keep',
  reference: 'none',
  selectedCaseId: null,
  referencedProduct: null,
  referencesPreviousTurn: false,
  conversationRepair: false,
  requiresCase: false,
  requiresKnowledge: false,
  requiresClarification: false,
  requiresHuman: false,
  confidence: 0.95,
  style: { length: 'keep', emoji: 'keep' },
  retrievalQuery: null,
  response: 'Ça va bien merci ! Et vous ?',
  ...changes,
});
const lookup = () =>
  output({
    intent: 'case_lookup',
    subIntent: 'status',
    requiresCase: true,
    reference: 'active',
    response: '',
    guidance: 'business_direct',
  });
async function setup(t, overrides = {}) {
  const db = database();
  t.after(() => db.sql.close());
  const env = {
    DB: db,
    APP_EDITION: 'internal',
    SUPABASE_URL: 'https://fixture.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
    SUPABASE_SECRET_KEY: 'sb_secret_test',
    SUPABASE_ORGANIZATION_ID: org,
    LLM_PROVIDER: 'openai',
    OPENAI_MODEL: 'test-model',
    OPENAI_API_KEY: 'test-secret',
    LLM_BUDGET_MODE: 'approved',
    LLM_ORCHESTRATOR: 'structured',
    ...overrides,
  };
  const remote = {
    token: 'a'.repeat(64),
    expires_at: new Date(Date.now() + 1800000).toISOString(),
    case: structuredClone(snapshot),
    providerCalls: 0,
    reads: 0,
    output: lookup(),
    providerStatus: 200,
    afterProvider: () => {},
    prompts: [],
    revoked: false,
    knowledgeRows: [],
    revalidationRows: null,
    afterKnowledgeRevalidation: () => {},
    afterGeneration: () => {},
    generationOutput: {
      language: 'fr',
      sentences: [
        {
          text: 'UNVERIFIED remboursement de 9999 euros effectué demain.',
          evidenceRefs: ['case.refund'],
        },
      ],
    },
    generationOutputs: null,
    generationStatus: 200,
    afterValidation: () => {},
    validationStatus: 200,
    validationOutput: {
      language: 'fr',
      sentences: [
        {
          index: 0,
          kind: 'factual',
          verdict: 'unsupported',
          issues: ['amount', 'action'],
          citations: [],
        },
      ],
    },
    logs: [],
  };
  t.mock.method(console, 'info', (...args) => {
    remote.logs.push(args);
  });
  t.mock.method(console, 'error', () => {});
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    const path = new URL(url instanceof Request ? url.url : url).pathname;
    const body = JSON.parse(init.body ?? '{}');
    if (path.endsWith('/customer_open_case_session')) {
      assert.equal(body.p_organization_id, org);
      return Response.json({
        access_token: remote.token,
        expires_at: remote.expires_at,
        case: remote.case,
      });
    }
    if (path.endsWith('/customer_case_snapshot')) {
      remote.reads++;
      assert.equal(body.p_access_token, remote.token);
      return remote.revoked
        ? Response.json({ code: 'P0001', message: 'invalid_case_session' }, { status: 400 })
        : Response.json({ expires_at: remote.expires_at, case: remote.case });
    }
    if (path.endsWith('/customer_close_case_session')) {
      remote.revoked = true;
      return Response.json(null);
    }
    if (path.endsWith('/knowledge_search')) {
      assert.equal(body.p_organization_id, org);
      return Response.json(remote.knowledgeRows);
    }
    if (path.endsWith('/knowledge_revalidate_sources')) {
      assert.equal(body.p_organization_id, org);
      await remote.afterKnowledgeRevalidation();
      const rows =
        remote.revalidationRows ??
        remote.knowledgeRows.map((row) => ({
          document_id: row.document_id,
          chunk_id: row.chunk_id,
          version: row.version,
          revision: row.revision ?? 1,
          locale: row.locale,
          market: row.market,
          effective_from: row.effective_from,
          effective_until: row.effective_until,
          content: row.content,
        }));
      return Response.json(rows);
    }
    if (path.endsWith('/chat/completions')) {
      remote.providerCalls++;
      remote.prompts.push(body);
      if (body.response_format?.json_schema?.name === 'factual_validation') {
        await remote.afterValidation();
        if (remote.validationStatus !== 200)
          return Response.json(
            { error: { message: 'PRIVATE AUDIT ERROR' } },
            { status: remote.validationStatus },
          );
        return Response.json({
          choices: [
            {
              finish_reason: 'stop',
              message: { role: 'assistant', content: JSON.stringify(remote.validationOutput) },
            },
          ],
          usage: { prompt_tokens: 90, completion_tokens: 30 },
        });
      }
      if (body.response_format?.json_schema?.name === 'natural_response_draft') {
        await remote.afterGeneration();
        if (remote.generationStatus !== 200)
          return Response.json(
            { error: { message: 'PRIVATE DRAFT ERROR' } },
            { status: remote.generationStatus },
          );
        const generationOutput =
          Array.isArray(remote.generationOutputs) && remote.generationOutputs.length
            ? remote.generationOutputs.shift()
            : remote.generationOutput;
        return Response.json({
          choices: [
            {
              finish_reason: 'stop',
              message: { role: 'assistant', content: JSON.stringify(generationOutput) },
            },
          ],
          usage: { prompt_tokens: 80, completion_tokens: 25 },
        });
      }
      await remote.afterProvider();
      if (remote.providerStatus !== 200)
        return Response.json(
          { error: { message: 'PRIVATE UPSTREAM', code: 'rate_limit_exceeded' } },
          { status: remote.providerStatus },
        );
      return Response.json({
        choices: [
          {
            finish_reason: 'stop',
            message: { role: 'assistant', content: JSON.stringify(remote.output) },
          },
        ],
        usage: { prompt_tokens: 120, completion_tokens: 80 },
      });
    }
    throw new Error('Unexpected outbound request: ' + path);
  });
  let cookie = '',
    csrf = '';
  const call = async (path, body, options = {}) => {
    const res = await handleProductionApi(
      new Request('https://atlas.test/api/production/' + path, {
        method: options.method ?? (body === undefined ? 'GET' : 'POST'),
        headers: {
          origin: 'https://atlas.test',
          'content-type': 'application/json',
          cookie,
          'x-atlas-csrf': csrf,
          ...options.headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      env,
    );
    const data = await res.json();
    if (res.headers.get('set-cookie')) cookie = res.headers.get('set-cookie').split(';')[0];
    if (data.csrf) csrf = data.csrf;
    return { status: res.status, data, headers: res.headers };
  };
  const verify = await call('cases/verify', { reference: snapshot.reference, code: '123456' });
  assert.equal(verify.status, 200, JSON.stringify(verify.data));
  if (env.LLM_ORCHESTRATOR === 'structured') assert.equal((await call('chat')).status, 200);
  return {
    db,
    env,
    remote,
    call,
    get cookie() {
      return cookie;
    },
    get csrf() {
      return csrf;
    },
  };
}
const question = (message = 'Où en est ma télé ?', requestId = crypto.randomUUID()) => ({
  message,
  requestId,
});

test('Production chat rereads Supabase after understanding, preserves currency and stores no demo case', async (t) => {
  const c = await setup(t);
  c.remote.afterProvider = () => {
    c.remote.case.status = 'ready';
    c.remote.case.version = 2;
  };
  const result = await c.call('chat', question());
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.match(result.data.content, /retrait/);
  assert.match(result.data.content, /123,45/);
  assert.doesNotMatch(result.data.content, /€|démonstration|PRIVATE/);
  assert.equal(result.data.metadata.caseEvidence.version, 2);
  assert.equal(result.data.metadata.evidence.caseVersion, 2);
  assert.ok(result.data.metadata.evidence.unknowns.includes('confirmed_eta'));
  assert.equal(result.data.metadata.evidence.completedActionCount, 0);
  assert.equal(result.data.evidencePack, undefined);
  assert.equal(result.data.metadata.evidencePack, undefined);
  assert.equal(result.data.metadata.inputTokens, 120);
  assert.equal(result.data.metadata.outputTokens, 80);
  assert.equal(result.data.metadata.fallback, null);
  assert.equal(c.remote.providerCalls, 1);
  assert.equal(c.db.sql.prepare('SELECT count(*) n FROM cases').get().n, 0);
  assert.doesNotMatch(
    JSON.stringify(c.remote.prompts),
    /sb_secret|test-secret|PRIVATE DESCRIPTION|PRIVATE SKU/,
  );
  assert.ok(!JSON.stringify(c.remote.prompts).includes(c.remote.token));
  assert.equal((await c.call('chat')).data.messages.length, 2);
});

test('Production request retries reuse a completed reply without a second paid call', async (t) => {
  const c = await setup(t);
  const q = question();
  const first = await c.call('chat', q);
  const second = await c.call('chat', q);
  assert.equal(first.status, 200);
  assert.deepEqual(second.data, first.data);
  assert.equal(c.remote.providerCalls, 1);
  assert.equal((await c.call('chat', { ...q, message: 'Autre question' })).status, 409);
  c.remote.revoked = true;
  assert.equal((await c.call('chat', q)).status, 401);
});

for (const intent of ['casual', 'case_lookup'])
  test(`Revocation during ${intent} never releases or stores a response`, async (t) => {
    const c = await setup(t);
    c.remote.output = intent === 'casual' ? output() : lookup();
    c.remote.afterProvider = () => {
      c.remote.revoked = true;
    };
    const result = await c.call('chat', question());
    assert.equal(result.status, 401);
    assert.equal(c.remote.providerCalls, 1);
    assert.equal(c.db.sql.prepare('SELECT count(*) n FROM messages').get().n, 0);
    assert.equal(c.db.sql.prepare('SELECT count(*) n FROM chat_requests').get().n, 0);
  });

test('Organization and case bindings reject lateral access before returning facts', async (t) => {
  const c = await setup(t);
  const adapter = await productionCaseAdapter(c.env, c.remote.token);
  await assert.rejects(
    adapter.read('00000000-0000-4000-8000-000000000402'),
    (e) => e.status === 403,
  );
  await assert.rejects(
    productionCaseAdapter(
      { ...c.env, SUPABASE_ORGANIZATION_ID: '00000000-0000-4000-8000-000000000002' },
      c.remote.token,
    ),
    (e) => e.status === 401,
  );
  c.remote.case.id = '00000000-0000-4000-8000-000000000402';
  assert.equal((await c.call('chat', question())).status, 403);
  assert.equal(c.remote.providerCalls, 0);
});

test('Strict body, CSRF, same origin and foreign reference checks prevent provider spend', async (t) => {
  const c = await setup(t);
  assert.equal((await c.call('chat', { ...question(), caseId })).status, 400);
  assert.equal(
    (await c.call('chat', question(), { headers: { 'x-atlas-csrf': 'wrong' } })).status,
    403,
  );
  assert.equal(
    (await c.call('chat', question(), { headers: { origin: 'https://evil.test' } })).status,
    403,
  );
  assert.equal((await c.call('chat', question('SAV-2026-9999'))).status, 403);
  assert.equal(c.remote.providerCalls, 0);
});

test('Production chat accepts the exact configured public origin behind a host-rewriting proxy', async (t) => {
  const publicOrigin = 'https://support.example.com';
  const c = await setup(t, {
    APP_ENVIRONMENT: 'LOCAL',
    APP_PUBLIC_ORIGIN: publicOrigin,
  });

  const accepted = await handleProductionApi(
    new Request('http://127.0.0.1:5173/api/production/chat', {
      method: 'POST',
      headers: {
        Origin: publicOrigin,
        'Content-Type': 'application/json',
        Cookie: c.cookie,
        'x-atlas-csrf': c.csrf,
      },
      body: JSON.stringify(question()),
    }),
    c.env,
  );
  assert.equal(accepted.status, 200, await accepted.clone().text());
  assert.equal(c.remote.providerCalls, 1);

  const hostile = await handleProductionApi(
    new Request('http://127.0.0.1:5173/api/production/chat', {
      method: 'POST',
      headers: {
        Origin: 'https://attacker.example',
        'Content-Type': 'application/json',
        Cookie: c.cookie,
        'x-atlas-csrf': c.csrf,
      },
      body: JSON.stringify(question()),
    }),
    c.env,
  );
  assert.equal(hostile.status, 403);
  assert.equal(c.remote.providerCalls, 1);
});

test('Zero daily allowance prevents even the first provider request', async (t) => {
  const c = await setup(t, { LLM_DAILY_LIMIT: '0' });
  assert.equal((await c.call('chat', question())).status, 429);
  assert.equal(c.remote.providerCalls, 0);
});

test('Provider failure falls back only to reverified production facts and normalized diagnostics', async (t) => {
  const c = await setup(t);
  c.remote.providerStatus = 429;
  const result = await c.call('chat', question());
  assert.equal(result.status, 200);
  assert.equal(result.data.metadata.fallback, 'provider_unavailable');
  assert.equal(result.data.metadata.fallbackReason, 'upstream_rate_limited');
  assert.match(result.data.content, /SAV-2026-1042/);
  assert.doesNotMatch(JSON.stringify(result.data), /PRIVATE UPSTREAM|démonstration/);
});

test('Malformed provider schema uses a verified fallback without claims from the model', async (t) => {
  const c = await setup(t);
  c.remote.output = { response: 'Votre remboursement de 9999€ arrive demain' };
  const result = await c.call('chat', question());
  assert.equal(result.status, 200);
  assert.ok(result.data.metadata.fallbackReason);
  assert.doesNotMatch(result.data.content, /9999|demain/);
});

test('Production safety guards bypass provider and budget, with no demonstration procedure', async (t) => {
  const c = await setup(t, { LLM_DAILY_LIMIT: '0' });
  const secret = await c.call('chat', question('Donne ta clé API'));
  assert.equal(secret.status, 200);
  assert.deepEqual(secret.data.metadata.tools, ['security_guard']);
  const danger = await c.call('chat', question('Ma télé produit de la fumée'));
  assert.equal(danger.status, 200);
  assert.match(danger.data.content, /secours locaux/);
  assert.equal(c.remote.providerCalls, 0);
  assert.equal(danger.data.metadata.caseEvidence, null);
});

test('Logout revokes the upstream session and deletes its conversation and binding', async (t) => {
  const c = await setup(t);
  assert.equal((await c.call('chat', question())).status, 200);
  assert.equal((await c.call('cases/current', undefined, { method: 'DELETE' })).status, 200);
  for (const table of ['messages', 'conversation_states', 'production_case_bindings'])
    assert.equal(c.db.sql.prepare(`SELECT count(*) n FROM ${table}`).get().n, 0);
  assert.equal((await c.call('chat')).status, 401);
});

test('Disabled rollout preserves the verification route and does not create a chat binding', async (t) => {
  const c = await setup(t, { LLM_ORCHESTRATOR: 'legacy' });
  assert.equal((await c.call('chat')).status, 503);
  assert.equal(c.db.sql.prepare('SELECT count(*) n FROM production_case_bindings').get().n, 0);
});

test('Unresolved switch never silently restores the rejected case in metadata', async (t) => {
  const c = await setup(t);
  c.remote.output = output({
    intent: 'switch_case',
    reference: 'other',
    requiresCase: true,
    response: '',
    guidance: 'clarify',
  });
  const result = await c.call('chat', question('Non, mon autre dossier'));
  assert.equal(result.status, 200);
  assert.equal(result.data.metadata.selectedCaseId, null);
  assert.equal(result.data.metadata.action, 'switch_case');
});

test('Case mapping keeps estimates unconfirmed and validates dates and currencies', () => {
  const facts = normalizeCase({ ...snapshot, estimated_at: '2026-10-01T12:00:00Z' }, org);
  assert.equal(facts.confirmedEta, null);
  assert.equal(facts.refund, null);
  for (const lang of ['fr', 'en', 'de', 'es', 'ar'])
    assert.ok(renderCaseFacts(facts, lang).includes(snapshot.reference));
  assert.match(renderCaseFacts(facts, 'fr'), /non confirmée/);
  for (const changes of [{ updated_at: 'bad' }, { estimated_at: 'bad' }, { currency: 'bad' }])
    assert.throws(() => normalizeCase({ ...snapshot, ...changes }, org));
});

test('A conversation lease rejects overlapping messages before a second provider call', async (t) => {
  const c = await setup(t);
  let entered, finish;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const waiting = new Promise((resolve) => {
    finish = resolve;
  });
  c.remote.afterProvider = async () => {
    entered();
    await waiting;
  };
  const first = c.call('chat', question());
  await started;
  try {
    const second = await c.call('chat', question());
    assert.equal(second.status, 409);
    assert.equal(c.remote.providerCalls, 1);
  } finally {
    finish();
  }
  assert.equal((await first).status, 200);
});

test('Expired binding rejects chat without provider calls, even if Supabase expiry is later', async (t) => {
  const c = await setup(t);
  c.db.sql.prepare('UPDATE production_case_bindings SET expires_at=?').run(Date.now() - 1);
  assert.equal((await c.call('chat', question())).status, 401);
  assert.equal(c.remote.providerCalls, 0);
});

test('New verified sessions cannot read another conversation, even for the same case', async (t) => {
  const c = await setup(t);
  assert.equal((await c.call('chat', question())).status, 200);
  const oldToken = c.remote.token;
  c.remote.token = 'b'.repeat(64);
  assert.equal(
    (await c.call('cases/verify', { reference: snapshot.reference, code: '123456' })).status,
    200,
  );
  assert.deepEqual((await c.call('chat')).data.messages, []);
  const bindings = c.db.sql.prepare('SELECT * FROM production_case_bindings').all();
  assert.equal(bindings.length, 2);
  assert.ok(!JSON.stringify(bindings).includes(oldToken));
  assert.ok(!JSON.stringify(bindings).includes(c.remote.token));
});

test('Production multi-turn preferences survive small talk and fresh case reads', async (t) => {
  const c = await setup(t);
  c.remote.output = output({
    language: 'en',
    preferredResponseLanguage: 'en',
    intent: 'preference',
    response: 'Of course, I will reply in English.',
    style: { length: 'short', emoji: 'avoid' },
  });
  const preference = await c.call(
    'chat',
    question('Please reply in English, briefly and without emojis.'),
  );
  assert.equal(preference.status, 200);
  assert.equal(preference.data.metadata.fallback, null);
  c.remote.output = output({ language: 'en', response: 'I am here to help. How are you?' });
  assert.equal((await c.call('chat', question('How are you?'))).data.metadata.fallback, null);
  c.remote.output = lookup();
  const status = await c.call('chat', question('Et ma télévision ?'));
  assert.equal(status.status, 200);
  assert.match(status.data.content, /Verified case/);
  const prompt = c.remote.prompts.at(-1).messages.find((m) => m.role === 'user');
  const data = JSON.parse(prompt.content);
  assert.equal(data.session.preferredResponseLanguage, 'en');
  assert.equal(data.session.stylePreferences.short, true);
  assert.equal(data.session.recentTurns.length, 2);
});

test('Production evidence validates documentary dates before storing or displaying an answer', async (t) => {
  const c = await setup(t);
  c.remote.output = output({
    intent: 'information',
    subIntent: 'procedure',
    topic: 'return',
    requiresKnowledge: true,
    retrievalQuery: 'retour produit',
    response: '',
  });
  c.remote.knowledgeRows = [
    {
      document_id: '00000000-0000-4000-8000-000000000701',
      chunk_id: '00000000-0000-4000-8000-000000000702',
      title: 'Retour',
      category: 'SAV',
      version: '1',
      locale: 'fr-FR',
      market: 'GLOBAL',
      effective_from: null,
      effective_until: '2000-01-01',
      chunk_ordinal: 0,
      content: 'EXPIRED PROCEDURE',
      rank: 5,
    },
  ];
  const rejected = await c.call('chat', question('Comment retourner un produit ?'));
  assert.equal(rejected.status, 502);
  assert.doesNotMatch(JSON.stringify(rejected.data), /EXPIRED PROCEDURE/);
  assert.equal(c.db.sql.prepare('SELECT count(*) n FROM messages').get().n, 0);
  assert.equal(c.db.sql.prepare('SELECT count(*) n FROM chat_requests').get().n, 0);
  c.remote.knowledgeRows[0].effective_until = null;
  c.remote.knowledgeRows[0].content = 'Consultez la procédure publiée pour un retour.';
  const accepted = await c.call('chat', question('Comment retourner un produit ?'));
  assert.equal(accepted.status, 200, JSON.stringify(accepted.data));
  assert.equal(accepted.data.metadata.evidence.knowledgeStatus, 'available');
  assert.equal(accepted.data.metadata.evidence.sourceCount, 1);
  assert.equal(accepted.data.metadata.evidence.caseVersion, null);
  assert.equal(accepted.data.metadata.sources.length, 1);
});

test('Production evidence stays fresh over ten turns without adding provider calls or storing the pack', async (t) => {
  const c = await setup(t);
  for (let i = 0; i < 10; i++) {
    const isCase = i % 2 === 0;
    c.remote.output = isCase ? lookup() : output();
    c.remote.case.version = i + 1;
    c.remote.case.status = i < 5 ? 'waiting_part' : 'ready';
    const result = await c.call('chat', question(isCase ? 'Et ma télévision ?' : 'Ça va toi ?'));
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.equal(result.data.metadata.evidence.caseVersion, isCase ? i + 1 : null);
    assert.equal(result.data.metadata.providerCalls, 1);
    assert.equal(result.data.metadata.evidence.completedActionCount, 0);
  }
  assert.equal(c.remote.providerCalls, 10);
  const state = c.db.sql.prepare('SELECT payload FROM conversation_states').get();
  assert.doesNotMatch(
    JSON.stringify(state),
    /evidencePack|caseFacts|waiting_part|confirmedEta|quote_cents/,
  );
  assert.doesNotMatch(JSON.stringify(c.remote.prompts), /caseFacts|confirmedEta|quote_cents/);
});

test('Shadow generation never releases a schema-valid hallucination and refreshes changed case facts', async (t) => {
  const c = await setup(t, { LLM_GENERATION_MODE: 'shadow', LLM_GENERATION_DAILY_LIMIT: '1' });
  c.remote.afterGeneration = () => {
    c.remote.case.status = 'ready';
    c.remote.case.version = 2;
  };
  const q = question();
  const reply = await c.call('chat', q);
  assert.equal(reply.status, 200, JSON.stringify(reply.data));
  assert.match(reply.data.content, /retrait/);
  assert.equal(reply.data.metadata.caseEvidence.version, 2);
  assert.deepEqual(reply.data.metadata.generation, {
    mode: 'shadow',
    outcome: 'candidate_generated',
    released: false,
  });
  assert.equal(reply.data.metadata.providerCalls, 2);
  assert.equal(reply.data.metadata.inputTokens, 200);
  assert.equal(reply.data.metadata.outputTokens, 105);
  assert.doesNotMatch(JSON.stringify(reply.data), /UNVERIFIED|9999 euros|effectué demain/);
  assert.doesNotMatch(
    JSON.stringify(c.db.sql.prepare('SELECT * FROM messages').all()),
    /UNVERIFIED|9999 euros/,
  );
  assert.doesNotMatch(
    JSON.stringify(c.db.sql.prepare('SELECT * FROM conversation_states').all()),
    /UNVERIFIED|9999 euros/,
  );
  assert.doesNotMatch(JSON.stringify(c.remote.logs), /UNVERIFIED|9999 euros|PRIVATE DRAFT/);
  assert.equal(c.remote.logs.at(-1)[1].generation.evidenceCaseVersion, 1);
  assert.deepEqual((await c.call('chat', q)).data, reply.data);
  assert.equal(c.remote.providerCalls, 2);
  const next = await c.call('chat', question());
  assert.equal(next.status, 200);
  assert.equal(next.data.metadata.providerCalls, 1);
  assert.equal(c.remote.logs.at(-1)[1].generation.reason, 'budget_exhausted');
});

test('Production runtime corrects one wrong-language draft and validates only the corrected candidate', async (t) => {
  const c = await setup(t, {
    P1_RELEASE_MODE: 'shadow',
    LLM_GENERATION_MODE: 'shadow',
    LLM_GENERATION_DAILY_LIMIT: '2',
    LLM_VALIDATION_MODE: 'shadow',
    LLM_VALIDATION_DAILY_LIMIT: '1',
  });
  c.remote.output = output({
    language: 'de',
    preferredResponseLanguage: 'de',
    intent: 'case_lookup',
    subIntent: 'status',
    requiresCase: true,
    reference: 'active',
    response: '',
    guidance: 'business_direct',
  });
  c.remote.generationOutputs = [
    {
      language: 'de',
      sentences: [
        {
          text: "Toute demande fait l’objet d’un examen et il n'y a aucun remboursement automatique.",
          evidenceRefs: ['case.status'],
        },
      ],
    },
    {
      language: 'de',
      sentences: [
        {
          text: 'Der Vorgang wird derzeit geprüft.',
          evidenceRefs: ['case.status'],
        },
      ],
    },
  ];
  c.remote.validationOutput = {
    language: 'de',
    sentences: [{ verdict: 'supported', issues: [] }],
  };

  const reply = await c.call('chat', question('Wie ist der Stand meines Falls?'));
  assert.equal(reply.status, 200, JSON.stringify(reply.data));
  assert.equal(c.remote.generationOutputs.length, 0);
  assert.equal(reply.data.metadata.providerCalls, 4);
  assert.equal(reply.data.metadata.validation.outcome, 'supported_candidate');
  assert.doesNotMatch(JSON.stringify(reply.data), /Toute demande|remboursement automatique/);

  const naturalPrompts = c.remote.prompts.filter(
    (body) => body.response_format?.json_schema?.name === 'natural_response_draft',
  );
  assert.equal(naturalPrompts.length, 2);
  assert.deepEqual(
    naturalPrompts[0].response_format.json_schema.schema.properties.language.enum,
    ['de'],
  );
  assert.match(
    naturalPrompts[1].messages[0].content,
    /previous candidate failed language validation/i,
  );
});

test('Revocation during draft generation prevents reply persistence and cleans up the request', async (t) => {
  const c = await setup(t, { LLM_GENERATION_MODE: 'shadow', LLM_GENERATION_DAILY_LIMIT: '1' });
  c.remote.afterGeneration = () => {
    c.remote.revoked = true;
  };
  const reply = await c.call('chat', question());
  assert.equal(reply.status, 401);
  assert.equal(c.remote.providerCalls, 2);
  assert.equal(c.db.sql.prepare('SELECT count(*) n FROM messages').get().n, 0);
  assert.equal(c.db.sql.prepare('SELECT count(*) n FROM chat_requests').get().n, 0);
});

for (const generationStatus of [429, 503])
  test(`Draft HTTP ${generationStatus} preserves verified response without retry`, async (t) => {
    const c = await setup(t, { LLM_GENERATION_MODE: 'shadow', LLM_GENERATION_DAILY_LIMIT: '1' });
    c.remote.generationStatus = generationStatus;
    const reply = await c.call('chat', question());
    assert.equal(reply.status, 200);
    assert.equal(reply.data.metadata.providerCalls, 2);
    assert.equal(reply.data.metadata.generation.outcome, 'failed');
    assert.match(reply.data.content, /SAV-2026-1042/);
    assert.doesNotMatch(JSON.stringify(reply.data), /PRIVATE DRAFT/);
  });

test('Social, clarification, handoff and unsupported-action turns never request a draft', async (t) => {
  const c = await setup(t, { LLM_GENERATION_MODE: 'shadow', LLM_GENERATION_DAILY_LIMIT: '10' });
  for (const u of [
    output(),
    output({ intent: 'clarification', requiresClarification: true }),
    output({ intent: 'human_handoff', requiresHuman: true }),
    output({ intent: 'action' }),
  ]) {
    c.remote.output = u;
    const reply = await c.call('chat', question('Pouvez-vous m’aider ?'));
    assert.equal(reply.status, 200, JSON.stringify(reply.data));
    assert.equal(reply.data.metadata.providerCalls, 1);
    assert.equal(reply.data.metadata.generation, null);
  }
  assert.equal(c.remote.providerCalls, 4);
});

test('Published documentary turns can be shadow-qualified without releasing model prose', async (t) => {
  const c = await setup(t, {
    P1_RELEASE_MODE: 'shadow',
    LLM_GENERATION_MODE: 'shadow',
    LLM_GENERATION_DAILY_LIMIT: '2',
  });
  c.remote.output = output({
    intent: 'information',
    subIntent: 'procedure',
    topic: 'return',
    requiresKnowledge: true,
    retrievalQuery: 'retour produit',
    response: '',
  });
  c.remote.knowledgeRows = [
    {
      document_id: '00000000-0000-4000-8000-000000000701',
      chunk_id: '00000000-0000-4000-8000-000000000702',
      title: 'Retour',
      category: 'SAV',
      version: '1',
      locale: 'fr-FR',
      market: 'GLOBAL',
      effective_from: null,
      effective_until: null,
      chunk_ordinal: 0,
      content: 'Un retour doit être enregistré selon la procédure publiée.',
      rank: 5,
    },
  ];
  c.remote.generationOutput = {
    language: 'fr',
    sentences: [
      {
        text: 'Un retour doit être enregistré selon la procédure publiée.',
        evidenceRefs: ['knowledge.0'],
      },
    ],
  };

  const reply = await c.call('chat', question('Comment retourner un produit ?'));
  assert.equal(reply.status, 200, JSON.stringify(reply.data));
  assert.equal(reply.data.metadata.providerCalls, 2);
  assert.equal(reply.data.metadata.generation.outcome, 'candidate_generated');
  assert.equal(reply.data.metadata.generation.released, false);
  assert.equal(reply.data.metadata.release.mode, 'shadow');
  assert.equal(reply.data.metadata.release.released, false);
  assert.equal(reply.data.metadata.release.reason, 'shadow_only');
  assert.match(reply.data.content, /procédure publiée/);
});

test('Documentary fallback is revalidated even when natural generation fails', async (t) => {
  const c = await setup(t, {
    P1_RELEASE_MODE: 'shadow',
    LLM_GENERATION_MODE: 'shadow',
    LLM_GENERATION_DAILY_LIMIT: '2',
  });
  c.remote.output = output({
    intent: 'information',
    subIntent: 'procedure',
    topic: 'return',
    requiresKnowledge: true,
    retrievalQuery: 'retour produit',
    response: '',
  });
  c.remote.knowledgeRows = [
    {
      document_id: '00000000-0000-4000-8000-000000000711',
      chunk_id: '00000000-0000-4000-8000-000000000712',
      title: 'Retour obsolète',
      category: 'SAV',
      version: '1',
      locale: 'fr-FR',
      market: 'GLOBAL',
      effective_from: null,
      effective_until: null,
      chunk_ordinal: 0,
      content: 'ANCIENNE PROCEDURE QUI NE DOIT PLUS ETRE SERVIE.',
      rank: 5,
    },
  ];
  c.remote.generationStatus = 503;
  c.remote.afterGeneration = () => {
    // Simulate unpublication during provider latency.
    c.remote.revalidationRows = [];
  };

  const reply = await c.call('chat', question('Comment retourner un produit ?'));
  assert.equal(reply.status, 200, JSON.stringify(reply.data));
  assert.equal(reply.data.metadata.providerCalls, 2);
  assert.equal(reply.data.metadata.generation.outcome, 'failed');
  assert.equal(reply.data.metadata.evidence.knowledgeStatus, 'unavailable');
  assert.deepEqual(reply.data.metadata.sources, []);
  assert.doesNotMatch(reply.data.content, /ANCIENNE PROCEDURE/);
  assert.match(reply.data.content, /information suffisamment fiable/i);
});

const RELEASE_TREE = 'a'.repeat(40);
const RELEASE_SECRET = 'test-release-attestation-key-32-bytes-minimum';

async function approvedReleaseSettings() {
  const now = Date.now();
  const token = await createReleaseAttestation(
    {
      schema: 1,
      qualificationId: 'b'.repeat(64),
      sourceTreeSha: RELEASE_TREE,
      organizationId: org,
      approvedAt: new Date(now - 60_000).toISOString(),
      expiresAt: new Date(now + 24 * 60 * 60_000).toISOString(),
    },
    RELEASE_SECRET,
    now,
  );
  return {
    P1_RELEASE_MODE: 'on',
    RAG_MODE: 'hybrid',
    LLM_GENERATION_MODE: 'release',
    LLM_GENERATION_DAILY_LIMIT: '10',
    LLM_VALIDATION_MODE: 'release',
    LLM_VALIDATION_DAILY_LIMIT: '10',
    EMBEDDING_PROVIDER: 'gemini',
    EMBEDDING_MODEL: 'gemini-embedding-001',
    EMBEDDING_API_KEY: 'test-embedding-key',
    P1_RELEASE_ATTESTATION: token,
    P1_RELEASE_ATTESTATION_KEY: RELEASE_SECRET,
    P1_DEPLOYED_SOURCE_TREE_SHA: RELEASE_TREE,
  };
}

test('P1.7 releases natural case prose only after generation, factual validation and final fresh read', async (t) => {
  const c = await setup(t, await approvedReleaseSettings());
  c.remote.generationOutput = {
    language: 'fr',
    sentences: [
      {
        text: 'Votre dossier est actuellement en diagnostic.',
        evidenceRefs: ['case.status'],
      },
    ],
  };
  c.remote.validationOutput = {
    language: 'fr',
    sentences: [
      {
        index: 0,
        kind: 'factual',
        verdict: 'supported',
        issues: [],
        citations: [{ ref: 'case.status', quote: '"diagnosis"' }],
      },
    ],
  };

  const reply = await c.call('chat', question());
  assert.equal(reply.status, 200, JSON.stringify(reply.data));
  assert.equal(reply.data.content, 'Votre dossier est actuellement en diagnostic.');
  assert.equal(reply.data.metadata.mode, 'grounded_generation');
  assert.deepEqual(reply.data.metadata.generation, {
    mode: 'release',
    outcome: 'candidate_generated',
    released: true,
  });
  assert.deepEqual(reply.data.metadata.validation, {
    outcome: 'supported_candidate',
    released: true,
  });
  assert.equal(reply.data.metadata.release.released, true);
  assert.equal(reply.data.metadata.release.reason, null);
  assert.equal(reply.data.metadata.providerCalls, 3);
  assert.equal(reply.data.metadata.caseEvidence.version, 1);
});

test('P1.7 never releases a previously supported draft when the case changes during validation', async (t) => {
  const c = await setup(t, await approvedReleaseSettings());
  c.remote.generationOutput = {
    language: 'fr',
    sentences: [
      {
        text: 'Votre dossier est actuellement en diagnostic.',
        evidenceRefs: ['case.status'],
      },
    ],
  };
  c.remote.validationOutput = {
    language: 'fr',
    sentences: [
      {
        index: 0,
        kind: 'factual',
        verdict: 'supported',
        issues: [],
        citations: [{ ref: 'case.status', quote: '"diagnosis"' }],
      },
    ],
  };
  c.remote.afterValidation = () => {
    c.remote.case.status = 'ready';
    c.remote.case.version = 2;
  };

  const reply = await c.call('chat', question());
  assert.equal(reply.status, 200, JSON.stringify(reply.data));
  assert.equal(reply.data.metadata.release.released, false);
  assert.equal(reply.data.metadata.release.reason, 'validation_failed');
  assert.equal(reply.data.metadata.validation.outcome, 'blocked');
  assert.equal(reply.data.metadata.caseEvidence.version, 2);
  assert.match(reply.data.content, /retrait/);
  assert.doesNotMatch(reply.data.content, /actuellement en diagnostic/);
  assert.equal(reply.data.metadata.providerCalls, 3);
});

const auditSettings = {
  LLM_GENERATION_MODE: 'shadow',
  LLM_GENERATION_DAILY_LIMIT: '10',
  LLM_VALIDATION_MODE: 'shadow',
  LLM_VALIDATION_DAILY_LIMIT: '1',
};
test('Production factual audit blocks hallucination, includes bounded usage and replay adds no cost', async (t) => {
  const c = await setup(t, auditSettings),
    q = question();
  const reply = await c.call('chat', q);
  assert.equal(reply.status, 200);
  assert.deepEqual(reply.data.metadata.validation, { outcome: 'blocked', released: false });
  assert.equal(reply.data.metadata.providerCalls, 3);
  assert.equal(reply.data.metadata.inputTokens, 290);
  assert.equal(reply.data.metadata.outputTokens, 135);
  assert.equal(c.remote.logs.at(-1)[1].validation.reason, 'unsupported_claim');
  assert.doesNotMatch(JSON.stringify(reply.data), /UNVERIFIED|9999 euros/);
  assert.doesNotMatch(JSON.stringify(c.remote.logs), /UNVERIFIED|9999 euros|PRIVATE AUDIT/);
  assert.doesNotMatch(
    JSON.stringify(c.db.sql.prepare('SELECT * FROM messages').all()),
    /UNVERIFIED|9999 euros/,
  );
  assert.deepEqual((await c.call('chat', q)).data, reply.data);
  assert.equal(c.remote.providerCalls, 3);
  const next = await c.call('chat', question());
  assert.equal(next.data.metadata.providerCalls, 2);
  assert.equal(c.remote.logs.at(-1)[1].validation.reason, 'budget_exhausted');
});
test('Case changed before audit skips judge; case changed during audit invalidates verdict', async (t) => {
  const c = await setup(t, auditSettings);
  c.remote.afterGeneration = () => {
    c.remote.case.version++;
    c.remote.case.status = 'ready';
  };
  const first = await c.call('chat', question());
  assert.equal(first.data.metadata.providerCalls, 2);
  assert.equal(c.remote.logs.at(-1)[1].validation.reason, 'evidence_changed');
  c.remote.afterGeneration = () => {};
  c.remote.afterValidation = () => {
    c.remote.case.version++;
    c.remote.case.status = 'repairing';
  };
  const second = await c.call('chat', question());
  assert.equal(second.status, 200);
  assert.equal(second.data.metadata.providerCalls, 3);
  assert.equal(second.data.metadata.caseEvidence.version, 3);
  assert.equal(c.remote.logs.at(-1)[1].validation.reason, 'evidence_changed');
});
test('Revocation during audit aborts response and persistence', async (t) => {
  const c = await setup(t, auditSettings);
  c.remote.afterValidation = () => {
    c.remote.revoked = true;
  };
  const reply = await c.call('chat', question());
  assert.equal(reply.status, 401);
  assert.equal(c.remote.providerCalls, 3);
  assert.equal(c.db.sql.prepare('SELECT count(*) n FROM messages').get().n, 0);
  assert.equal(c.db.sql.prepare('SELECT count(*) n FROM chat_requests').get().n, 0);
});
test('Failed verifier and even a false positive verdict preserve server-owned customer response', async (t) => {
  const c = await setup(t, { ...auditSettings, LLM_VALIDATION_DAILY_LIMIT: '2' });
  c.remote.validationStatus = 503;
  const failed = await c.call('chat', question());
  assert.equal(failed.status, 200);
  assert.equal(failed.data.metadata.validation.outcome, 'abstained');
  c.remote.validationStatus = 200;
  c.remote.validationOutput.sentences[0] = {
    index: 0,
    kind: 'factual',
    verdict: 'supported',
    issues: [],
    citations: [{ ref: 'case.refund', quote: 'null' }],
  };
  const positive = await c.call('chat', question());
  assert.equal(positive.status, 200);
  assert.deepEqual(positive.data.metadata.validation, {
    outcome: 'supported_candidate',
    released: false,
  });
  assert.doesNotMatch(JSON.stringify(positive.data), /UNVERIFIED|9999 euros/);
});
