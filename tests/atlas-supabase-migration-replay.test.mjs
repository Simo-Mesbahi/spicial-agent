import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

// Exercise the complete, unmodified application migrations on an empty Postgres.
// Only the Supabase-owned Auth contracts are provisioned here: this does not
// simulate GoTrue, a hosted deployment, or the platform's network availability.
test('all Supabase migrations replay and the SQL operations contract passes', async () => {
  const db = new PGlite({ extensions: { vector, pg_trgm, pgcrypto } });
  try {
    await db.exec(`
      create schema extensions;
      create schema auth;
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create table auth.users (
        id uuid primary key, email varchar, aud varchar, role varchar
      );
      create table auth.sessions (
        id uuid primary key, user_id uuid not null references auth.users(id),
        not_after timestamptz
      );
      create function auth.jwt() returns jsonb language sql stable as $$
        select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
      $$;
      create function auth.uid() returns uuid language sql stable as $$
        select (auth.jwt()->>'sub')::uuid
      $$;
      create function auth.role() returns text language sql stable as $$
        select auth.jwt()->>'role'
      $$;
      grant usage on schema public, auth, extensions to anon, authenticated, service_role;
      set search_path = public, extensions;
    `);

    const migrations = readdirSync('supabase/migrations')
      .filter((file) => file.endsWith('.sql'))
      .sort();
    assert.ok(migrations.length > 0, 'migration discovery must not silently pass empty');
    for (const file of migrations) {
      try {
        await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'));
      } catch (cause) {
        throw new Error(`Migration replay failed: ${file}: ${cause.message}`, { cause });
      }
    }

    const unprotected = await db.query(
      "select tablename from pg_tables where schemaname = 'public' and not rowsecurity",
    );
    assert.deepEqual(unprotected.rows, [], 'all application tables must enable RLS');

    for (const file of ['operations.sql', 'overview-scopes.sql']) {
      const results = await db.exec(readFileSync(`supabase/tests/${file}`, 'utf8'));
      assert.ok(
        results.some((result) => result.rows.some((row) => String(row.result).startsWith('PASS:'))),
        `${file} must reach its explicit success marker`,
      );
    }
    const leftovers = await db.query(`
      select (select count(*)::int from public.organizations) as organizations,
        (select count(*)::int from auth.users) as users,
        (select count(*)::int from auth.sessions) as sessions
    `);
    assert.deepEqual(leftovers.rows, [{ organizations: 0, users: 0, sessions: 0 }]);
  } finally {
    await db.close();
  }
});
