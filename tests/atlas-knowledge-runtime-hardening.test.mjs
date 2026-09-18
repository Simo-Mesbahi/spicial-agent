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
