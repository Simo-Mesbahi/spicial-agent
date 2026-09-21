begin;

-- An embedding is usable only with its exact model space and source checksum.
-- Existing unlabelled vectors remain excluded; no destructive backfill.
alter table public.knowledge_chunks
  add column if not exists embedding_space text,
  add column if not exists embedding_checksum text;
create index if not exists knowledge_chunks_embedding_scope_idx
  on public.knowledge_chunks(organization_id, embedding_space, document_id)
  where embedding is not null;

create or replace function app_private.invalidate_knowledge_embedding()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.content is distinct from old.content then
    new.embedding := null; new.embedding_space := null; new.embedding_checksum := null;
  end if;
  return new;
end;
$$;
revoke all on function app_private.invalidate_knowledge_embedding() from public, anon, authenticated;
create trigger knowledge_chunks_invalidate_embedding before update of content on public.knowledge_chunks
for each row execute function app_private.invalidate_knowledge_embedding();

-- Service-only RPCs use invoker rights; no client grant or RLS policy is relaxed.
grant usage on schema extensions,app_private to service_role;
grant select on public.knowledge_documents,public.knowledge_chunks to service_role;
grant update(embedding,embedding_space,embedding_checksum) on public.knowledge_chunks to service_role;
create function public.knowledge_hybrid_candidates(
  p_organization_id uuid, p_query text, p_locale text, p_market text,
  p_embedding_space text, p_embedding extensions.vector default null,
  p_min_similarity real default 0.7
) returns jsonb language plpgsql stable security invoker set search_path = '' as $$
begin
  if p_locale is null or p_market is null or char_length(coalesce(p_query,'')) not between 2 and 500
     or p_locale !~ '^[a-z]{2}(-[A-Z]{2})?$' or p_market !~ '^[A-Z0-9][A-Z0-9_-]{1,15}$'
     or (p_embedding is not null and (p_embedding_space is null or p_embedding_space !~ '^[a-f0-9]{64}$'))
     or p_min_similarity is null or p_min_similarity not between 0 and 1
     or (p_embedding is not null and (extensions.vector_dims(p_embedding)<>768 or extensions.vector_norm(p_embedding)=0)) then
    raise exception using errcode='22023', message='invalid_knowledge_query';
  end if;
  return (
    with eligible as materialized (
      select d.* from public.knowledge_documents d
      where d.organization_id=p_organization_id and d.status='published'
        and (d.effective_from is null or d.effective_from<=current_date)
        and (d.effective_until is null or d.effective_until>=current_date)
        and d.locale=p_locale and d.market in ('GLOBAL',p_market)
        and not exists(select 1 from public.knowledge_documents newer
          where newer.organization_id=d.organization_id and newer.series_id=d.series_id
            and newer.status='published' and newer.revision>d.revision)
    ), lexical as (
      select r.document_id,r.chunk_id,r.rank,'lexical'::text as channel
      from app_private.knowledge_search(p_organization_id,left(p_query,500),8,p_locale,p_market) r
      join eligible d on d.id=r.document_id
    ), semantic_chunks as (
      select c.document_id,c.id as chunk_id,
        (1-(c.embedding operator(extensions.<=>) p_embedding))::real as rank
      from public.knowledge_chunks c join eligible d on d.id=c.document_id
      where p_embedding is not null and c.organization_id=p_organization_id
        and c.embedding_space=p_embedding_space and c.embedding is not null
        and c.embedding_checksum=encode(sha256(convert_to(c.content,'UTF8')),'hex')
        -- Never expose a partially indexed document in the vector channel.
        and not exists(select 1 from public.knowledge_chunks missing
          where missing.organization_id=p_organization_id and missing.document_id=d.id
            and (missing.embedding is null or missing.embedding_space is distinct from p_embedding_space
              or missing.embedding_checksum is distinct from encode(sha256(convert_to(missing.content,'UTF8')),'hex')))
      order by c.embedding operator(extensions.<=>) p_embedding
      limit 32
    ), semantic_docs as (
      select distinct on (document_id) document_id,chunk_id,rank,'vector'::text as channel
      from semantic_chunks where rank>=p_min_similarity
      order by document_id,rank desc,chunk_id
    ), semantic as (select * from semantic_docs order by rank desc,chunk_id limit 8),
    candidates as (select * from lexical union all select * from semantic)
    select coalesce(jsonb_agg(jsonb_build_object(
      'organization_id',d.organization_id,'document_id',d.id,'series_id',d.series_id,
      'revision',d.revision,'status',d.status,'chunk_id',c.id,'title',d.title,
      'category',d.category,'version',d.version,'locale',d.locale,'market',d.market,
      'effective_from',d.effective_from,'effective_until',d.effective_until,
      'chunk_ordinal',c.ordinal,'content',c.content,
      'content_hash',encode(sha256(convert_to(c.content,'UTF8')),'hex'),
      'channel',r.channel,'rank',r.rank
    ) order by r.channel,r.rank desc,c.id),'[]'::jsonb)
    from candidates r join eligible d on d.id=r.document_id
    join public.knowledge_chunks c on c.id=r.chunk_id and c.organization_id=p_organization_id and c.document_id=d.id
  );
