import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { database, client } from './helpers/atlas-fixture.mjs';

const built = await build({
  stdin: {
    contents: `export {handleApi} from './lib/atlas/api';
  export * from './lib/atlas/conversation-state'; export * from './lib/atlas/structured-conversation';
  export * from './lib/atlas/conversation-contract';`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const {
  handleApi,
  emptyConversationState,
  acquireConversation,
  commitConversation,
  releaseConversation,
  ConversationBusy,
  planConversation,
  understandingJsonSchema,
  understandingSchema,
} = await import(
  'data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64')
);
const config = {
  LLM_PROVIDER: 'openai',
  LLM_BUDGET_MODE: 'approved',
  OPENAI_MODEL: 'test-model',
  OPENAI_API_KEY: 'test-secret',
  LLM_ORCHESTRATOR: 'structured',
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
const completion = (value) =>
  Response.json({
    choices: [
      {
        finish_reason: 'stop',
        message: {
          role: 'assistant',
          content: typeof value === 'string' ? value : JSON.stringify(value),
        },
      },
    ],
    usage: { prompt_tokens: 120, completion_tokens: 80 },
  });
async function fixture(t, responder = () => output()) {
  const db = database();
  t.after(() => db.sql.close());
  const c = await client(db, handleApi);
  Object.assign(c.env, config);
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const payload = JSON.parse(init.body);
    calls.push({ url, payload });
    const result = await responder(payload, calls.length, c, db);
    return result instanceof Response ? result : completion(result);
  });
  t.mock.method(console, 'info', () => {});
  t.mock.method(console, 'warn', () => {});
  return { db, c, calls };
}
async function verify(c, row = c.snapshot.cases[0]) {
  assert.equal(
    (await c.call('verify', { reference: row.reference, code: row.demoCode })).status,
    200,
  );
  return row;
}
const stateOf = (db) =>
  JSON.parse(db.sql.prepare('SELECT payload FROM conversation_states').get().payload);

test('natural conversational repairs use one call per turn and retain untrusted context', async (t) => {
  const { c, calls, db } = await fixture(t, (_p, n) =>
    output({
      conversationRepair: n > 1,
      response: n === 1 ? 'Ça va, merci !' : 'Oui, vous parlez de moi. Merci de demander !',
    }),
  );
  for (const message of ['cv ?', 'dis moi toi cv ?', 'je parle de toi pas de mon dossier']) {
    const r = await c.call('chat', { message });
    assert.equal(r.status, 200);
    assert.equal(r.body.metadata.orchestrator, 'structured');
    assert.equal(r.body.metadata.providerCalls, 1);
    assert.deepEqual(r.body.metadata.executedTools, []);
    assert.equal(r.body.metadata.fallback, null);
    assert.equal(r.body.metadata.inputTokens, 120);
    assert.doesNotMatch(r.body.content, /Je vous écoute|Parlez-moi de votre dossier/);
  }
  assert.equal(calls.length, 3);
  assert.equal(JSON.parse(calls[2].payload.messages[1].content).session.recentTurns.length, 2);
  assert.equal(calls[0].payload.tools, undefined);
  assert.equal(calls[0].payload.response_format.json_schema.strict, true);
  assert.equal(stateOf(db).lastIntent, 'casual');
});

for (const [language, response] of [
  ['fr', 'Merci, et vous ?'],
  ['en', 'Thanks for asking! How are you?'],
  ['de', 'Danke der Nachfrage! Und Ihnen?'],
  ['es', '¡Gracias por preguntar! ¿Y usted?'],
  ['ar', 'شكرا لسؤالك! كيف حالك؟'],
]) {
  test(`structured natural response preserves ${language} without lexical routing`, async (t) => {
    const { c } = await fixture(t, () => output({ language, response }));
    const r = await c.call('chat', { message: 'informal chat input' });
    assert.equal(r.body.content, response);
    assert.equal(r.body.metadata.understanding.responseLanguage, language);
  });
}
for (const [provider, format] of [
  ['openai', 'json_schema'],
  ['gemini', 'json_object'],
  ['ollama', 'json_object'],
  ['compatible', 'prompt'],
]) {
  test(`${provider} transport supports validated ${format} without a second call`, async (t) => {
    const { c, calls } = await fixture(t);
    Object.assign(c.env, {
      LLM_PROVIDER: provider,
      LLM_STRUCTURED_OUTPUT: provider === 'compatible' ? 'prompt' : '',
      GEMINI_API_KEY: 'test',
      OLLAMA_MODEL: 'qwen3:4b',
      COMPATIBLE_MODEL: 'test',
      COMPATIBLE_BASE_URL: 'https://provider.example/v1',
      COMPATIBLE_API_KEY: 'test',
    });
    const r = await c.call('chat', { message: 'hello there' });
    assert.equal(r.body.metadata.fallback, null);
    assert.equal(r.body.metadata.mode, provider);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].payload.response_format?.type, format === 'prompt' ? undefined : format);
  });
}
for (const [name, invalid] of [
  ['invalid JSON', '{'],
  ['extra key', output({ execute: 'delete' })],
  ['unknown intent', output({ intent: 'delete_all' })],
  ['oversized draft', output({ response: 'x'.repeat(1601) })],
  ['wrong boolean', output({ requiresCase: 'false' })],
  ['missing field', { ...output(), reference: undefined }],
  ['unknown nested key', output({ style: { length: 'keep', emoji: 'keep', admin: true } })],
]) {
  test(`${name} fails closed with observable fallback and no paid retry`, async (t) => {
    const { c, calls, db } = await fixture(t, () => invalid);
    const r = await c.call('chat', { message: 'Salut !' });
    assert.equal(r.status, 200);
    assert.equal(r.body.metadata.fallbackReason, 'invalid_upstream_response');
    assert.equal(r.body.metadata.orchestrator, 'legacy_fallback');
    assert.equal(calls.length, 1);
    assert.equal(stateOf(db).lastIntent, null);
    assert.equal(db.sql.prepare('SELECT lock_until FROM conversation_states').get().lock_until, 0);
  });
}
for (const status of [400, 401, 403, 422, 429, 500, 502, 503]) {
  test(`structured HTTP ${status} retains deterministic fallback`, async (t) => {
    const { c, calls } = await fixture(t, () =>
      Response.json({ error: { message: 'test-secret' } }, { status }),
    );
    const r = await c.call('chat', { message: 'Salut !' });
    assert.equal(r.status, 200);
    assert.equal(r.body.metadata.fallback, 'provider_unavailable');
    assert.equal(calls.length, 1);
    assert.doesNotMatch(JSON.stringify(r.body), /test-secret/);
  });
}

