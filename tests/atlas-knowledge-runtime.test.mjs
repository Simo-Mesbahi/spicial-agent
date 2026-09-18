import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const compiled = await build({
  entryPoints: ['lib/atlas/knowledge-runtime.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { searchKnowledge } = await import(
  'data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64')
);

test('knowledge runtime falls back to legacy documents only when Supabase is not configured', async () => {
  const result = await searchKnowledge({}, 'garantie');
  assert.equal(result.scope, 'legacy_demo');
  assert.equal(result.articles[0]?.id, 'sav-garantie');
});

test('knowledge runtime uses published Supabase search results when configured', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    assert.match(String(input), /\/rest\/v1\/rpc\/knowledge_search$/);
    assert.equal(init?.method, 'POST');
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('apikey'), 'secret-value');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.p_query, 'garantie');
    assert.equal(body.p_limit, 3);
    return Response.json([
      {
        document_id: '11111111-1111-4111-8111-111111111111',
        chunk_id: '22222222-2222-4222-8222-222222222222',
        title: 'Garantie et prise en charge',
        category: 'SAV',
        version: '2.0',
        locale: 'fr-FR',
        market: 'GLOBAL',
        effective_from: '2026-09-01',
        effective_until: null,
        chunk_ordinal: 0,
        content: 'Procédure publiée et contrôlée.',
        rank: 0.92,
      },
    ]);
  };
  try {
    const result = await searchKnowledge(
      {
        SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_PUBLISHABLE_KEY: 'publishable-value',
        SUPABASE_SECRET_KEY: 'secret-value',
        SUPABASE_ORGANIZATION_ID: '00000000-0000-4000-8000-000000000001',
      },
      'garantie',
    );
    assert.equal(result.scope, 'supabase_published');
    assert.equal(result.articles.length, 1);
    assert.equal(result.articles[0].version, '2.0');
    assert.equal(result.articles[0].body, 'Procédure publiée et contrôlée.');
  } finally {
    globalThis.fetch = previous;
  }
});

test('configured Supabase failures fail closed instead of silently serving stale procedure text', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ code: 'upstream_failure' }, { status: 503 });
  try {
    const result = await searchKnowledge(
      {
        SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_PUBLISHABLE_KEY: 'publishable-value',
        SUPABASE_SECRET_KEY: 'secret-value',
        SUPABASE_ORGANIZATION_ID: '00000000-0000-4000-8000-000000000001',
      },
      'garantie',
    );
    assert.equal(result.scope, 'supabase_unavailable');
    assert.deepEqual(result.articles, []);
  } finally {
    globalThis.fetch = previous;
  }
});
