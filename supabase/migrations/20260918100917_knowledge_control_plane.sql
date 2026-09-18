-- Professional knowledge control plane: versioned procedures, maker/checker publication,
-- immutable published revisions, audited mutations and indexed retrieval.

begin;

alter table public.knowledge_documents
  add column if not exists series_id uuid,
  add column if not exists revision integer,
  add column if not exists lock_version integer,
  add column if not exists locale text,
  add column if not exists market text,
  add column if not exists tags text[],
  add column if not exists summary text,
  add column if not exists published_at timestamptz,
  add column if not exists archived_at timestamptz,
  add column if not exists supersedes_id uuid references public.knowledge_documents(id) on delete set null;

update public.knowledge_documents
set series_id = coalesce(series_id, id),
    revision = coalesce(revision, 1),
    lock_version = coalesce(lock_version, 1),
    locale = coalesce(locale, 'fr-FR'),
    market = coalesce(market, 'GLOBAL'),
    tags = coalesce(tags, '{}'::text[])
where series_id is null
   or revision is null
   or lock_version is null
   or locale is null
   or market is null
   or tags is null;

alter table public.knowledge_documents
  alter column series_id set not null,
  alter column series_id set default gen_random_uuid(),
  alter column revision set not null,
  alter column revision set default 1,
  alter column lock_version set not null,
  alter column lock_version set default 1,
  alter column locale set not null,
  alter column locale set default 'fr-FR',
  alter column market set not null,
  alter column market set default 'GLOBAL',
  alter column tags set not null,
  alter column tags set default '{}'::text[];

alter table public.knowledge_documents
  drop constraint if exists knowledge_documents_revision_positive,
  add constraint knowledge_documents_revision_positive check (revision > 0),
  drop constraint if exists knowledge_documents_lock_version_positive,
  add constraint knowledge_documents_lock_version_positive check (lock_version > 0),
  drop constraint if exists knowledge_documents_locale_format,
  add constraint knowledge_documents_locale_format check (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  drop constraint if exists knowledge_documents_market_format,
  add constraint knowledge_documents_market_format check (market ~ '^[A-Z0-9][A-Z0-9_-]{1,15}$'),
  drop constraint if exists knowledge_documents_summary_length,
  add constraint knowledge_documents_summary_length check (summary is null or char_length(summary) <= 1000),
  drop constraint if exists knowledge_documents_tags_count,
  add constraint knowledge_documents_tags_count check (cardinality(tags) <= 30);

create unique index if not exists knowledge_documents_series_revision_idx
  on public.knowledge_documents(organization_id, series_id, revision);
create index if not exists knowledge_documents_org_workflow_idx
  on public.knowledge_documents(organization_id, status, updated_at desc);
create index if not exists knowledge_documents_org_scope_idx
  on public.knowledge_documents(organization_id, locale, market, status);
create index if not exists knowledge_documents_effective_idx
  on public.knowledge_documents(organization_id, effective_from, effective_until)
  where status = 'published';
-- Direct table writes are intentionally removed from authenticated clients.
-- All mutations pass through audited SECURITY DEFINER RPCs below.
revoke insert, update, delete on public.knowledge_documents from authenticated;
revoke insert, update, delete on public.knowledge_chunks from authenticated;
drop policy if exists knowledge_admin_write on public.knowledge_documents;
drop policy if exists knowledge_admin_insert on public.knowledge_documents;
drop policy if exists knowledge_admin_update on public.knowledge_documents;

create or replace function app_private.knowledge_write_allowed(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.is_admin(
    p_organization_id,
    array['super_admin','sav_manager','sc_manager'],
    true
  );
$$;

create or replace function public.admin_knowledge_list(
  p_organization_id uuid,
  p_status text default null,
  p_search text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit,50),1),100);
  v_offset integer := greatest(coalesce(p_offset,0),0);
