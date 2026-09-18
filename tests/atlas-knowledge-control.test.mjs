import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chunkKnowledge, knowledgeDraftSchema } from '../lib/atlas/knowledge-control.ts';

test('knowledge chunking is deterministic, bounded and preserves procedure content', () => {
  const paragraph = 'Diagnostic '.repeat(260) + '\n\n' + 'Garantie et prise en charge '.repeat(180);
  const first = chunkKnowledge(paragraph);
  const second = chunkKnowledge(paragraph);
  assert.deepEqual(first, second);
  assert.ok(first.length > 1);
  assert.ok(first.length <= 200);
  assert.ok(first.every((chunk) => chunk.content.length > 0 && chunk.content.length <= 1800));
  assert.ok(first.some((chunk) => chunk.content.includes('Diagnostic')));
  assert.ok(first.some((chunk) => chunk.content.includes('Garantie')));
  assert.ok(first.every((chunk) => chunk.metadata.start >= 0 && chunk.metadata.end > chunk.metadata.start));
});

test('knowledge drafts validate scope, dates and bounded metadata', () => {
  const valid = knowledgeDraftSchema.parse({
    title: 'Garantie électroménager',
    category: 'SAV',
    version: '2.1',
    summary: 'Procédure de prise en charge.',
    content: 'Contenu métier suffisamment long pour être accepté par le contrôle.',
    locale: 'fr-FR',
    market: 'GLOBAL',
    tags: ['garantie', 'sav'],
    sourceUrl: 'https://example.test/procedure',
    effectiveFrom: '2026-09-01',
    effectiveUntil: '2027-09-01',
  });
  assert.equal(valid.market, 'GLOBAL');
  assert.throws(() =>
    knowledgeDraftSchema.parse({
      ...valid,
      effectiveFrom: '2027-10-01',
      effectiveUntil: '2027-01-01',
    }),
  );
  assert.throws(() =>
    knowledgeDraftSchema.parse({
      ...valid,
      tags: Array.from({ length: 31 }, (_, index) => 'tag-' + index),
    }),
  );
});

test('knowledge SQL enforces maker-checker publication and retrieval boundaries', () => {
  const sql = readFileSync(
    'supabase/migrations/20260918111500_knowledge_control_plane.sql',
    'utf8',
  );
  assert.match(sql, /revoke insert, update, delete on public\.knowledge_documents from authenticated/i);
  assert.match(sql, /published_revision_immutable/);
  assert.match(sql, /array\['super_admin'\]/);
  assert.match(sql, /knowledge_review_required/);
  assert.match(sql, /d\.status='published'/);
  assert.match(sql, /effective_from is null or d\.effective_from<=current_date/);
  assert.match(sql, /effective_until is null or d\.effective_until>=current_date/);
  assert.match(sql, /knowledge_chunks_fts_idx|search_vector/);
  assert.match(sql, /knowledge\.published/);
});

test('admin knowledge API chunks server-side and never accepts client supplied chunks', () => {
  const source = readFileSync('lib/atlas/admin-operations-api.ts', 'utf8');
  assert.match(source, /chunkKnowledge\(parsed\.data\.content\)/);
  assert.match(source, /requestBody\(req, 160 \* 1024\)/);
  assert.match(source, /admin_knowledge_submit_review/);
  assert.match(source, /admin_knowledge_publish/);
  assert.doesNotMatch(source, /p_chunks:\s*input\.data/);
});