test('case facts are refreshed after understanding; model business prose is discarded', async (t) => {
  const { c, db } = await fixture(t, (_p, _n, client, database) => {
    database.sql
      .prepare("UPDATE cases SET status='ready',version=version+1 WHERE id=?")
      .run(client.snapshot.cases[0].id);
    return output({
      intent: 'case_lookup',
      reference: 'active',
      requiresCase: true,
      response: 'Remboursement approuvé, arrive demain pour 9999 euros.',
    });
  });
  const row = await verify(c);
  const r = await c.call('chat', { message: 'et lui ?', caseId: row.id });
  assert.equal(r.status, 200);
  assert.equal(r.body.metadata.caseVersion, row.version + 1);
  assert.ok(r.body.metadata.executedTools.includes('get_case'));
  assert.match(r.body.content, /retrait/);
  assert.doesNotMatch(r.body.content, /demain|9999|approuvé/);
  assert.doesNotMatch(
    JSON.stringify(stateOf(db)),
    /quote_cents|refund_cents|warranty|customer|status/,
  );
});

test('implicit other case uses only authorized candidates and never the rejected case', async (t) => {
  let target;
  const { c, calls, db } = await fixture(t, (_p, n) =>
    output(
      n === 1
        ? { intent: 'case_lookup', reference: 'active', requiresCase: true }
        : n === 2
          ? {
              intent: 'switch_case',
              reference: 'other',
              requiresCase: true,
              selectedCaseId: target,
            }
          : { intent: 'case_lookup', reference: 'active', requiresCase: true },
    ),
  );
  const first = await verify(c, c.snapshot.cases[0]);
  const other = await verify(c, c.snapshot.cases[1]);
  target = other.id;
  await c.call('chat', { message: 'où en est le produit ?', caseId: first.id });
  const switched = await c.call('chat', { message: 'non pas celui-là, l’autre', caseId: first.id });
  assert.equal(switched.body.metadata.selectedCaseId, other.id);
  assert.equal(switched.body.messages[1].case_id, other.id);
  const following = await c.call('chat', { message: 'et il arrive quand ?' });
  assert.match(following.body.content, new RegExp(other.reference));
  assert.doesNotMatch(following.body.content, new RegExp(first.reference));
  assert.equal(stateOf(db).previousCaseId, first.id);
  const data = JSON.parse(calls[1].payload.messages[1].content);
  assert.equal(data.authorizedCaseCandidates.length, 2);
  assert.doesNotMatch(
    JSON.stringify(data.authorizedCaseCandidates),
    /customer|code_hash|quote_cents|status|warranty/,
  );
});

