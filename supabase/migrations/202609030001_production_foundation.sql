-- SAV SC Assistant AI — production foundation for Supabase/Postgres.
-- Schema-only migration. Test data lives in supabase/seed.staging.sql and must
-- never be applied to the production project.

begin;

create extension if not exists pgcrypto with schema extensions;
create extension if not exists vector with schema extensions;

create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  name text not null check (char_length(name) between 2 and 120),
  support_email text,
  timezone text not null default 'Europe/Paris',
  retention_days integer not null default 365 check (retention_days between 30 and 3650),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_memberships (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('super_admin', 'sav_manager', 'sc_manager', 'adviser', 'analyst')),
  display_name text,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code text not null,
  name text not null,
  city text,
  address text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code),
  unique (organization_id, id)
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  external_id text,
  first_name text,
  last_name text,
  email text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, external_id),
  unique (organization_id, id)
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  external_id text,
  sku text,
  name text not null,
  category text,
  serial_number text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, external_id),
  unique (organization_id, id)
);

create table if not exists public.service_cases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete restrict,
  product_id uuid references public.products(id) on delete restrict,
  store_id uuid references public.stores(id) on delete set null,
  reference text not null check (char_length(reference) between 6 and 64),
  kind text not null check (kind in ('repair', 'exchange', 'refund', 'complaint', 'delivery', 'account', 'other')),
  title text not null check (char_length(title) between 2 and 180),
  description text not null default '',
  status text not null check (status in (
    'opened', 'deposited', 'received', 'diagnosis', 'waiting_part', 'quote_pending',
    'repairing', 'repaired', 'exchanged', 'shipping', 'transit', 'ready',
    'delivered', 'refund_pending', 'refunded', 'complaint_review', 'resolved',
    'cancelled', 'delayed'
  )),
  warranty_status text not null default 'unknown' check (warranty_status in ('covered', 'not_covered', 'partial', 'unknown')),
  warranty_label text,
  quote_cents integer check (quote_cents is null or quote_cents between 0 and 100000000),
  refund_cents integer check (refund_cents is null or refund_cents between 0 and 100000000),
  currency char(3) not null default 'EUR',
  delivery_mode text,
  estimated_at timestamptz,
  closed_at timestamptz,
  version integer not null default 1 check (version > 0),
  source_system text not null default 'manual',
  source_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, reference),
  unique (organization_id, id)
);

create unique index if not exists service_cases_org_reference_ci_idx
  on public.service_cases(organization_id, upper(reference));

create table if not exists public.case_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  case_id uuid not null references public.service_cases(id) on delete cascade,
  status text not null,
  label text not null,
  details jsonb not null default '{}'::jsonb,
  customer_visible boolean not null default true,
  source text not null default 'manual',
  actor_user_id uuid references auth.users(id) on delete set null,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.case_access_codes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  case_id uuid not null references public.service_cases(id) on delete cascade,
  code_hash text not null,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create table if not exists public.case_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  case_id uuid not null references public.service_cases(id) on delete cascade,
  token_hash bytea not null unique,
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, id)
);

create table if not exists public.case_commands (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  case_id uuid not null references public.service_cases(id) on delete cascade,
  request_id text not null check (char_length(request_id) between 8 and 100),
  action text not null,
  status text not null default 'accepted' check (status in ('accepted', 'completed', 'rejected', 'failed')),
  response jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (organization_id, request_id)
);

create table if not exists public.assistant_conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  case_id uuid references public.service_cases(id) on delete set null,
  case_session_id uuid references public.case_sessions(id) on delete set null,
  channel text not null default 'web' check (channel in ('web', 'mobile', 'store', 'api')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  unique (organization_id, id)
);

