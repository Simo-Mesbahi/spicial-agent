import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migrationPath =
  'supabase/migrations/20260922084120_case_entity_lookup.sql';

function sql() {
  return readFileSync(migrationPath, 'utf8');
}

test('entity lookup stays tenant-scoped, manager-only and MFA-backed', () => {
  const source = sql();

  assert.match(
    source,
    /app_private\.is_admin\([\s\S]*array\['super_admin','sav_manager','sc_manager'\][\s\S]*true[\s\S]*\)/,
  );
  assert.match(
    source,
    /from public\.customers c[\s\S]*where c\.organization_id=p_organization_id/,
  );
  assert.match(
    source,
    /from public\.products p[\s\S]*where p\.organization_id=p_organization_id/,
  );
  assert.doesNotMatch(source, /array\[[^\]]*'adviser'/);
});

test('entity lookup is bounded and rejects broad directory enumeration', () => {
  const source = sql();

  assert.match(source, /char_length\(v_query\)<3/);
  assert.match(
    source,
    /v_limit integer := least\(greatest\(coalesce\(p_limit,12\),1\),20\)/,
  );
  assert.match(source, /limit v_limit/g);
  assert.match(source, /'items','\[\]'::jsonb/);
});

test('entity lookup uses trigram indexes and literal-safe wildcard handling', () => {
  const source = sql();

  assert.match(source, /customers_case_lookup_trgm_idx/);
  assert.match(source, /products_case_lookup_trgm_idx/);
  assert.match(source, /extensions\.gin_trgm_ops/g);
  assert.match(source, /replace\([\s\S]*'%','!%'[\s\S]*'_','!_'/);
  assert.match(source, /escape '!'/g);
  assert.match(source, /operator\(extensions\.%>\)/g);
});

test('entity lookup RPC is authenticated-only and uses security invoker', () => {
  const source = sql();

  assert.match(
    source,
    /create or replace function public\.admin_case_entity_search\(/,
  );
  assert.match(source, /security invoker/);
  assert.match(
    source,
    /revoke all on function public\.admin_case_entity_search\([\s\S]*from public,anon/,
  );
  assert.match(
    source,
    /grant execute on function public\.admin_case_entity_search\([\s\S]*to authenticated/,
  );
});


test('admin case creation reuses selected entity ids with cancellable debounced lookup', () => {
  const page = readFileSync('app/admin/operations/page.tsx', 'utf8');

  assert.match(page, /new AbortController\(\)/);
  assert.match(page, /window\.setTimeout\(\(\) => \{/);
  assert.match(page, /\}, 280\)/);
  assert.match(page, /customerId: selectedCustomer\?\.id \?\? null/);
  assert.match(page, /productId: selectedProduct\?\.id \?\? null/);
  assert.match(page, /!selectedCustomer && \(/);
  assert.match(page, /!selectedProduct && createDraft\.productName/);
  assert.match(page, /setSelectedCustomer\(null\)/);
  assert.match(page, /setSelectedProduct\(null\)/);
});