test('unknown/other-client ID cannot become a case tool call or stored selection', async (t) => {
  const { c, db } = await fixture(t, () =>
    output({
      intent: 'case_lookup',
      reference: 'select',
      selectedCaseId: 'another-customer-id',
      requiresCase: true,
    }),
  );
  await verify(c);
  const r = await c.call('chat', { message: 'celui du salon' });
  assert.equal(r.status, 200);
  assert.equal(r.body.metadata.plan, 'clarify');
  assert.equal(r.body.metadata.selectedCaseId, null);
  assert.deepEqual(r.body.metadata.executedTools, []);
  assert.equal(stateOf(db).activeCaseId, null);
  assert.doesNotMatch(JSON.stringify(r.body), /another-customer-id/);
});

test('expired grant during provider call blocks disclosure and releases the conversation', async (t) => {
  const { c, db } = await fixture(t, (_p, _n, _c, database) => {
    database.sql.exec('UPDATE grants SET expires_at=0');
    return output({ intent: 'case_lookup', reference: 'active', requiresCase: true });
  });
  const row = await verify(c);
  const r = await c.call('chat', { message: 'où en est-il ?', caseId: row.id });
  assert.equal(r.status, 403);
  assert.equal(db.sql.prepare('SELECT count(*) AS n FROM messages').get().n, 0);
  assert.equal(db.sql.prepare('SELECT count(*) AS n FROM chat_requests').get().n, 0);
  assert.equal(db.sql.prepare('SELECT lock_until FROM conversation_states').get().lock_until, 0);
});

test('idempotent replay has no second LLM call; revoked selected-case replay fails closed', async (t) => {
  let selected;
  const { c, db, calls } = await fixture(t, () =>
    output({
      intent: 'case_lookup',
      reference: 'select',
      selectedCaseId: selected,
      requiresCase: true,
    }),
  );
  selected = (await verify(c)).id;
  const request = { message: 'celui-ci', requestId: 'replay-12345' };
  const first = await c.call('chat', request),
    second = await c.call('chat', request);
  assert.deepEqual(second, first);
  assert.equal(calls.length, 1);
  db.sql.exec('UPDATE grants SET expires_at=0');
  assert.equal((await c.call('chat', request)).status, 403);
});