create table if not exists public.assistant_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.assistant_conversations(id) on delete cascade,
  case_id uuid references public.service_cases(id) on delete set null,
  role text not null check (role in ('user', 'assistant', 'tool', 'system')),
  content text not null check (char_length(content) <= 12000),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.handoffs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  case_id uuid references public.service_cases(id) on delete set null,
  conversation_id uuid references public.assistant_conversations(id) on delete set null,
  summary text not null,
  status text not null default 'open' check (status in ('open', 'assigned', 'resolved', 'cancelled')),
  assigned_to uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null,
  category text not null,
  version text not null,
  content text not null,
  source_url text,
  effective_from date,
  effective_until date,
  status text not null default 'draft' check (status in ('draft', 'review', 'published', 'archived')),
  checksum text not null,
  created_by uuid references auth.users(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, checksum),
  unique (organization_id, id)
);

create table if not exists public.knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_id uuid not null references public.knowledge_documents(id) on delete cascade,
  ordinal integer not null check (ordinal >= 0),
  content text not null,
  search_vector tsvector generated always as (to_tsvector('french', coalesce(content, ''))) stored,
  embedding extensions.vector(768),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (document_id, ordinal)
);

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id uuid,
  request_id text,
  outcome text not null default 'success' check (outcome in ('success', 'denied', 'failed')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.performance_samples (
  id bigint generated always as identity primary key,
  organization_id uuid references public.organizations(id) on delete cascade,
  route text not null,
  status_code integer not null check (status_code between 100 and 599),
  latency_ms integer not null check (latency_ms between 0 and 300000),
  provider text,
  model text,
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  created_at timestamptz not null default now()
);

-- Tenant-safe foreign keys prevent an application bug from ever linking data
-- across organizations, even when both UUIDs otherwise exist.
alter table public.service_cases
  add constraint service_cases_customer_org_fk foreign key (organization_id, customer_id)
    references public.customers(organization_id, id) on delete restrict,
  add constraint service_cases_product_org_fk foreign key (organization_id, product_id)
    references public.products(organization_id, id) on delete restrict,
  add constraint service_cases_store_org_fk foreign key (organization_id, store_id)
    references public.stores(organization_id, id) on delete set null (store_id);
alter table public.case_events
  add constraint case_events_case_org_fk foreign key (organization_id, case_id)
    references public.service_cases(organization_id, id) on delete cascade;
alter table public.case_access_codes
  add constraint case_access_codes_case_org_fk foreign key (organization_id, case_id)
    references public.service_cases(organization_id, id) on delete cascade;
alter table public.case_sessions
  add constraint case_sessions_case_org_fk foreign key (organization_id, case_id)
    references public.service_cases(organization_id, id) on delete cascade;
alter table public.case_commands
  add constraint case_commands_case_org_fk foreign key (organization_id, case_id)
    references public.service_cases(organization_id, id) on delete cascade;
alter table public.assistant_conversations
  add constraint assistant_conversations_case_org_fk foreign key (organization_id, case_id)
    references public.service_cases(organization_id, id) on delete set null (case_id),
  add constraint assistant_conversations_session_org_fk foreign key (organization_id, case_session_id)
    references public.case_sessions(organization_id, id) on delete set null (case_session_id);
alter table public.assistant_messages
  add constraint assistant_messages_conversation_org_fk foreign key (organization_id, conversation_id)
    references public.assistant_conversations(organization_id, id) on delete cascade,
  add constraint assistant_messages_case_org_fk foreign key (organization_id, case_id)
    references public.service_cases(organization_id, id) on delete set null (case_id);
alter table public.handoffs
  add constraint handoffs_case_org_fk foreign key (organization_id, case_id)
    references public.service_cases(organization_id, id) on delete set null (case_id),
  add constraint handoffs_conversation_org_fk foreign key (organization_id, conversation_id)
    references public.assistant_conversations(organization_id, id) on delete set null (conversation_id);
alter table public.knowledge_chunks
  add constraint knowledge_chunks_document_org_fk foreign key (organization_id, document_id)
    references public.knowledge_documents(organization_id, id) on delete cascade;

create unique index if not exists case_access_one_active_idx
  on public.case_access_codes(case_id) where revoked_at is null;
create index if not exists service_cases_org_status_idx
  on public.service_cases(organization_id, status, updated_at desc);
create index if not exists service_cases_org_kind_idx
  on public.service_cases(organization_id, kind, updated_at desc);
create index if not exists case_events_case_time_idx
  on public.case_events(case_id, occurred_at desc) where customer_visible;
create index if not exists case_sessions_expiry_idx
  on public.case_sessions(expires_at) where revoked_at is null;
create index if not exists messages_org_time_idx
  on public.assistant_messages(organization_id, created_at desc);
create index if not exists handoffs_org_status_idx
  on public.handoffs(organization_id, status, created_at desc);
create index if not exists audit_org_time_idx
  on public.audit_events(organization_id, created_at desc);
create index if not exists performance_org_time_idx
  on public.performance_samples(organization_id, created_at desc);
create index if not exists knowledge_chunks_fts_idx
  on public.knowledge_chunks using gin(search_vector);
create index if not exists knowledge_chunks_embedding_idx
  on public.knowledge_chunks using hnsw (embedding vector_cosine_ops);

create or replace function app_private.touch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists organizations_touch_updated_at on public.organizations;
create trigger organizations_touch_updated_at before update on public.organizations
for each row execute function app_private.touch_updated_at();
drop trigger if exists memberships_touch_updated_at on public.admin_memberships;
create trigger memberships_touch_updated_at before update on public.admin_memberships
for each row execute function app_private.touch_updated_at();
drop trigger if exists stores_touch_updated_at on public.stores;
create trigger stores_touch_updated_at before update on public.stores
for each row execute function app_private.touch_updated_at();
drop trigger if exists customers_touch_updated_at on public.customers;
create trigger customers_touch_updated_at before update on public.customers
for each row execute function app_private.touch_updated_at();
drop trigger if exists products_touch_updated_at on public.products;
create trigger products_touch_updated_at before update on public.products
for each row execute function app_private.touch_updated_at();
drop trigger if exists cases_touch_updated_at on public.service_cases;
create trigger cases_touch_updated_at before update on public.service_cases
for each row execute function app_private.touch_updated_at();
drop trigger if exists handoffs_touch_updated_at on public.handoffs;
create trigger handoffs_touch_updated_at before update on public.handoffs
for each row execute function app_private.touch_updated_at();
drop trigger if exists documents_touch_updated_at on public.knowledge_documents;
create trigger documents_touch_updated_at before update on public.knowledge_documents
for each row execute function app_private.touch_updated_at();

create or replace function app_private.is_admin(
  p_organization_id uuid,
  p_roles text[] default null,
  p_require_mfa boolean default true
)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select exists (
    select 1
    from public.admin_memberships membership
    where membership.organization_id = p_organization_id
      and membership.user_id = auth.uid()
      and membership.active
      and (p_roles is null or membership.role = any(p_roles))
      and (not p_require_mfa or coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2')
  );
$$;

revoke all on function app_private.touch_updated_at() from public, anon, authenticated;
revoke all on function app_private.is_admin(uuid, text[], boolean) from public, anon;
grant usage on schema app_private to authenticated;
grant execute on function app_private.is_admin(uuid, text[], boolean) to authenticated;

alter table public.organizations enable row level security;
alter table public.admin_memberships enable row level security;
alter table public.stores enable row level security;
alter table public.customers enable row level security;
alter table public.products enable row level security;
alter table public.service_cases enable row level security;
alter table public.case_events enable row level security;
alter table public.case_access_codes enable row level security;
alter table public.case_sessions enable row level security;
alter table public.case_commands enable row level security;
alter table public.assistant_conversations enable row level security;
alter table public.assistant_messages enable row level security;
alter table public.handoffs enable row level security;
alter table public.knowledge_documents enable row level security;
alter table public.knowledge_chunks enable row level security;
alter table public.audit_events enable row level security;
alter table public.performance_samples enable row level security;

revoke all on public.organizations, public.admin_memberships, public.stores,
  public.customers, public.products, public.service_cases, public.case_events,
  public.case_access_codes, public.case_sessions, public.case_commands,
  public.assistant_conversations, public.assistant_messages, public.handoffs,
  public.knowledge_documents, public.knowledge_chunks, public.audit_events,
  public.performance_samples from anon, authenticated;

grant select, insert, update, delete on public.organizations,
  public.admin_memberships, public.stores, public.customers, public.products,
  public.service_cases, public.case_events, public.case_access_codes,
  public.case_sessions, public.case_commands, public.assistant_conversations,
  public.assistant_messages, public.handoffs, public.knowledge_documents,
  public.knowledge_chunks, public.audit_events, public.performance_samples
  to service_role;
grant usage, select on sequence public.performance_samples_id_seq to service_role;

grant select on public.organizations, public.stores, public.products,
  public.service_cases, public.case_events, public.handoffs,
  public.knowledge_documents, public.knowledge_chunks,
  public.performance_samples to authenticated;
grant select on public.customers, public.assistant_conversations,
  public.assistant_messages to authenticated;
grant select on public.admin_memberships to authenticated;
grant insert, update on public.service_cases, public.stores, public.products,
  public.customers, public.handoffs, public.knowledge_documents to authenticated;
grant insert on public.case_events, public.audit_events to authenticated;

drop policy if exists organizations_admin_select on public.organizations;
create policy organizations_admin_select on public.organizations for select to authenticated
using (app_private.is_admin(id, null, true));

drop policy if exists memberships_self_select on public.admin_memberships;
create policy memberships_self_select on public.admin_memberships for select to authenticated
using (user_id = auth.uid() and active and coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2');

drop policy if exists stores_admin_select on public.stores;
create policy stores_admin_select on public.stores for select to authenticated
using (app_private.is_admin(organization_id, array['super_admin','sav_manager','sc_manager','adviser'], true));
drop policy if exists stores_admin_write on public.stores;
create policy stores_admin_write on public.stores for all to authenticated
using (app_private.is_admin(organization_id, array['super_admin'], true))
with check (app_private.is_admin(organization_id, array['super_admin'], true));

drop policy if exists customers_admin_select on public.customers;
create policy customers_admin_select on public.customers for select to authenticated
using (app_private.is_admin(organization_id, array['super_admin','sav_manager','sc_manager','adviser'], true));
drop policy if exists customers_admin_write on public.customers;
create policy customers_admin_write on public.customers for all to authenticated
using (app_private.is_admin(organization_id, array['super_admin','sav_manager','sc_manager'], true))
with check (app_private.is_admin(organization_id, array['super_admin','sav_manager','sc_manager'], true));

drop policy if exists products_admin_select on public.products;
create policy products_admin_select on public.products for select to authenticated
using (app_private.is_admin(organization_id, array['super_admin','sav_manager','sc_manager','adviser'], true));
drop policy if exists products_admin_write on public.products;
create policy products_admin_write on public.products for all to authenticated
using (app_private.is_admin(organization_id, array['super_admin','sav_manager','sc_manager'], true))
with check (app_private.is_admin(organization_id, array['super_admin','sav_manager','sc_manager'], true));

drop policy if exists cases_admin_select on public.service_cases;
create policy cases_admin_select on public.service_cases for select to authenticated
using (app_private.is_admin(organization_id, array['super_admin','sav_manager','sc_manager','adviser'], true));
drop policy if exists cases_admin_write on public.service_cases;
create policy cases_admin_write on public.service_cases for all to authenticated
using (app_private.is_admin(organization_id, array['super_admin','sav_manager','sc_manager'], true))
with check (app_private.is_admin(organization_id, array['super_admin','sav_manager','sc_manager'], true));

drop policy if exists events_admin_select on public.case_events;
create policy events_admin_select on public.case_events for select to authenticated
using (app_private.is_admin(organization_id, array['super_admin','sav_manager','sc_manager','adviser'], true));
drop policy if exists events_admin_insert on public.case_events;
create policy events_admin_insert on public.case_events for insert to authenticated
with check (app_private.is_admin(organization_id, array['super_admin','sav_manager','sc_manager','adviser'], true));

drop policy if exists conversations_admin_select on public.assistant_conversations;
create policy conversations_admin_select on public.assistant_conversations for select to authenticated
using (app_private.is_admin(organization_id, array['super_admin','sav_manager','sc_manager','adviser'], true));
drop policy if exists messages_admin_select on public.assistant_messages;
create policy messages_admin_select on public.assistant_messages for select to authenticated
using (app_private.is_admin(organization_id, array['super_admin','sav_manager','sc_manager','adviser'], true));

drop policy if exists handoffs_admin_select on public.handoffs;
create policy handoffs_admin_select on public.handoffs for select to authenticated
using (app_private.is_admin(organization_id, array['super_admin','sav_manager','sc_manager','adviser'], true));
drop policy if exists handoffs_admin_write on public.handoffs;
create policy handoffs_admin_write on public.handoffs for all to authenticated
using (app_private.is_admin(organization_id, array['super_admin','sav_manager','sc_manager','adviser'], true))
with check (app_private.is_admin(organization_id, array['super_admin','sav_manager','sc_manager','adviser'], true));

drop policy if exists knowledge_admin_select on public.knowledge_documents;
create policy knowledge_admin_select on public.knowledge_documents for select to authenticated
using (app_private.is_admin(organization_id, null, true));
drop policy if exists knowledge_admin_write on public.knowledge_documents;
create policy knowledge_admin_write on public.knowledge_documents for all to authenticated
using (app_private.is_admin(organization_id, array['super_admin','sav_manager','sc_manager'], true))
with check (app_private.is_admin(organization_id, array['super_admin','sav_manager','sc_manager'], true));
drop policy if exists chunks_admin_select on public.knowledge_chunks;
create policy chunks_admin_select on public.knowledge_chunks for select to authenticated
using (app_private.is_admin(organization_id, null, true));

drop policy if exists audit_admin_select on public.audit_events;
create policy audit_admin_select on public.audit_events for select to authenticated
using (app_private.is_admin(organization_id, array['super_admin','analyst'], true));
drop policy if exists audit_admin_insert on public.audit_events;
create policy audit_admin_insert on public.audit_events for insert to authenticated
with check (app_private.is_admin(organization_id, array['super_admin','sav_manager','sc_manager','adviser'], true));

drop policy if exists performance_admin_select on public.performance_samples;
create policy performance_admin_select on public.performance_samples for select to authenticated
using (app_private.is_admin(organization_id, null, true));

create or replace function app_private.case_snapshot(p_case_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', c.id,
    'reference', c.reference,
    'kind', c.kind,
    'title', c.title,
    'description', c.description,
    'status', c.status,
    'warranty_status', c.warranty_status,
    'warranty_label', c.warranty_label,
    'quote_cents', c.quote_cents,
    'refund_cents', c.refund_cents,
    'currency', c.currency,
    'delivery_mode', c.delivery_mode,
    'estimated_at', c.estimated_at,
    'version', c.version,
    'updated_at', c.updated_at,
    'product', case when p.id is null then null else jsonb_build_object(
      'name', p.name, 'category', p.category, 'sku', p.sku
    ) end,
    'store', case when s.id is null then null else jsonb_build_object(
      'name', s.name, 'city', s.city
    ) end,
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id,
        'status', e.status,
        'label', e.label,
        'details', jsonb_build_object(
          'detail', left(coalesce(e.details->>'detail', ''), 1000)
        ),
        'occurred_at', e.occurred_at
      ) order by e.occurred_at desc)
      from public.case_events e
      where e.case_id = c.id
        and e.organization_id = c.organization_id
        and e.customer_visible
    ), '[]'::jsonb)
  )
  from public.service_cases c
  left join public.products p on p.id = c.product_id and p.organization_id = c.organization_id
  left join public.stores s on s.id = c.store_id and s.organization_id = c.organization_id
  where c.id = p_case_id;
