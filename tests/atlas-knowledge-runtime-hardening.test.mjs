import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(
  'supabase/migrations/20260918130553_knowledge_runtime_search_hardening.sql',
  'utf8',
);

test('knowledge runtime grants app_private usage to server roles', () => {
  assert.match(sql, /grant usage on schema app_private to authenticated, service_role/i);
});

test('knowledge search supports relaxed natural-language retrieval', () => {
  assert.match(sql, /tsvector_to_array\(to_tsvector\('french'/i);
  assert.match(sql, /string_agg\(quote_literal\(lexeme\), ' \| '\)/i);
  assert.match(sql, /v_relaxed/);
  assert.match(sql, /d\.status='published'/);
  assert.match(sql, /effective_until is null or d\.effective_until>=current_date/);
});


test('knowledge search adds trigram title ranking for natural phrasing', () => {
  const trgm = readFileSync(
    'supabase/migrations/20260918130956_enable_pg_trgm_for_knowledge.sql',
    'utf8',
  );
  const ranking = readFileSync(
    'supabase/migrations/20260918131105_knowledge_search_trigram_ranking.sql',
    'utf8',
  );
  assert.match(trgm, /pg_trgm/i);
  assert.match(ranking, /extensions\.similarity\(lower\(d\.title\), lower\(v_clean_query\)\)/i);
  assert.match(ranking, />= 0\.16/);
});
