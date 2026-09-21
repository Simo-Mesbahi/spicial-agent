import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { readFileSync } from 'node:fs';
const migration = (name) => readFileSync('supabase/migrations/' + name, 'utf8');
export async function knowledgePostgres() {
  const db = new PGlite({ extensions: { vector, pg_trgm } });
  await db.exec(`create schema extensions; create schema app_private; create schema auth;
    create extension vector with schema extensions; create extension pg_trgm with schema extensions;
    create role anon; create role authenticated; create role service_role bypassrls;
    create table public.organizations(id uuid primary key);
    create table auth.users(id uuid primary key);
    create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)::text$$;
    set request.jwt.claim.role='service_role';
    create function app_private.is_admin(uuid,text[],boolean) returns boolean language sql stable as 'select false';
    grant usage on schema extensions,app_private,auth to service_role;`);
  const foundation = migration('20260907051405_production_foundation.sql');
  await db.exec(
    foundation.slice(
      foundation.indexOf('create table if not exists public.knowledge_documents'),
      foundation.indexOf('create table if not exists public.audit_events'),
    ),
  );
  const control = migration('20260918100917_knowledge_control_plane.sql');
  await db.exec(
    control.slice(
      0,
      control.indexOf('create or replace function app_private.knowledge_write_allowed'),
    ) + '\ncommit;',
  );
  const index = migration('20260918105536_seed_procedures_and_rag_v2.sql');
  await db.exec(
    index.slice(0, index.indexOf('create or replace function app_private.knowledge_search')) +
      '\ncommit;',
  );
  await db.exec(migration('20260918131105_knowledge_search_trigram_ranking.sql'));
  await db.exec(`alter table public.knowledge_documents enable row level security;
    alter table public.knowledge_chunks enable row level security;
    grant execute on function app_private.knowledge_search(uuid,text,integer,text,text) to service_role;`);
  await db.exec(migration('20260920181024_hybrid_knowledge_retrieval.sql'));
  return db;
}
