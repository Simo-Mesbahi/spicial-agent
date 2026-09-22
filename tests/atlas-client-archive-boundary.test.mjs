import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migrationPath =
  'supabase/migrations/20260922081258_archive_customer_boundary.sql';

test('archived cases are rejected independently from access-code revocation', () => {
  const sql = readFileSync(migrationPath, 'utf8');

  assert.match(
    sql,
    /customer_open_case_session[\s\S]*c\.archived_at is null/i,
  );
  assert.match(
    sql,
    /customer_case_snapshot[\s\S]*c\.archived_at is null/i,
  );
  assert.match(
    sql,
    /return jsonb_build_object\('error','invalid_case_credentials'\)/,
  );
});

test('customer dossier RPCs stay server-only after replacement', () => {
  const sql = readFileSync(migrationPath, 'utf8');

  for (const signature of [
    'public.customer_open_case_session(uuid,text,text)',
    'public.customer_case_snapshot(text)',
  ]) {
    assert.ok(
      sql.includes(`revoke all on function ${signature}`),
      `missing explicit revoke for ${signature}`,
    );
    assert.ok(
      sql.includes(`grant execute on function ${signature}`),
      `missing service-role grant for ${signature}`,
    );
  }

  assert.doesNotMatch(
    sql,
    /grant execute on function public\.customer_[^;]+ to (?:anon|authenticated)/i,
  );
});

test('archive access denial does not expose archive state', () => {
  const sql = readFileSync(migrationPath, 'utf8');

  assert.match(sql, /'reason','invalid_credentials'/);
  assert.doesNotMatch(sql, /jsonb_build_object\([^)]*archived/i);
  assert.doesNotMatch(sql, /return jsonb_build_object\('error','[^']*archive/i);
});
