begin;

insert into public.knowledge_chunks(id,organization_id,document_id,ordinal,content,metadata)
select
  extensions.gen_random_uuid(),
  d.organization_id,
  d.id,
  0,
  d.content,
  jsonb_build_object(
    'bootstrap', true,
    'source', 'knowledge-document-backfill',
    'document_version', d.version
  )
from public.knowledge_documents d
where d.status='published'
  and char_length(trim(d.content)) > 0
  and not exists (
    select 1
    from public.knowledge_chunks c
    where c.organization_id=d.organization_id and c.document_id=d.id
  );

commit;
