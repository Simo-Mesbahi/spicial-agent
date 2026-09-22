-- P1.7B — fresh documentary evidence revalidation.
-- Re-checks exact evidence chunks against the live published knowledge control plane
-- immediately before a model-generated response can cross the customer release gate.

begin;

create or replace function public.knowledge_revalidate_sources(
  p_organization_id uuid,
  p_sources jsonb
)
returns table(
  document_id uuid,
  chunk_id uuid,
  version text,
  revision integer,
  locale text,
  market text,
  effective_from date,
  effective_until date,
  content text
)
language plpgsql
stable
security definer
set search_path=''
as $$
begin
  if p_organization_id is null
     or p_sources is null
     or jsonb_typeof(p_sources)<>'array'
     or jsonb_array_length(p_sources) not between 1 and 3 then
    raise exception using errcode='22023',message='invalid_knowledge_revalidation_request';
  end if;

  if exists(
    select 1
    from jsonb_array_elements(p_sources) item
    where jsonb_typeof(item)<>'object'
      or not (item ? 'document_id')
      or not (item ? 'chunk_id')
      or not (item ? 'version')
      or not (item ? 'locale')
      or not (item ? 'market')
  ) then
    raise exception using errcode='22023',message='invalid_knowledge_revalidation_request';
  end if;

  return query
  with requested as (
    select distinct
      (item->>'document_id')::uuid as document_id,
      (item->>'chunk_id')::uuid as chunk_id,
      item->>'version' as version,
      item->>'locale' as locale,
      item->>'market' as market
    from jsonb_array_elements(p_sources) item
  )
  select
    d.id,
    c.id,
    d.version,
    d.revision,
    d.locale,
    d.market,
    d.effective_from,
    d.effective_until,
    c.content
  from requested r
  join public.knowledge_documents d
    on d.id=r.document_id
   and d.organization_id=p_organization_id
   and d.version=r.version
   and d.locale=r.locale
   and d.market=r.market
   and d.status='published'
   and (d.effective_from is null or d.effective_from<=current_date)
   and (d.effective_until is null or d.effective_until>=current_date)
  join public.knowledge_chunks c
    on c.id=r.chunk_id
   and c.document_id=d.id
   and c.organization_id=p_organization_id
  where not exists(
    select 1
    from public.knowledge_documents newer
    where newer.organization_id=d.organization_id
      and newer.series_id=d.series_id
      and newer.status='published'
      and newer.revision>d.revision
  )
  order by d.id,c.id;
end;
$$;

revoke all on function public.knowledge_revalidate_sources(uuid,jsonb)
  from public,anon,authenticated;
grant execute on function public.knowledge_revalidate_sources(uuid,jsonb)
  to service_role;

comment on function public.knowledge_revalidate_sources(uuid,jsonb) is
  'Server-only exact evidence freshness check used by the P1.7 customer release gate. Returns only still-published, effective, non-superseded chunks matching the original evidence identity.';

commit;