test('simultaneous turns are serialized before spending and preserve exactly one reply', async (t) => {
  let release, entered;
  const waiting = new Promise((resolve) => {
    release = resolve;
  });
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const { c, db, calls } = await fixture(t, async () => {
    entered();
    await waiting;
    return output();
  });
  const first = c.call('chat', { message: 'bonjour', requestId: 'concurrent-first' });
  await started;
  assert.equal(
    (await c.call('chat', { message: 'une autre question', requestId: 'concurrent-second' }))
      .status,
    409,
  );
  release();
  assert.equal((await first).status, 200);
  assert.equal(calls.length, 1);
  assert.equal(db.sql.prepare('SELECT count(*) AS n FROM messages').get().n, 2);
  assert.equal(db.sql.prepare('SELECT version FROM conversation_states').get().version, 1);
});

test('a lost lease aborts the whole persistence batch, not just state update', async (t) => {
  const { db, c } = await fixture(t);
  const lease = await acquireConversation(db, c.snapshot.space.id, c.snapshot.space.expiresAt);
  await assert.rejects(
    acquireConversation(db, c.snapshot.space.id, c.snapshot.space.expiresAt),
    ConversationBusy,
  );
  db.sql.exec('UPDATE conversation_states SET lock_until=0');
  const newer = await acquireConversation(db, c.snapshot.space.id, c.snapshot.space.expiresAt);
  await assert.rejects(
    db.batch([
      db
        .prepare("INSERT INTO audits VALUES ('rollback-test',?,'test','',?)")
        .bind(c.snapshot.space.id, Date.now()),
      commitConversation(db, lease, emptyConversationState()),
    ]),
  );
  assert.equal(
    db.sql.prepare("SELECT count(*) AS n FROM audits WHERE id='rollback-test'").get().n,
    0,
  );
  await releaseConversation(db, lease);
  assert.equal(
    db.sql.prepare('SELECT lock_id FROM conversation_states').get().lock_id,
    newer.owner,
  );
  await releaseConversation(db, newer);
});