begin
  if not app_private.is_admin(p_organization_id, null, true) then
    raise exception using errcode='42501', message='admin_access_denied';
  end if;
  if p_status is not null and p_status not in ('draft','review','published','archived') then
    raise exception using errcode='22023', message='invalid_knowledge_status';
  end if;
  return (
    with filtered as materialized (
      select d.*
      from public.knowledge_documents d
      where d.organization_id = p_organization_id
        and (p_status is null or d.status = p_status)
        and (
          nullif(trim(coalesce(p_search,'')),'') is null
          or d.title ilike '%' || trim(p_search) || '%'
          or d.category ilike '%' || trim(p_search) || '%'
          or d.content ilike '%' || trim(p_search) || '%'
          or exists (
            select 1 from unnest(d.tags) tag
            where tag ilike '%' || trim(p_search) || '%'
          )
        )
    )
    select jsonb_build_object(
      'items', coalesce((
        select jsonb_agg(to_jsonb(x) order by x.updated_at desc, x.id)
        from (
          select id, series_id, revision, lock_version, title, category, version,
            summary, locale, market, tags, source_url, effective_from, effective_until,
            status, created_by, approved_by, published_at, archived_at,
            created_at, updated_at,
            (select count(*)::integer from public.knowledge_chunks c where c.document_id=d.id) as chunk_count
          from filtered d
          order by updated_at desc, id
          limit v_limit offset v_offset
        ) x
      ), '[]'::jsonb),
      'total', (select count(*) from filtered),
      'counts', (
        select jsonb_build_object(
          'draft', count(*) filter(where status='draft'),
          'review', count(*) filter(where status='review'),
          'published', count(*) filter(where status='published'),
          'archived', count(*) filter(where status='archived'),
          'expired', count(*) filter(where status='published' and effective_until < current_date)
        )
        from public.knowledge_documents
        where organization_id = p_organization_id
      )
    )
  );
end;
$$;