end;
$$;

create function public.knowledge_embedding_batch(p_organization_id uuid,p_embedding_space text,p_limit integer default 32)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(batch)),'[]'::jsonb) from (
    select c.id as chunk_id,c.content,encode(sha256(convert_to(c.content,'UTF8')),'hex') as checksum
    from public.knowledge_chunks c join public.knowledge_documents d
      on d.id=c.document_id and d.organization_id=c.organization_id
    where c.organization_id=p_organization_id and d.status='published'
      and (c.embedding is null or c.embedding_space is distinct from p_embedding_space
        or c.embedding_checksum is distinct from encode(sha256(convert_to(c.content,'UTF8')),'hex'))
    order by c.document_id,c.ordinal,c.id limit least(greatest(coalesce(p_limit,32),1),32)
  ) batch;
$$;

create function public.knowledge_store_embeddings(p_organization_id uuid,p_embedding_space text,p_rows jsonb)
returns integer language plpgsql security invoker set search_path = '' as $$
declare item jsonb; value extensions.vector; changed integer; total integer:=0;
begin
  if p_embedding_space is null or p_embedding_space !~ '^[a-f0-9]{64}$'
     or jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 32 then
    raise exception using errcode='22023',message='invalid_embedding_batch';
  end if;
  for item in select * from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(item->'embedding') is distinct from 'array'
       or jsonb_array_length(item->'embedding')<>768 then
      raise exception using errcode='22023',message='invalid_embedding';
    end if;
    value := (item->>'embedding')::extensions.vector;
    if extensions.vector_norm(value)=0 then raise exception using errcode='22023',message='invalid_embedding'; end if;
    update public.knowledge_chunks c
      set embedding=value,embedding_space=p_embedding_space,embedding_checksum=item->>'checksum'
      where c.id=(item->>'chunk_id')::uuid and c.organization_id=p_organization_id
        and encode(sha256(convert_to(c.content,'UTF8')),'hex')=item->>'checksum'
        and exists(select 1 from public.knowledge_documents d where d.id=c.document_id
          and d.organization_id=p_organization_id and d.status='published');
    get diagnostics changed=row_count;
    if changed<>1 then raise exception using errcode='40001',message='embedding_source_changed'; end if;
    total := total+changed;
  end loop;
  return total;
end;
$$;
revoke all on function public.knowledge_hybrid_candidates(uuid,text,text,text,text,extensions.vector,real) from public,anon,authenticated;
revoke all on function public.knowledge_embedding_batch(uuid,text,integer) from public,anon,authenticated;
revoke all on function public.knowledge_store_embeddings(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.knowledge_hybrid_candidates(uuid,text,text,text,text,extensions.vector,real) to service_role;
grant execute on function public.knowledge_embedding_batch(uuid,text,integer) to service_role;
grant execute on function public.knowledge_store_embeddings(uuid,text,jsonb) to service_role;
commit;