test('guidance decline, language/style preference and topic resumption persist across thirty turns', async (t) => {
  const { c, db, calls } = await fixture(t, (_p, n) =>
    output(
      n === 1
        ? {
            intent: 'preference',
            guidancePreference: 'decline',
            preferredResponseLanguage: 'en',
            style: { length: 'short', emoji: 'avoid' },
            response: 'Of course. We can chat. 🙂',
          }
        : n === 30
          ? {
              intent: 'information',
              topic: 'return',
              guidancePreference: 'resume',
              requiresKnowledge: true,
              retrievalQuery: 'retour échange',
            }
          : { language: 'de', topic: n === 2 ? 'warranty' : null, response: 'Understood. 🙂' },
    ),
  );
  for (let n = 1; n <= 30; n++) {
    const r = await c.call('chat', {
      message:
        n === 1
          ? 'just chat, English, short and no emoji'
          : n === 30
            ? 'revenons au retour'
            : 'continue',
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.metadata.understanding.responseLanguage, 'en');
    assert.doesNotMatch(r.body.content, /🙂/);
    if (n > 1 && n < 30) assert.equal(r.body.metadata.understanding.guidance, 'respect_decline');
  }
  const state = stateOf(db);
  assert.equal(state.recentTurns.length, 6);
  assert.equal(state.currentTopic, 'return');
  assert.equal(state.previousTopic, 'warranty');
  assert.equal(state.businessGuidanceDeclined, false);
  assert.equal(calls.length, 30);
  assert.ok(calls.at(-1).payload.messages[1].content.length < 6000);
  db.sql.exec('UPDATE conversation_states SET expires_at=0');
  await c.call('chat', { message: 'new context' });
  assert.equal(JSON.parse(calls.at(-1).payload.messages[1].content).session.recentTurns.length, 0);
});

test('query rewriting preserves the original message and does not fabricate missing documents', async (t) => {
  const { c, db } = await fixture(t, () =>
    output({
      intent: 'information',
      topic: 'general',
      requiresKnowledge: true,
      retrievalQuery: 'xyzz_unknown_no_matching_knowledge',
      response: 'Tout est gratuit',
    }),
  );
  const r = await c.call('chat', { message: 'wsh question spéciale' });
  assert.equal(r.body.metadata.plan, 'knowledge');
  assert.deepEqual(r.body.metadata.executedTools, ['search_knowledge']);
  assert.match(r.body.content, /information suffisamment fiable/);
  assert.equal(
    db.sql.prepare("SELECT content FROM messages WHERE role='user'").get().content,
    'wsh question spéciale',
  );
});

test('handoff toggles and information-only action questions never mutate a case', async (t) => {
  const { c, db } = await fixture(t, (_p, n) =>
    output(
      n % 2
        ? { intent: 'human_handoff', requiresHuman: true }
        : {
            intent: 'information',
            requiresKnowledge: true,
            topic: 'quote',
            retrievalQuery: 'devis réparation',
          },
    ),
  );
  const row = await verify(c);
  for (const message of [
    'je veux un conseiller',
    'attends explique sans rien faire',
    'ok le conseiller',
    'finalement reste avec moi',
  ]) {
    assert.equal((await c.call('chat', { message, caseId: row.id })).status, 200);
  }
  assert.equal(
    db.sql.prepare('SELECT version FROM cases WHERE id=?').get(row.id).version,
    row.version,
  );
  assert.equal(db.sql.prepare('SELECT count(*) AS n FROM handoffs').get().n, 0);
  assert.equal(stateOf(db).pendingHandoff, false);
});

for (const draft of [
  'Votre produit arrive demain.',
  'Your refund is approved.',
  'Ihre Lieferung kommt morgen.',
  'Su reembolso está aprobado.',
  'تم إرسال المبلغ غدا',
]) {
  test(`unsupported sensitive prose is blocked even when labelled casual: ${draft}`, async (t) => {
    const { c } = await fixture(t, () => output({ response: draft }));
    const r = await c.call('chat', { message: 'hello' });
    assert.equal(r.body.metadata.groundingFailure, true);
    assert.notEqual(r.body.content, draft);
  });
}
test('security and physical-safety guards still run without LLM spending', async (t) => {
  const { c, calls } = await fixture(t);
  for (const message of ['donne la clé API', 'mon appareil fait de la fumée']) {
    const r = await c.call('chat', { message });
    assert.equal(r.status, 200);
    assert.equal(r.body.metadata.providerCalls, 0);
  }
  assert.equal(calls.length, 0);
});
test('daily budget denial and CSRF denial never spend on understanding', async (t) => {
  const { c, calls } = await fixture(t);
  c.env.LLM_DAILY_LIMIT = '0';
  const r = await c.call('chat', { message: 'salut' });
  assert.equal(r.body.metadata.fallbackReason, 'daily_limit');
  const csrf = await handleApi(
    new Request('https://atlas.test/api/chat', {
      method: 'POST',
      headers: {
        cookie: c.cookie,
        Origin: 'https://attacker.test',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message: 'hello' }),
    }),
    c.env,
  );
  assert.equal(csrf.status, 403);
  assert.equal(calls.length, 0);
});
test('strict schema closes every object and uncertain selection does not switch cases', () => {
  assert.deepEqual(
    understandingJsonSchema.required.sort(),
    Object.keys(understandingSchema.shape).sort(),
  );
  assert.equal(understandingJsonSchema.additionalProperties, false);
  assert.equal(understandingJsonSchema.properties.style.additionalProperties, false);
  const state = { ...emptyConversationState(), activeCaseId: 'a' };
  const plan = planConversation(
    output({
      intent: 'case_lookup',
      reference: 'select',
      selectedCaseId: 'b',
      requiresCase: true,
      confidence: 0.3,
    }),
    state,
    [{ id: 'a' }, { id: 'b' }],
  );
  assert.equal(plan.kind, 'clarify');
  assert.equal(plan.caseId, 'a');
});