create or replace function public.admin_knowledge_get(
  p_organization_id uuid,
  p_document_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app_private.is_admin(p_organization_id, null, true) then
    raise exception using errcode='42501', message='admin_access_denied';
  end if;
  return (
    select jsonb_build_object(
      'id', d.id,
      'series_id', d.series_id,
      'revision', d.revision,
      'lock_version', d.lock_version,
      'title', d.title,
      'category', d.category,
      'version', d.version,
      'summary', d.summary,
      'content', d.content,
      'locale', d.locale,
      'market', d.market,
      'tags', d.tags,
      'source_url', d.source_url,
      'effective_from', d.effective_from,
      'effective_until', d.effective_until,
      'status', d.status,
      'checksum', d.checksum,
      'created_by', d.created_by,
      'approved_by', d.approved_by,
      'published_at', d.published_at,
      'archived_at', d.archived_at,
      'supersedes_id', d.supersedes_id,
      'created_at', d.created_at,
      'updated_at', d.updated_at,
      'chunk_count', (select count(*) from public.knowledge_chunks c where c.document_id=d.id)
    )
    from public.knowledge_documents d
    where d.organization_id=p_organization_id and d.id=p_document_id
  );
end;
$$;

create or replace function public.admin_knowledge_create(
  p_organization_id uuid,
  p_title text,
  p_category text,
  p_version text,
  p_content text,
  p_summary text default null,
  p_locale text default 'fr-FR',
  p_market text default 'GLOBAL',
  p_tags text[] default '{}'::text[],
  p_source_url text default null,
  p_effective_from date default null,
  p_effective_until date default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := extensions.gen_random_uuid();
  v_checksum text;
begin
  if not app_private.knowledge_write_allowed(p_organization_id) then
    raise exception using errcode='42501', message='knowledge_write_denied';
  end if;
  if char_length(trim(p_title)) not between 2 and 240
     or char_length(trim(p_category)) not between 2 and 120
     or char_length(trim(p_version)) not between 1 and 80
     or char_length(trim(p_content)) not between 20 and 120000
     or p_locale !~ '^[a-z]{2}(-[A-Z]{2})?$'
     or p_market !~ '^[A-Z0-9][A-Z0-9_-]{1,15}$'
     or cardinality(coalesce(p_tags,'{}'::text[])) > 30
     or (p_effective_from is not null and p_effective_until is not null and p_effective_until < p_effective_from) then
    raise exception using errcode='22023', message='invalid_knowledge_document';
  end if;
  v_checksum := encode(
    extensions.digest(
      convert_to(trim(p_title)||E'\n'||trim(p_category)||E'\n'||trim(p_version)||E'\n'||trim(p_content)||E'\n'||p_locale||E'\n'||p_market,'UTF8'),
      'sha256'
    ),
    'hex'
  );
  insert into public.knowledge_documents(
    id, organization_id, series_id, revision, lock_version,
    title, category, version, summary, content, locale, market, tags,
    source_url, effective_from, effective_until, status, checksum, created_by
  ) values (
    v_id, p_organization_id, v_id, 1, 1,
    trim(p_title), trim(p_category), trim(p_version), nullif(trim(coalesce(p_summary,'')),''),
    trim(p_content), p_locale, p_market,
    coalesce((select array_agg(distinct trim(tag)) filter(where trim(tag)<>'') from unnest(coalesce(p_tags,'{}'::text[])) tag),'{}'::text[]),
    nullif(trim(coalesce(p_source_url,'')),''),
    p_effective_from, p_effective_until, 'draft', v_checksum, (select auth.uid())
  );
  insert into public.audit_events(organization_id,actor_user_id,action,entity_type,entity_id,outcome,metadata)
  values(p_organization_id,(select auth.uid()),'knowledge.created','knowledge_document',v_id,'success',
    jsonb_build_object('revision',1,'version',trim(p_version),'locale',p_locale,'market',p_market));
  return v_id;
end;
$$;

create or replace function public.admin_knowledge_update(
  p_organization_id uuid,
  p_document_id uuid,
  p_expected_lock_version integer,
  p_title text,
  p_category text,
  p_version text,
  p_content text,
  p_summary text,
  p_locale text,
  p_market text,
  p_tags text[],
  p_source_url text,
  p_effective_from date,
  p_effective_until date
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current public.knowledge_documents%rowtype;
  v_checksum text;
  v_lock integer;
begin
  if not app_private.knowledge_write_allowed(p_organization_id) then
    raise exception using errcode='42501', message='knowledge_write_denied';
  end if;
  select * into v_current
  from public.knowledge_documents
  where organization_id=p_organization_id and id=p_document_id
  for update;
  if not found then raise exception using errcode='P0002', message='knowledge_document_not_found'; end if;
  if v_current.status in ('published','archived') then
    raise exception using errcode='22023', message='published_revision_immutable';
  end if;
  if v_current.lock_version <> p_expected_lock_version then
    raise exception using errcode='40001', message='knowledge_version_conflict';
  end if;
  if char_length(trim(p_title)) not between 2 and 240
     or char_length(trim(p_category)) not between 2 and 120
     or char_length(trim(p_version)) not between 1 and 80
     or char_length(trim(p_content)) not between 20 and 120000
     or p_locale !~ '^[a-z]{2}(-[A-Z]{2})?$'
     or p_market !~ '^[A-Z0-9][A-Z0-9_-]{1,15}$'
     or cardinality(coalesce(p_tags,'{}'::text[])) > 30
     or (p_effective_from is not null and p_effective_until is not null and p_effective_until < p_effective_from) then
    raise exception using errcode='22023', message='invalid_knowledge_document';
  end if;
  v_checksum := encode(
    extensions.digest(
      convert_to(trim(p_title)||E'\n'||trim(p_category)||E'\n'||trim(p_version)||E'\n'||trim(p_content)||E'\n'||p_locale||E'\n'||p_market,'UTF8'),
      'sha256'
    ),
    'hex'
  );
  update public.knowledge_documents
  set title=trim(p_title), category=trim(p_category), version=trim(p_version),
      summary=nullif(trim(coalesce(p_summary,'')),''),
      content=trim(p_content), locale=p_locale, market=p_market,
      tags=coalesce((select array_agg(distinct trim(tag)) filter(where trim(tag)<>'') from unnest(coalesce(p_tags,'{}'::text[])) tag),'{}'::text[]),
      source_url=nullif(trim(coalesce(p_source_url,'')),''),
      effective_from=p_effective_from, effective_until=p_effective_until,
      checksum=v_checksum, status='draft', approved_by=null, published_at=null,
      lock_version=lock_version+1
  where organization_id=p_organization_id and id=p_document_id
  returning lock_version into v_lock;
  delete from public.knowledge_chunks where organization_id=p_organization_id and document_id=p_document_id;
  insert into public.audit_events(organization_id,actor_user_id,action,entity_type,entity_id,outcome,metadata)
  values(p_organization_id,(select auth.uid()),'knowledge.updated','knowledge_document',p_document_id,'success',
    jsonb_build_object('lock_version',v_lock,'status','draft'));
  return v_lock;
end;
$$;

create or replace function public.admin_knowledge_submit_review(
  p_organization_id uuid,
  p_document_id uuid,
  p_expected_lock_version integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_lock integer;
begin
  if not app_private.knowledge_write_allowed(p_organization_id) then
    raise exception using errcode='42501', message='knowledge_write_denied';
  end if;
  update public.knowledge_documents
  set status='review', lock_version=lock_version+1
  where organization_id=p_organization_id and id=p_document_id
    and status='draft' and lock_version=p_expected_lock_version
  returning lock_version into v_lock;
  if v_lock is null then
    if not exists(select 1 from public.knowledge_documents where organization_id=p_organization_id and id=p_document_id) then
      raise exception using errcode='P0002', message='knowledge_document_not_found';
    end if;
    raise exception using errcode='40001', message='knowledge_version_conflict_or_invalid_state';
  end if;
  insert into public.audit_events(organization_id,actor_user_id,action,entity_type,entity_id,outcome,metadata)
  values(p_organization_id,(select auth.uid()),'knowledge.review_requested','knowledge_document',p_document_id,'success','{}'::jsonb);
  return v_lock;
end;
$$;

create or replace function public.admin_knowledge_publish(
  p_organization_id uuid,
  p_document_id uuid,
  p_expected_lock_version integer,
  p_chunks jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc public.knowledge_documents%rowtype;
  v_lock integer;
  v_chunk jsonb;
  v_ordinal integer := 0;
begin
  if not app_private.is_admin(p_organization_id,array['super_admin'],true) then
    raise exception using errcode='42501', message='knowledge_publish_denied';
  end if;
  select * into v_doc
  from public.knowledge_documents
  where organization_id=p_organization_id and id=p_document_id
  for update;
  if not found then raise exception using errcode='P0002', message='knowledge_document_not_found'; end if;
  if v_doc.status <> 'review' then
    raise exception using errcode='22023', message='knowledge_review_required';
  end if;
  if v_doc.lock_version <> p_expected_lock_version then
    raise exception using errcode='40001', message='knowledge_version_conflict';
  end if;
  if jsonb_typeof(p_chunks) <> 'array' or jsonb_array_length(p_chunks) < 1 or jsonb_array_length(p_chunks) > 200 then
    raise exception using errcode='22023', message='invalid_knowledge_chunks';
  end if;

  -- A newer revision in the same series supersedes the currently published one.
  update public.knowledge_documents
  set status='archived', archived_at=now(), lock_version=lock_version+1
  where organization_id=p_organization_id
    and series_id=v_doc.series_id
    and id<>p_document_id
    and status='published';

  delete from public.knowledge_chunks where organization_id=p_organization_id and document_id=p_document_id;
  for v_chunk in select value from jsonb_array_elements(p_chunks)
  loop
    if jsonb_typeof(v_chunk) <> 'object'
       or char_length(trim(coalesce(v_chunk->>'content',''))) not between 1 and 4000 then
      raise exception using errcode='22023', message='invalid_knowledge_chunk';
    end if;
    insert into public.knowledge_chunks(
      id,organization_id,document_id,ordinal,content,metadata
    ) values (
      extensions.gen_random_uuid(),p_organization_id,p_document_id,v_ordinal,
      trim(v_chunk->>'content'),coalesce(v_chunk->'metadata','{}'::jsonb)
    );
    v_ordinal := v_ordinal + 1;
  end loop;

  update public.knowledge_documents
  set status='published', approved_by=(select auth.uid()), published_at=now(),
      archived_at=null, lock_version=lock_version+1
  where organization_id=p_organization_id and id=p_document_id
  returning lock_version into v_lock;

  insert into public.audit_events(organization_id,actor_user_id,action,entity_type,entity_id,outcome,metadata)
  values(p_organization_id,(select auth.uid()),'knowledge.published','knowledge_document',p_document_id,'success',
    jsonb_build_object('revision',v_doc.revision,'chunks',v_ordinal));
  return v_lock;
end;
$$;

create or replace function public.admin_knowledge_archive(
  p_organization_id uuid,
  p_document_id uuid,
  p_expected_lock_version integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_lock integer;
begin
  if not app_private.is_admin(p_organization_id,array['super_admin'],true) then
    raise exception using errcode='42501', message='knowledge_archive_denied';
  end if;
  update public.knowledge_documents
  set status='archived', archived_at=now(), lock_version=lock_version+1
  where organization_id=p_organization_id and id=p_document_id
    and status in ('draft','review','published') and lock_version=p_expected_lock_version
  returning lock_version into v_lock;
  if v_lock is null then
    if not exists(select 1 from public.knowledge_documents where organization_id=p_organization_id and id=p_document_id) then
      raise exception using errcode='P0002', message='knowledge_document_not_found';
    end if;
    raise exception using errcode='40001', message='knowledge_version_conflict_or_invalid_state';
  end if;
  insert into public.audit_events(organization_id,actor_user_id,action,entity_type,entity_id,outcome,metadata)
  values(p_organization_id,(select auth.uid()),'knowledge.archived','knowledge_document',p_document_id,'success','{}'::jsonb);
  return v_lock;
end;
$$;

create or replace function public.admin_knowledge_create_revision(
  p_organization_id uuid,
  p_document_id uuid,
  p_version text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.knowledge_documents%rowtype;
  v_id uuid := extensions.gen_random_uuid();
  v_revision integer;
begin
  if not app_private.knowledge_write_allowed(p_organization_id) then
    raise exception using errcode='42501', message='knowledge_write_denied';
  end if;
  select * into v_source
  from public.knowledge_documents
  where organization_id=p_organization_id and id=p_document_id;
  if not found then raise exception using errcode='P0002', message='knowledge_document_not_found'; end if;
  if v_source.status not in ('published','archived') then
    raise exception using errcode='22023', message='knowledge_revision_requires_published_source';
  end if;
  if char_length(trim(p_version)) not between 1 and 80 then
    raise exception using errcode='22023', message='invalid_knowledge_version';
  end if;
  select coalesce(max(revision),0)+1 into v_revision
  from public.knowledge_documents
  where organization_id=p_organization_id and series_id=v_source.series_id;

  insert into public.knowledge_documents(
    id,organization_id,series_id,revision,lock_version,title,category,version,summary,
    content,locale,market,tags,source_url,effective_from,effective_until,status,checksum,
    created_by,supersedes_id
  ) values (
    v_id,p_organization_id,v_source.series_id,v_revision,1,v_source.title,v_source.category,
    trim(p_version),v_source.summary,v_source.content,v_source.locale,v_source.market,v_source.tags,
    v_source.source_url,v_source.effective_from,v_source.effective_until,'draft',v_source.checksum,
    (select auth.uid()),v_source.id
  );
  insert into public.audit_events(organization_id,actor_user_id,action,entity_type,entity_id,outcome,metadata)
  values(p_organization_id,(select auth.uid()),'knowledge.revision_created','knowledge_document',v_id,'success',
    jsonb_build_object('revision',v_revision,'supersedes_id',v_source.id));
  return v_id;
end;
$$;

create or replace function public.knowledge_search(
  p_organization_id uuid,
  p_query text,
  p_limit integer default 3,
  p_locale text default null,
  p_market text default null
)
returns table(
  document_id uuid,
  chunk_id uuid,
  title text,
  category text,
  version text,
  locale text,
  market text,
  effective_from date,
  effective_until date,
  chunk_ordinal integer,
  content text,
  rank real
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit,3),1),8);
  v_query tsquery;
begin
  if (select auth.role()) <> 'service_role'
     and not app_private.is_admin(p_organization_id,null,true) then
    raise exception using errcode='42501', message='knowledge_search_denied';
  end if;
  if char_length(trim(coalesce(p_query,''))) < 2 then return; end if;
  v_query := websearch_to_tsquery('french', left(trim(p_query),500));
  return query
  select d.id, c.id, d.title, d.category, d.version, d.locale, d.market,
         d.effective_from, d.effective_until, c.ordinal, c.content,
         ts_rank_cd(c.search_vector,v_query)::real as rank
  from public.knowledge_chunks c
  join public.knowledge_documents d
    on d.organization_id=c.organization_id and d.id=c.document_id
  where d.organization_id=p_organization_id
    and d.status='published'
    and (d.effective_from is null or d.effective_from<=current_date)
    and (d.effective_until is null or d.effective_until>=current_date)
    and (p_locale is null or d.locale=p_locale)
    and (p_market is null or d.market in ('GLOBAL',p_market))
    and c.search_vector @@ v_query
  order by ts_rank_cd(c.search_vector,v_query) desc, d.updated_at desc, c.ordinal
  limit v_limit;
end;
$$;

revoke all on function public.admin_knowledge_list(uuid,text,text,integer,integer) from public,anon;
revoke all on function public.admin_knowledge_get(uuid,uuid) from public,anon;
revoke all on function public.admin_knowledge_create(uuid,text,text,text,text,text,text,text,text[],text,date,date) from public,anon;
revoke all on function public.admin_knowledge_update(uuid,uuid,integer,text,text,text,text,text,text,text,text[],text,date,date) from public,anon;
revoke all on function public.admin_knowledge_submit_review(uuid,uuid,integer) from public,anon;
revoke all on function public.admin_knowledge_publish(uuid,uuid,integer,jsonb) from public,anon;
revoke all on function public.admin_knowledge_archive(uuid,uuid,integer) from public,anon;
revoke all on function public.admin_knowledge_create_revision(uuid,uuid,text) from public,anon;
revoke all on function public.knowledge_search(uuid,text,integer,text,text) from public,anon;

grant execute on function public.admin_knowledge_list(uuid,text,text,integer,integer) to authenticated;
grant execute on function public.admin_knowledge_get(uuid,uuid) to authenticated;
grant execute on function public.admin_knowledge_create(uuid,text,text,text,text,text,text,text,text[],text,date,date) to authenticated;
grant execute on function public.admin_knowledge_update(uuid,uuid,integer,text,text,text,text,text,text,text,text[],text,date,date) to authenticated;
grant execute on function public.admin_knowledge_submit_review(uuid,uuid,integer) to authenticated;
grant execute on function public.admin_knowledge_publish(uuid,uuid,integer,jsonb) to authenticated;
grant execute on function public.admin_knowledge_archive(uuid,uuid,integer) to authenticated;
grant execute on function public.admin_knowledge_create_revision(uuid,uuid,text) to authenticated;
grant execute on function public.knowledge_search(uuid,text,integer,text,text) to authenticated, service_role;

commit;
