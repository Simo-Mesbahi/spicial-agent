import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { build } from 'esbuild';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import {
  buildCorpus,
  migrationName,
  migrationSql,
  reviewMarkdown,
  baseline,
  transitions,
} from '../scripts/build-knowledge-corpus-v4.mjs';
import { retrievalScenarios } from '../evals/retrieval.mjs';

const docs = buildCorpus();
const sha = (s) => createHash('sha256').update(s).digest('hex');
test('conditional corpus preserves every topic and has self-contained bounded semantic sections', () => {
  assert.equal(docs.length, 31);
  assert.equal(docs.filter((d) => d.previousChecksum).length, 28);
  for (const d of docs) {
    assert.equal(d.version, '4.0');
    assert.equal(
      d.checksum,
      sha([d.title, d.category, d.version, d.content, 'fr-FR', 'GLOBAL'].join('\n')),
    );
    assert.ok(d.chunks.length >= 3);
    for (const c of d.chunks) {
      assert.ok(c.content.length >= 200 && c.content.length <= 3500);
      assert.ok(c.content.startsWith(d.title));
      assert.match(c.content, /préproduction/);
      assert.match(c.content, /ne confirme aucune action exécutée/);
      assert.ok(d.content.includes(c.heading));
    }
  }
  for (const old of baseline) {
    assert.equal(
      old.checksum,
      sha([old.title, old.category, old.version, old.content, 'fr-FR', 'GLOBAL'].join('\n')),
    );
    assert.equal(docs.find((d) => d.title === old.title).previousChecksum, old.checksum);
  }
});
test('reviewed source, generated migration and readable corpus stay synchronized', () => {
  assert.equal(readFileSync('supabase/migrations/' + migrationName, 'utf8'), migrationSql());
  assert.equal(readFileSync('docs/knowledge-corpus-v4.md', 'utf8'), reviewMarkdown());
});
test('documentary transition matrix remains consistent with both services in the application', async () => {
  const r = await build({
    stdin: {
      contents:
        "export {caseStatuses,caseStatusLabels,allowedNextStatuses} from './lib/atlas/case-management.ts'",
      resolveDir: process.cwd(),
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
  });
  const m = await import(
    'data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64')
  );
  assert.deepEqual(transitions.labels, m.caseStatusLabels);
  for (const service of ['sav', 'customer_service']) {
    assert.deepEqual(Object.keys(transitions.services[service]).sort(), [...m.caseStatuses].sort());
    for (const state of m.caseStatuses)
      assert.deepEqual(
        transitions.services[service][state],
        m.allowedNextStatuses(service, state),
        `${service}/${state}`,
      );
  }
  const central = docs.find((d) => d.title.startsWith('Référentiel conditionnel'));
  for (const state of m.caseStatuses) assert.ok(central.content.includes('(' + state + ')'), state);
});