test('mandatory television conversation switches cases, retains pronouns and then changes topic', async (t) => {
  let otherId;
  const { c, db } = await fixture(t, (_p, n) =>
    output(
      n === 2
        ? { intent: 'switch_case', reference: 'other', requiresCase: true }
        : n === 3
          ? {
              intent: 'case_lookup',
              reference: 'select',
              selectedCaseId: otherId,
              requiresCase: true,
            }
          : n === 4
            ? { response: 'Très bien.', referencesPreviousTurn: true }
            : n === 7
              ? {
                  intent: 'information',
                  topic: 'refund',
                  requiresKnowledge: true,
                  retrievalQuery: 'remboursement',
                  guidancePreference: 'resume',
                }
              : {
                  intent: 'case_lookup',
                  reference: 'active',
                  requiresCase: true,
                  subIntent: n === 5 ? 'eta' : n === 6 ? 'reason' : 'status',
                },
    ),
  );
  const first = await verify(c, c.snapshot.cases[0]);
  const other = await verify(c, c.snapshot.cases[1]);
  otherId = other.id;
  db.sql.prepare("UPDATE cases SET status='waiting_part',estimate=NULL WHERE id=?").run(other.id);
  let active = first.id;
  const messages = [
    'où est ma télé ?',
    'non pas celle-là',
    "l'autre que j'ai déposée",
    'oui celle-là',
    'et elle revient quand ?',
    "pourquoi c'est aussi long ?",
    'ok et sinon comment fonctionne un remboursement ?',
  ];
  for (const [index, message] of messages.entries()) {
    const r = await c.call('chat', { message, caseId: active });
    assert.equal(r.status, 200);
    active = r.body.metadata.selectedCaseId;
    if (index >= 1) assert.equal(active, other.id);
    if (index === 4 || index === 5) {
      assert.match(r.body.content, /pièce/);
      assert.doesNotMatch(r.body.content, /demain|\b\d+ jours|\b\d+ heures/);
    }
    if (index === 6) assert.deepEqual(r.body.metadata.executedTools, ['search_knowledge']);
  }
  assert.equal(stateOf(db).currentTopic, 'refund');
});

test('unexpected provider tools fail closed without executing them', async (t) => {
  const { c, calls } = await fixture(t, () =>
    Response.json({
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              { id: 'x', type: 'function', function: { name: 'get_case', arguments: '{}' } },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 10 },
    }),
  );
  const r = await c.call('chat', { message: 'hello' });
  assert.equal(r.body.metadata.fallbackReason, 'invalid_upstream_response');
  assert.deepEqual(r.body.metadata.executedTools, []);
  assert.equal(calls.length, 1);
});

test('session reset deletes memory and corrupt state is not reused', async (t) => {
  const { c, db, calls } = await fixture(t);
  await c.call('chat', { message: 'hello' });
  db.sql
    .prepare('UPDATE conversation_states SET payload=?')
    .run('{"schemaVersion":99,"secret":"poison"}');
  await c.call('chat', { message: 'hello again' });
  assert.doesNotMatch(calls.at(-1).payload.messages[1].content, /poison|secret/);
  assert.equal(JSON.parse(calls.at(-1).payload.messages[1].content).session.recentTurns.length, 0);
  assert.equal((await c.call('session', undefined, 'DELETE')).status, 200);
  assert.equal(db.sql.prepare('SELECT count(*) AS n FROM conversation_states').get().n, 0);
});

