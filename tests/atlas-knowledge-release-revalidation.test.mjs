import test from 'node:test';
import assert from 'node:assert/strict';

import { generationFixture, generationScenarios } from '../evals/generation.mjs';
import {
  KnowledgeFreshnessError,
  revalidateKnowledgeEvidence,
} from '../lib/atlas/knowledge-runtime.ts';

const scenario = generationScenarios.find((row) => row.kind === 'knowledge');

function env() {
  return {
    SUPABASE_URL: 'https://fixture.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
    SUPABASE_SECRET_KEY: 'sb_secret_test',
    SUPABASE_ORGANIZATION_ID: '00000000-0000-4000-8000-000000000001',
  };
}

function rowFrom(pack, changes = {}) {
  const source = pack.knowledge.sources[0];
  return {
    document_id: source.documentId,
    chunk_id: source.chunkId,
    version: source.version,
    revision: 1,
    locale: source.locale,
    market: source.market,
    effective_from: source.effectiveFrom,
    effective_until: source.effectiveUntil,
    content: source.content,
    ...changes,
  };
}

test('documentary revalidation requires the exact published chunk identity', async (t) => {
  const fixture = generationFixture(scenario);
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    requests.push({ url: String(url), body: JSON.parse(init.body) });
    return Response.json([rowFrom(fixture.pack)]);
  });

  const result = await revalidateKnowledgeEvidence(env(), fixture.pack);
  assert.equal(result.scope, 'supabase_published');
  assert.equal(result.articles.length, 1);
  assert.equal(result.articles[0].body, fixture.pack.knowledge.sources[0].content);
  assert.equal(result.evidence[0].contentHash, fixture.pack.knowledge.sources[0].contentHash);
  assert.match(requests[0].url, /\/rpc\/knowledge_revalidate_sources$/);
  assert.deepEqual(requests[0].body.p_sources, [
    {
      document_id: fixture.pack.knowledge.sources[0].documentId,
      chunk_id: fixture.pack.knowledge.sources[0].chunkId,
      version: fixture.pack.knowledge.sources[0].version,
      locale: fixture.pack.knowledge.sources[0].locale,
      market: fixture.pack.knowledge.sources[0].market,
    },
  ]);
});

for (const [name, response] of [
  ['missing row', []],
  ['changed version', (pack) => [rowFrom(pack, { version: '2' })]],
  ['changed content', (pack) => [rowFrom(pack, { content: 'Changed policy text.' })]],
  ['changed market', (pack) => [rowFrom(pack, { market: 'LU' })]],
]) {
  test(`documentary revalidation blocks ${name}`, async (t) => {
    const fixture = generationFixture(scenario);
    t.mock.method(globalThis, 'fetch', async () =>
      Response.json(typeof response === 'function' ? response(fixture.pack) : response),
    );
    await assert.rejects(
      revalidateKnowledgeEvidence(env(), fixture.pack),
      (error) =>
        error instanceof KnowledgeFreshnessError &&
        error.reason === 'knowledge_changed',
    );
  });
}

test('documentary revalidation maps Supabase transport failure to unavailable', async (t) => {
  const fixture = generationFixture(scenario);
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ code: 'PGRST500' }, { status: 503 }),
  );
  await assert.rejects(
    revalidateKnowledgeEvidence(env(), fixture.pack),
    (error) =>
      error instanceof KnowledgeFreshnessError &&
      error.reason === 'knowledge_unavailable',
  );
});
