-- Move privileged knowledge RPC implementations out of the exposed API schema.
-- Public functions remain SECURITY INVOKER wrappers; the guarded implementations
-- stay in app_private so PostgREST never exposes SECURITY DEFINER functions directly.

begin;

create index if not exists knowledge_documents_supersedes_id_idx
  on public.knowledge_documents(supersedes_id)
  where supersedes_id is not null;

alter function public.admin_knowledge_list(uuid,text,text,integer,integer) set schema app_private;
alter function public.admin_knowledge_get(uuid,uuid) set schema app_private;
alter function public.admin_knowledge_create(uuid,text,text,text,text,text,text,text,text[],text,date,date) set schema app_private;
alter function public.admin_knowledge_update(uuid,uuid,integer,text,text,text,text,text,text,text,text[],text,date,date) set schema app_private;
alter function public.admin_knowledge_submit_review(uuid,uuid,integer) set schema app_private;
alter function public.admin_knowledge_publish(uuid,uuid,integer,jsonb) set schema app_private;
alter function public.admin_knowledge_archive(uuid,uuid,integer) set schema app_private;
alter function public.admin_knowledge_create_revision(uuid,uuid,text) set schema app_private;
alter function public.knowledge_search(uuid,text,integer,text,text) set schema app_private;

revoke all on function app_private.admin_knowledge_list(uuid,text,text,integer,integer) from public,anon;
revoke all on function app_private.admin_knowledge_get(uuid,uuid) from public,anon;
revoke all on function app_private.admin_knowledge_create(uuid,text,text,text,text,text,text,text,text[],text,date,date) from public,anon;
revoke all on function app_private.admin_knowledge_update(uuid,uuid,integer,text,text,text,text,text,text,text,text[],text,date,date) from public,anon;
revoke all on function app_private.admin_knowledge_submit_review(uuid,uuid,integer) from public,anon;
revoke all on function app_private.admin_knowledge_publish(uuid,uuid,integer,jsonb) from public,anon;
revoke all on function app_private.admin_knowledge_archive(uuid,uuid,integer) from public,anon;
revoke all on function app_private.admin_knowledge_create_revision(uuid,uuid,text) from public,anon;
revoke all on function app_private.knowledge_search(uuid,text,integer,text,text) from public,anon;

grant execute on function app_private.admin_knowledge_list(uuid,text,text,integer,integer) to authenticated;
grant execute on function app_private.admin_knowledge_get(uuid,uuid) to authenticated;
grant execute on function app_private.admin_knowledge_create(uuid,text,text,text,text,text,text,text,text[],text,date,date) to authenticated;
grant execute on function app_private.admin_knowledge_update(uuid,uuid,integer,text,text,text,text,text,text,text,text[],text,date,date) to authenticated;
grant execute on function app_private.admin_knowledge_submit_review(uuid,uuid,integer) to authenticated;
grant execute on function app_private.admin_knowledge_publish(uuid,uuid,integer,jsonb) to authenticated;
grant execute on function app_private.admin_knowledge_archive(uuid,uuid,integer) to authenticated;
grant execute on function app_private.admin_knowledge_create_revision(uuid,uuid,text) to authenticated;
grant execute on function app_private.knowledge_search(uuid,text,integer,text,text) to authenticated, service_role;

create function public.admin_knowledge_list(
  p_organization_id uuid,
  p_status text default null,
  p_search text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select app_private.admin_knowledge_list(p_organization_id,p_status,p_search,p_limit,p_offset);
$$;

create function public.admin_knowledge_get(
  p_organization_id uuid,
  p_document_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select app_private.admin_knowledge_get(p_organization_id,p_document_id);
$$;

create function public.admin_knowledge_create(
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
language sql
security invoker
set search_path = ''
as $$
  select app_private.admin_knowledge_create(
    p_organization_id,p_title,p_category,p_version,p_content,p_summary,p_locale,p_market,
    p_tags,p_source_url,p_effective_from,p_effective_until
  );
$$;

create function public.admin_knowledge_update(
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
language sql
security invoker
set search_path = ''
as $$
  select app_private.admin_knowledge_update(
    p_organization_id,p_document_id,p_expected_lock_version,p_title,p_category,p_version,
    p_content,p_summary,p_locale,p_market,p_tags,p_source_url,p_effective_from,p_effective_until
  );
$$;

create function public.admin_knowledge_submit_review(
  p_organization_id uuid,
  p_document_id uuid,
  p_expected_lock_version integer
)
returns integer
language sql
security invoker
set search_path = ''
as $$
  select app_private.admin_knowledge_submit_review(
    p_organization_id,p_document_id,p_expected_lock_version
  );
$$;

create function public.admin_knowledge_publish(
  p_organization_id uuid,
  p_document_id uuid,
  p_expected_lock_version integer,
  p_chunks jsonb
)
returns integer
language sql
security invoker
set search_path = ''
as $$
  select app_private.admin_knowledge_publish(
    p_organization_id,p_document_id,p_expected_lock_version,p_chunks
  );
$$;

create function public.admin_knowledge_archive(
  p_organization_id uuid,
  p_document_id uuid,
  p_expected_lock_version integer
)
returns integer
language sql
security invoker
set search_path = ''
as $$
  select app_private.admin_knowledge_archive(
    p_organization_id,p_document_id,p_expected_lock_version
  );
$$;

create function public.admin_knowledge_create_revision(
  p_organization_id uuid,
  p_document_id uuid,
  p_version text
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select app_private.admin_knowledge_create_revision(p_organization_id,p_document_id,p_version);
$$;

create function public.knowledge_search(
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
language sql
stable
security invoker
set search_path = ''
as $$
  select * from app_private.knowledge_search(
    p_organization_id,p_query,p_limit,p_locale,p_market
  );
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