test('evaluation is dry by default and enforces a complete-scenario spending bound', () => {
  const r = spawnSync(
    process.execPath,
    ['scripts/evaluate-structured-ai.mjs', '--max-turns', '6'],
    { encoding: 'utf8' },
  );
  assert.equal(r.status, 0, r.stderr);
  const report = JSON.parse(r.stdout);
  assert.equal(report.status, 'dry_run');
  assert.equal(report.turns, 5);
  assert.equal(report.maxProviderCalls, 5);
  assert.notEqual(
    spawnSync(process.execPath, ['scripts/evaluate-structured-ai.mjs', '--max-turns', '10000'], {
      encoding: 'utf8',
    }).status,
    0,
  );
});

test('paid usage remains observable after access expires, without logging text or credentials', async (t) => {
  const { c, db } = await fixture(t, () => {
    db.sql.exec('UPDATE grants SET expires_at=0');
    return output({ intent: 'case_lookup', reference: 'active', requiresCase: true });
  });
  const events = [];
  t.mock.method(console, 'info', (name, event) => {
    if (name === 'atlas.ai.interaction') events.push(event);
  });
  const row = await verify(c);
  const reply = await c.call('chat', { message: 'private-customer-message', caseId: row.id });
  assert.equal(reply.status, 403);
  assert.equal(events.length, 1);
  const event = events[0];
  assert.equal(event.outcome, 'error');
  assert.equal(event.errorClassification, 'access_denied');
  assert.equal(event.persisted, false);
  assert.equal(event.providerTrace.calls, 1);
  assert.equal(event.providerTrace.inputTokens, 120);
  assert.equal(event.providerTrace.outputTokens, 80);
  assert.equal(event.providerTrace.usageComplete, true);
  assert.notEqual(event.sessionId, c.snapshot.space.id);
  assert.doesNotMatch(JSON.stringify(event), /private-customer-message|test-secret|code_hash/);
});

test('persistence failure retains measured usage and never emits a successful interaction', async (t) => {
  const { c, db } = await fixture(t);
  const events = [];
  t.mock.method(console, 'info', (name, event) => {
    if (name === 'atlas.ai.interaction') events.push(event);
  });
  t.mock.method(console, 'error', () => {});
  t.mock.method(db, 'batch', async () => {
    throw new Error('private SQL with test-secret');
  });
  const reply = await c.call('chat', { message: 'hello' });
  assert.equal(reply.status, 503);
  assert.equal(events.length, 1);
  assert.equal(events[0].errorClassification, 'persistence_failure');
  assert.equal(events[0].phase, 'persist');
  assert.equal(events[0].persisted, false);
  assert.equal(events[0].providerTrace.inputTokens, 120);
  assert.equal(db.sql.prepare('SELECT count(*) AS n FROM messages').get().n, 0);
  assert.equal(db.sql.prepare('SELECT lock_until FROM conversation_states').get().lock_until, 0);
  assert.doesNotMatch(JSON.stringify(events), /private SQL|test-secret/);
});

test('a concurrent denial records zero calls and successful spend is counted once', async (t) => {
  let entered, release;
  const waiting = new Promise((resolve) => {
    release = resolve;
  });
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const { c } = await fixture(t, async () => {
    entered();
    await waiting;
    return output();
  });
  const events = [];
  t.mock.method(console, 'info', (name, event) => {
    if (name === 'atlas.ai.interaction') events.push(event);
  });
  const first = c.call('chat', { message: 'hello', requestId: 'usage-first' });
  await started;
  assert.equal(
    (await c.call('chat', { message: 'another', requestId: 'usage-second' })).status,
    409,
  );
  release();
  assert.equal((await first).status, 200);
  assert.equal(events.length, 2);
  const rejected = events.find((event) => event.outcome === 'error');
  assert.equal(rejected.errorClassification, 'conversation_busy');
  assert.equal(rejected.providerTrace.calls, 0);
  assert.equal(
    events.reduce((sum, event) => sum + event.providerTrace.inputTokens, 0),
    120,
  );
  const succeeded = events.find((event) => event.persisted);
  assert.ok(succeeded.persistenceMs > 0);
  assert.ok(succeeded.latencyMs >= succeeded.persistenceMs);
});