$$;

revoke all on function app_private.case_snapshot(uuid) from public, anon, authenticated;

create or replace function public.set_case_access_code(
  p_organization_id uuid,
  p_case_id uuid,
  p_plaintext_code text,
  p_expires_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_id uuid;
begin
  if p_plaintext_code !~ '^[0-9]{6,12}$' then
    raise exception using errcode = '22023', message = 'invalid_code_format';
  end if;
  if not exists (
    select 1 from public.service_cases
    where id = p_case_id and organization_id = p_organization_id
  ) then
    raise exception using errcode = 'P0002', message = 'case_not_found';
  end if;
  update public.case_access_codes
    set revoked_at = now()
    where case_id = p_case_id and organization_id = p_organization_id and revoked_at is null;
  insert into public.case_access_codes (
    organization_id, case_id, code_hash, expires_at, created_by
  ) values (
    p_organization_id,
    p_case_id,
    crypt(p_plaintext_code, gen_salt('bf', 12)),
    p_expires_at,
    auth.uid()
  ) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.customer_open_case_session(
  p_organization_id uuid,
  p_reference text,
  p_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private, extensions, pg_temp
as $$
declare
  v_case_id uuid;
  v_token text;
  v_expires_at timestamptz := now() + interval '30 minutes';
begin
  if p_reference is null or char_length(trim(p_reference)) not between 6 and 64
     or p_code is null or p_code !~ '^[0-9]{6,12}$' then
    raise exception using errcode = 'P0001', message = 'invalid_case_credentials';
  end if;

  select c.id into v_case_id
  from public.service_cases c
  join public.case_access_codes access on access.case_id = c.id
    and access.organization_id = c.organization_id
  where c.organization_id = p_organization_id
    and upper(c.reference) = upper(trim(p_reference))
    and access.revoked_at is null
    and (access.expires_at is null or access.expires_at > now())
    and crypt(p_code, access.code_hash) = access.code_hash
  order by access.created_at desc
  limit 1;

  if v_case_id is null then
    insert into public.audit_events (
      organization_id, action, entity_type, outcome, metadata
    ) values (
      p_organization_id, 'case.access', 'service_case', 'denied',
      jsonb_build_object('reason', 'invalid_credentials')
    );
    raise exception using errcode = 'P0001', message = 'invalid_case_credentials';
  end if;

  v_token := encode(gen_random_bytes(32), 'hex');
  insert into public.case_sessions (
    organization_id, case_id, token_hash, expires_at
  ) values (
    p_organization_id, v_case_id, digest(v_token, 'sha256'), v_expires_at
  );
  insert into public.audit_events (
    organization_id, action, entity_type, entity_id, outcome
  ) values (
    p_organization_id, 'case.access', 'service_case', v_case_id, 'success'
  );

  return jsonb_build_object(
    'access_token', v_token,
    'expires_at', v_expires_at,
    'case', app_private.case_snapshot(v_case_id)
  );
end;
$$;

create or replace function public.customer_case_snapshot(p_access_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private, extensions, pg_temp
as $$
declare
  v_session public.case_sessions%rowtype;
begin
  if p_access_token is null or p_access_token !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = 'P0001', message = 'invalid_case_session';
  end if;
  select * into v_session
  from public.case_sessions
  where token_hash = digest(p_access_token, 'sha256')
    and revoked_at is null and expires_at > now()
  limit 1;
  if v_session.id is null then
    raise exception using errcode = 'P0001', message = 'invalid_case_session';
  end if;
  update public.case_sessions set last_seen_at = now() where id = v_session.id;
  return jsonb_build_object(
    'expires_at', v_session.expires_at,
    'case', app_private.case_snapshot(v_session.case_id)
  );
end;
$$;

create or replace function public.customer_close_case_session(p_access_token text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if p_access_token is null or p_access_token !~ '^[a-f0-9]{64}$' then
    return false;
  end if;
  update public.case_sessions
    set revoked_at = now()
    where token_hash = digest(p_access_token, 'sha256') and revoked_at is null;
  return found;
end;
$$;

create or replace function public.purge_expired_case_sessions()
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count bigint;
begin
  delete from public.case_sessions
  where expires_at < now() - interval '7 days'
     or (revoked_at is not null and revoked_at < now() - interval '7 days');
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.admin_me()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  return jsonb_build_object(
    'user_id', v_user_id,
    'email', auth.jwt()->>'email',
    'aal', coalesce(auth.jwt()->>'aal', 'aal1'),
    'memberships', coalesce((
      select jsonb_agg(jsonb_build_object(
        'organization_id', membership.organization_id,
        'organization_name', organization.name,
        'role', membership.role,
        'display_name', membership.display_name
      ) order by organization.name)
      from public.admin_memberships membership
      join public.organizations organization on organization.id = membership.organization_id
      where membership.user_id = v_user_id and membership.active and organization.active
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.admin_dashboard(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, app_private, pg_temp
as $$
begin
  if not app_private.is_admin(p_organization_id, null, true) then
    raise exception using errcode = '42501', message = 'admin_access_denied';
  end if;
  return jsonb_build_object(
    'generated_at', now(),
    'cases', jsonb_build_object(
      'total', (select count(*) from public.service_cases where organization_id = p_organization_id),
      'open', (select count(*) from public.service_cases where organization_id = p_organization_id and closed_at is null and status not in ('resolved','cancelled','delivered','refunded')),
      'overdue', (select count(*) from public.service_cases where organization_id = p_organization_id and closed_at is null and estimated_at < now()),
      'resolved_30d', (select count(*) from public.service_cases where organization_id = p_organization_id and closed_at >= now() - interval '30 days')
    ),
    'handoffs', jsonb_build_object(
      'open', (select count(*) from public.handoffs where organization_id = p_organization_id and status in ('open','assigned'))
    ),
    'assistant', jsonb_build_object(
      'messages_24h', (select count(*) from public.assistant_messages where organization_id = p_organization_id and created_at >= now() - interval '24 hours'),
      'conversations_30d', (select count(*) from public.assistant_conversations where organization_id = p_organization_id and started_at >= now() - interval '30 days')
    ),
    'performance', jsonb_build_object(
      'requests_24h', (select count(*) from public.performance_samples where organization_id = p_organization_id and created_at >= now() - interval '24 hours'),
      'error_rate_24h', coalesce((select round(100.0 * count(*) filter (where status_code >= 500) / nullif(count(*), 0), 2) from public.performance_samples where organization_id = p_organization_id and created_at >= now() - interval '24 hours'), 0),
      'avg_latency_ms_24h', coalesce((select round(avg(latency_ms)) from public.performance_samples where organization_id = p_organization_id and created_at >= now() - interval '24 hours'), 0)
    ),
    'by_status', coalesce((
      select jsonb_object_agg(status, amount)
      from (select status, count(*) amount from public.service_cases where organization_id = p_organization_id group by status) grouped
    ), '{}'::jsonb),
    'by_kind', coalesce((
      select jsonb_object_agg(kind, amount)
      from (select kind, count(*) amount from public.service_cases where organization_id = p_organization_id group by kind) grouped
    ), '{}'::jsonb)
  );
end;
$$;

create or replace function public.admin_list_cases(
  p_organization_id uuid,
  p_limit integer default 50,
  p_offset integer default 0,
  p_search text default null,
  p_status text default null,
  p_kind text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, app_private, pg_temp
as $$
begin
  if not app_private.is_admin(p_organization_id, array['super_admin','sav_manager','sc_manager','adviser'], true) then
    raise exception using errcode = '42501', message = 'admin_access_denied';
  end if;
  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(row_data order by row_data->>'updated_at' desc)
      from (
        select jsonb_build_object(
          'id', c.id,
          'reference', c.reference,
          'kind', c.kind,
          'title', c.title,
          'status', c.status,
          'warranty_status', c.warranty_status,
          'product', p.name,
          'store', s.name,
          'customer', trim(concat_ws(' ', u.first_name, u.last_name)),
          'estimated_at', c.estimated_at,
          'updated_at', c.updated_at,
          'version', c.version
        ) row_data
        from public.service_cases c
        left join public.products p on p.id = c.product_id and p.organization_id = c.organization_id
        left join public.stores s on s.id = c.store_id and s.organization_id = c.organization_id
        left join public.customers u on u.id = c.customer_id and u.organization_id = c.organization_id
        where c.organization_id = p_organization_id
          and (p_status is null or c.status = p_status)
          and (p_kind is null or c.kind = p_kind)
          and (p_search is null or p_search = '' or c.reference ilike '%' || p_search || '%' or c.title ilike '%' || p_search || '%' or p.name ilike '%' || p_search || '%')
        order by c.updated_at desc
        limit least(greatest(p_limit, 1), 100)
        offset greatest(p_offset, 0)
      ) listed
    ), '[]'::jsonb),
    'total', (
      select count(*) from public.service_cases c
      left join public.products p on p.id = c.product_id and p.organization_id = c.organization_id
      where c.organization_id = p_organization_id
        and (p_status is null or c.status = p_status)
        and (p_kind is null or c.kind = p_kind)
        and (p_search is null or p_search = '' or c.reference ilike '%' || p_search || '%' or c.title ilike '%' || p_search || '%' or p.name ilike '%' || p_search || '%')
    )
  );
end;
$$;

create or replace function public.bootstrap_admin(
  p_organization_id uuid,
  p_email text,
  p_role text default 'super_admin',
  p_display_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_user_id uuid;
begin
  if p_role not in ('super_admin', 'sav_manager', 'sc_manager', 'adviser', 'analyst') then
    raise exception using errcode = '22023', message = 'invalid_admin_role';
  end if;
  select id into v_user_id from auth.users where lower(email) = lower(trim(p_email)) limit 1;
  if v_user_id is null then
    raise exception using errcode = 'P0002', message = 'auth_user_not_found';
  end if;
  insert into public.admin_memberships (
    organization_id, user_id, role, display_name, active, created_by
  ) values (
    p_organization_id, v_user_id, p_role, p_display_name, true, auth.uid()
  ) on conflict (organization_id, user_id) do update set
    role = excluded.role,
    display_name = excluded.display_name,
    active = true,
    updated_at = now();
  return v_user_id;
end;
$$;

revoke all on function public.set_case_access_code(uuid, uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.customer_open_case_session(uuid, text, text) from public, anon, authenticated;
revoke all on function public.customer_case_snapshot(text) from public, anon, authenticated;
revoke all on function public.customer_close_case_session(text) from public, anon, authenticated;
revoke all on function public.purge_expired_case_sessions() from public, anon, authenticated;
revoke all on function public.bootstrap_admin(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.set_case_access_code(uuid, uuid, text, timestamptz) to service_role;
grant execute on function public.customer_open_case_session(uuid, text, text) to service_role;
grant execute on function public.customer_case_snapshot(text) to service_role;
grant execute on function public.customer_close_case_session(text) to service_role;
grant execute on function public.purge_expired_case_sessions() to service_role;
grant execute on function public.bootstrap_admin(uuid, text, text, text) to service_role;

revoke all on function public.admin_me() from public, anon;
revoke all on function public.admin_dashboard(uuid) from public, anon;
revoke all on function public.admin_list_cases(uuid, integer, integer, text, text, text) from public, anon;
grant execute on function public.admin_me() to authenticated;
grant execute on function public.admin_dashboard(uuid) to authenticated;
grant execute on function public.admin_list_cases(uuid, integer, integer, text, text, text) to authenticated;

comment on table public.case_access_codes is 'Bcrypt hashes only. Plaintext access codes must never be stored.';
comment on table public.case_sessions is 'Short-lived, dossier-scoped customer capabilities. Raw tokens exist only in HttpOnly cookies.';
comment on function public.customer_open_case_session(uuid, text, text) is 'Server-only verification. Never grant this RPC to anon/authenticated.';

commit;