async function database() {
  const db = new PGlite({ extensions: { vector, pg_trgm, pgcrypto } });
  try {
    await db.exec(`create schema extensions; create schema auth;
      create role anon; create role authenticated; create role service_role bypassrls;
      create table auth.users(id uuid primary key,email varchar,aud varchar,role varchar);
      create table auth.sessions(id uuid primary key,user_id uuid not null references auth.users(id),not_after timestamptz);
      create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
      create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
      create function auth.role() returns text language sql stable as $$ select auth.jwt()->>'role' $$;
      grant usage on schema public,auth,extensions to anon,authenticated,service_role;
      set search_path=public,extensions;`);
    for (const file of readdirSync('supabase/migrations')
      .filter((f) => f.endsWith('.sql'))
      .sort()) {
      if (file === migrationName) break;
      await db.exec(readFileSync('supabase/migrations/' + file, 'utf8'));
    }
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}

test('corpus migration is atomic, immutable, isolated, replay-safe and searchable on PostgreSQL', async (t) => {
  const db = await database();
  const org = randomUUID(),
    other = randomUUID(),
    oldIds = new Map();
  const migration = migrationSql();
  try {
    await db.query('insert into public.organizations(id,slug,name) values($1,$2,$3),($4,$5,$6)', [
      org,
      'maison-atlas-staging',
      'Synthetic corpus review',
      other,
      'other-corpus-tenant',
      'Other organization',
    ]);
    for (const old of baseline) {
      const id = randomUUID();
      oldIds.set(old.title, id);
      await db.query(
        `insert into public.knowledge_documents(id,organization_id,series_id,revision,title,category,version,content,locale,market,tags,status,checksum,effective_from)
        values($1,$2,$1,1,$3,$4,$5,$6,'fr-FR','GLOBAL',$7,'published',$8,'2026-01-01')`,
        [id, org, old.title, old.category, old.version, old.content, old.tags, old.checksum],
      );
      await db.query(
        `insert into public.knowledge_chunks(organization_id,document_id,ordinal,content) values($1,$2,0,$3)`,
        [org, id, old.content],
      );
    }
    const outside = randomUUID(),
      localMarket = randomUUID();
    await db.query(
      `insert into public.knowledge_documents(id,organization_id,title,category,version,content,market,status,checksum)
      values($1,$2,$3,'SAV','enterprise','Entreprise privée hors périmètre','GLOBAL','published',$4),
        ($5,$6,$3,'SAV','market-specific','Politique spécifique LU','LU','published',$7)`,
      [outside, other, baseline[0].title, sha('outside'), localMarket, org, sha('market')],
    );
    await db.exec(`select set_config('request.jwt.claims','{"role":"service_role"}',false)`);

    await t.test('a concurrently changed source aborts the whole publication', async () => {
      const changed = baseline.find((d) => d.title === 'Un appareil présente un danger');
      await db.query('update public.knowledge_documents set checksum=$1 where id=$2', [
        sha('edited-after-review'),
        oldIds.get(changed.title),
      ]);
      await assert.rejects(db.exec(migration), /changed since documentary review/);
      await db.exec('rollback');
      const r = await db.query(
        `select count(*)::int as count from public.knowledge_documents where organization_id=$1 and version='4.0'`,
        [org],
      );
      assert.equal(r.rows[0].count, 0);
      assert.equal(
        (
          await db.query(
            `select count(*)::int as n from public.knowledge_documents where organization_id=$1 and status='archived'`,
            [org],
          )
        ).rows[0].n,
        0,
      );
      await db.query('update public.knowledge_documents set checksum=$1 where id=$2', [
        changed.checksum,
        oldIds.get(changed.title),
      ]);
    });
    await t.test(
      'an unpublished revision is preserved and prevents a publication collision',
      async () => {
        const id = oldIds.get(baseline[0].title),
          draft = randomUUID();
        await db.query(
          `insert into public.knowledge_documents(id,organization_id,series_id,revision,title,category,version,content,status,checksum)
        values($1,$2,$3,2,$4,'SAV','pending','Une révision en cours de relecture','review',$5)`,
          [draft, org, id, baseline[0].title, sha('draft')],
        );
        await assert.rejects(db.exec(migration), /unpublished revision/);
        await db.exec('rollback');
        assert.equal(
          (await db.query('select status from public.knowledge_documents where id=$1', [draft]))
            .rows[0].status,
          'review',
        );
        await db.query('delete from public.knowledge_documents where id=$1', [draft]);
      },
    );
    await db.exec(migration);
    await t.test(
      'published revisions and old evidence are retained without crossing tenant or market boundaries',
      async () => {
        const published = await db.query(
          `select title,content,checksum,version,revision,supersedes_id from public.knowledge_documents where organization_id=$1 and status='published' and market='GLOBAL' order by title`,
          [org],
        );
        assert.equal(published.rows.length, 31);
        for (const row of published.rows) {
          const source = docs.find((d) => d.title === row.title);
          assert.equal(row.content, source.content);
          assert.equal(row.checksum, source.checksum);
          assert.equal(row.version, '4.0');
          assert.equal(row.supersedes_id, oldIds.get(row.title) ?? null);
          assert.equal(row.revision, oldIds.has(row.title) ? 2 : 1);
        }
        for (const old of baseline) {
          const r = (
            await db.query(
              'select content,checksum,status from public.knowledge_documents where id=$1',
              [oldIds.get(old.title)],
            )
          ).rows[0];
          assert.deepEqual(r, { content: old.content, checksum: old.checksum, status: 'archived' });
        }
        assert.deepEqual(
          (
            await db.query('select content,status from public.knowledge_documents where id=$1', [
              outside,
            ])
          ).rows[0],
          { content: 'Entreprise privée hors périmètre', status: 'published' },
        );
        assert.equal(
          (
            await db.query('select status from public.knowledge_documents where id=$1', [
              localMarket,
            ])
          ).rows[0].status,
          'published',
        );
        const chunks = await db.query(
          `select c.content,c.metadata,d.checksum from public.knowledge_chunks c join public.knowledge_documents d on d.id=c.document_id where d.organization_id=$1 and d.status='published' and d.version='4.0'`,
          [org],
        );
        assert.equal(chunks.rows.length, 110);
        for (const row of chunks.rows) {
          assert.ok(row.content.length <= 3500);
          assert.equal(row.metadata.document_checksum, row.checksum);
          assert.match(row.content, /ne confirme aucune action exécutée/);
        }
      },
    );
    await t.test(
      'published procedures remain retrievable for the 20 multilingual-query rewrites',
      async () => {
        for (const scenario of retrievalScenarios) {
          const r = await db.query(
            "select title from app_private.knowledge_search($1,$2,3,'fr-FR','FR')",
            [org, scenario.retrievalQuery],
          );
          assert.ok(
            r.rows.some((row) => scenario.expectedTitles.includes(row.title)),
            `${scenario.id}: ${r.rows.map((x) => x.title).join(' | ')}`,
          );
        }
      },
    );
    await t.test(
      'conditional, evidence, contact and return questions find relevant sections',
      async () => {
        const scenarios = [
          [
            'devis modifié ancien accord version acceptation',
            ['Accepter ou refuser un devis', 'Chronologie et preuves des étapes réalisées'],
          ],
          [
            'étapes précédentes réalisées historique preuve',
            [
              'Chronologie et preuves des étapes réalisées',
              'Référentiel conditionnel des parcours SAV et service client',
            ],
          ],
          [
            'réparation terminée retrait magasin disponible',
            ['Récupérer un produit réparé', 'Comprendre le suivi de réparation'],
          ],
          [
            'retour réceptionné contrôle remboursement',
            ['Demander un retour ou un échange', 'Suivre un remboursement'],
          ],
          [
            'contact conseiller email préparé transmission confirmée',
            ['Contacter un conseiller', 'Préparer un handoff conseiller de haute qualité'],
          ],
          [
            'pièce indisponible estimation dépassée',
            ['Attente de pièce ou pièce indisponible', 'Dossier SAV sans estimation ou en retard'],
          ],
          [
            'chronologie correction administrative version événement',
            ['Chronologie et preuves des étapes réalisées'],
          ],
          [
            'paramétrage entreprise calendrier règles frais',
            ['Paramétrage et validation des règles de l’entreprise'],
          ],
          ['commande indiquée livrée mais non reçue', ['Commande indiquée livrée mais non reçue']],
          [
            'relai conseiller clôture réponse envoyée',
            ['Contacter un conseiller', 'Préparer un handoff conseiller de haute qualité'],
          ],
        ];
        for (const [query, expected] of scenarios) {
          const r = await db.query(
            "select title,content from app_private.knowledge_search($1,$2,3,'fr-FR','FR')",
            [org, query],
          );
          assert.ok(
            r.rows.some((row) => expected.includes(row.title)),
            `${query}: ${r.rows.map((x) => x.title).join(' | ')}`,
          );
          assert.ok(r.rows.every((row) => row.content.includes('Version 4.0')));
        }
      },
    );
    await t.test(
      'replaying the reviewed migration neither republishes nor duplicates chunks',
      async () => {
        const before = (
          await db.query(
            `select count(*)::int as n from public.knowledge_chunks where organization_id=$1`,
            [org],
          )
        ).rows[0].n;
        await db.exec(migration);
        assert.equal(
          (
            await db.query(
              `select count(*)::int as n from public.knowledge_chunks where organization_id=$1`,
              [org],
            )
          ).rows[0].n,
          before,
        );
        assert.equal(
          (
            await db.query(
              `select count(*)::int as n from public.audit_events where organization_id=$1 and action='knowledge.corpus_v4_published'`,
              [org],
            )
          ).rows[0].n,
          1,
        );
        assert.equal(
          (
            await db.query(
              "select count(*)::int as n from pg_tables where schemaname='public' and not rowsecurity",
            )
          ).rows[0].n,
          0,
        );
        assert.equal(
          (
            await db.query(
              "select has_function_privilege('anon','public.knowledge_revalidate_sources(uuid,jsonb)','EXECUTE') as allowed",
            )
          ).rows[0].allowed,
          false,
        );
      },
    );
  } finally {
    await db.close();
  }
});
