#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const migrationName = '20261015113513_conditional_knowledge_corpus_v4.sql';
const read = (file) => readFileSync(path.join(root, file), 'utf8');
export const baseline = JSON.parse(read('tests/fixtures/knowledge-corpus-v3.json'));
export const transitions = JSON.parse(read('knowledge/transitions-v4.json'));
const newMetadata = {
  'Référentiel conditionnel des parcours SAV et service client': {
    category: 'Référentiels',
    tags: [
      'parcours conditionnel',
      'étapes précédentes',
      'prérequis',
      'transition',
      'suite possible',
    ],
  },
  'Chronologie et preuves des étapes réalisées': {
    category: 'Référentiels',
    tags: ['chronologie', 'preuve', 'historique', 'étape réalisée', 'événement', 'dates'],
  },
  'Paramétrage et validation des règles de l’entreprise': {
    category: 'Référentiels',
    tags: ['paramétrage entreprise', 'validation métier', 'gouvernance', 'politique applicable'],
  },
};
const digest = (s) => createHash('sha256').update(s).digest('hex');
const slug = (s) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
const scope =
  'Base générique de préproduction : règles propres à l’entreprise à faire valider. Une suite possible n’est pas une étape réalisée ; ce document ne confirme aucune action exécutée.';

export function buildCorpus() {
  const sections = read('knowledge/procedures-v4.md').trim().split(/^# /m).filter(Boolean);
  const docs = sections.map((entry) => {
    const [title, ...body] = entry.split('\n');
    const old = baseline.find((d) => d.title === title);
    const metadata = old ?? newMetadata[title];
    if (!metadata) throw new Error('Unknown documentary source: ' + title);
    const parts = body
      .join('\n')
      .trim()
      .split(/^## /m)
      .filter(Boolean)
      .map((text) => {
        const [heading, ...paragraphs] = text.split('\n');
        return { heading, body: paragraphs.join('\n').trim() };
      });
    if (title === 'Référentiel conditionnel des parcours SAV et service client') {
      for (const [service, states] of Object.entries(transitions.services)) {
        const entries = Object.entries(states);
        for (let offset = 0; offset < entries.length; offset += 4) {
          parts.push({
            heading: `Matrice technique ${service === 'sav' ? 'SAV' : 'service client'} · ${offset / 4 + 1}`,
            body:
              'Possibilités du moteur, à compléter par les prérequis et preuves métier décrits ci-dessus. Une transition autorisée ne constitue ni une décision ni une preuve de réalisation.\n' +
              entries
                .slice(offset, offset + 4)
                .map(
                  ([state, next]) =>
                    `${transitions.labels[state]} (${state}) → ${next.length ? next.map((s) => `${transitions.labels[s]} (${s})`).join(' ; ') : 'aucune transition ordinaire sortante'}.`,
                )
                .join('\n'),
          });
        }
      }
    }
    if (parts.length < 3) throw new Error('Incomplete procedure: ' + title);
    const content =
      `# ${title}\n\n${scope}\n\n` + parts.map((p) => `## ${p.heading}\n\n${p.body}`).join('\n\n');
    const chunks = parts.map((p) => ({
      heading: p.heading,
      content: `${title}\nVersion 4.0 · ${scope}\n\n${p.heading}\n${p.body}`,
    }));
    if (chunks.some((c) => c.content.length > 3500 || c.content.length < 200))
      throw new Error('Invalid semantic section size: ' + title);
    const category = metadata.category;
    const checksum = digest([title, category, '4.0', content, 'fr-FR', 'GLOBAL'].join('\n'));
    return {
      key: slug(title),
      title,
      category,
      version: '4.0',
      summary: parts[0].body.slice(0, 650),
      tags: [...new Set([...metadata.tags, 'corpus:v4'])],
      content,
      chunks,
      checksum,
      previousChecksum: old?.checksum ?? null,
      previousVersion: old?.version ?? null,
    };
  });
  if (docs.length !== 31 || new Set(docs.map((d) => d.title)).size !== 31)
    throw new Error('Incomplete corpus');
  if (baseline.some((old) => !docs.some((d) => d.title === old.title)))
    throw new Error('Existing procedure missing');
  return docs;
}

export function migrationSql(docs = buildCorpus()) {
  return `-- Generated from knowledge/procedures-v4.md and the reviewed static transition matrix.
-- Rebuild: node scripts/build-knowledge-corpus-v4.mjs
-- Only the explicitly seeded preproduction organization is eligible. No customer data changes.
begin;
do $publish$
declare
  v_corpus jsonb := $corpus$${JSON.stringify(docs)}$corpus$::jsonb;
  v_org uuid; v_doc jsonb; v_old public.knowledge_documents%rowtype;
  v_id uuid; v_series uuid; v_revision integer; v_count integer := 0; v_chunks integer := 0;
begin
  for v_org in select id from public.organizations where slug='maison-atlas-staging' and active loop
    perform pg_advisory_xact_lock(hashtextextended('knowledge-corpus-v4:'||v_org::text,0));
    if exists(select 1 from public.audit_events where organization_id=v_org and action='knowledge.corpus_v4_published') then
      continue;
    end if;
    v_count:=0; v_chunks:=0;
    for v_doc in select value from jsonb_array_elements(v_corpus) order by value->>'key' loop
      select count(*) into v_revision from public.knowledge_documents
        where organization_id=v_org and title=v_doc->>'title' and locale='fr-FR' and market='GLOBAL' and status='published';
      if v_revision>1 then raise exception 'Ambiguous published procedure: %',v_doc->>'title'; end if;
      select * into v_old from public.knowledge_documents
        where organization_id=v_org and title=v_doc->>'title' and locale='fr-FR' and market='GLOBAL' and status='published'
        for update;
      if v_doc->>'previousChecksum' is not null and
        (v_old.id is null or v_old.checksum is distinct from v_doc->>'previousChecksum' or v_old.version is distinct from v_doc->>'previousVersion') then
        raise exception 'Procedure changed since documentary review: %',v_doc->>'title';
      end if;
      if v_doc->>'previousChecksum' is null and v_old.id is not null then
        raise exception 'New reference collides with an existing procedure: %',v_doc->>'title';
      end if;
      if v_old.id is not null and exists(select 1 from public.knowledge_documents
        where organization_id=v_org and series_id=v_old.series_id and status in ('draft','review')) then
        raise exception 'Procedure has an unpublished revision: %',v_doc->>'title';
      end if;
      v_id:=extensions.gen_random_uuid();
      v_series:=coalesce(v_old.series_id,v_id);
      select coalesce(max(revision),0)+1 into v_revision from public.knowledge_documents
        where organization_id=v_org and series_id=v_series;
      if v_old.id is not null then
        update public.knowledge_documents set status='archived',archived_at=now(),lock_version=lock_version+1 where id=v_old.id;
      end if;
      insert into public.knowledge_documents(
        id,organization_id,series_id,revision,lock_version,title,category,version,summary,content,
        locale,market,tags,source_url,effective_from,effective_until,status,checksum,created_by,approved_by,published_at,supersedes_id
      ) values(
        v_id,v_org,v_series,v_revision,1,v_doc->>'title',v_doc->>'category','4.0',v_doc->>'summary',v_doc->>'content',
        'fr-FR','GLOBAL',array(select jsonb_array_elements_text(v_doc->'tags')),
        'https://github.com/Simo-Mesbahi/spicial-agent/blob/main/docs/knowledge-corpus-v4.md',
        current_date,v_old.effective_until,'published',v_doc->>'checksum',null,null,now(),v_old.id
      );
      insert into public.knowledge_chunks(id,organization_id,document_id,ordinal,content,metadata)
        select extensions.gen_random_uuid(),v_org,v_id,(ordinality-1)::integer,value->>'content',
          jsonb_build_object('source','conditional-corpus-v4','document_version','4.0','section',value->>'heading','document_checksum',v_doc->>'checksum')
        from jsonb_array_elements(v_doc->'chunks') with ordinality;
      v_count:=v_count+1; v_chunks:=v_chunks+jsonb_array_length(v_doc->'chunks');
    end loop;
    insert into public.audit_events(organization_id,action,entity_type,metadata)
      values(v_org,'knowledge.corpus_v4_published','knowledge_corpus',jsonb_build_object('documents',v_count,'chunks',v_chunks,
        'source','knowledge/procedures-v4.md','validation','generic_preproduction_technical','company_approval_required',true));
  end loop;
end;
$publish$;
commit;
`;
}

export function reviewMarkdown(docs = buildCorpus()) {
  return (
    '# Corpus métier conditionnel · version 4.0\n\n' +
    '28 procédures enrichies et 3 référentiels. Base générique de préproduction : la validation des règles propres à chaque entreprise reste nécessaire.\n\n' +
    'Les anciennes révisions sont conservées. Les sections sont indexées séparément pour éviter qu’une condition importante soit coupée entre deux extraits. Aucun appel IA ni service payant n’est nécessaire à cette publication lexicale.\n\n' +
    'Source éditable : [knowledge/procedures-v4.md](../knowledge/procedures-v4.md). Régénération : `node scripts/build-knowledge-corpus-v4.mjs`.\n\n' +
    docs.map((d) => d.content).join('\n\n---\n\n') +
    '\n'
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const docs = buildCorpus();
  const files = [
    [`supabase/migrations/${migrationName}`, migrationSql(docs)],
    ['docs/knowledge-corpus-v4.md', reviewMarkdown(docs)],
  ];
  if (process.argv.includes('--check')) {
    for (const [file, content] of files)
      if (read(file) !== content) throw new Error('Generated document is stale: ' + file);
  } else for (const [file, content] of files) writeFileSync(path.join(root, file), content);
  console.log(
    JSON.stringify({
      documents: docs.length,
      chunks: docs.reduce((n, d) => n + d.chunks.length, 0),
      characters: docs.reduce((n, d) => n + d.content.length, 0),
      generatedFiles: files.map(([p]) => p),
    }),
  );
}
