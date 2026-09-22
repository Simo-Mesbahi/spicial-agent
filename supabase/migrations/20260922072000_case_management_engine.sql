-- SAV SC Assistant AI — audited case management engine.
-- Server-owned creation, mutation, lifecycle transitions, access-code rotation
-- and archival. No browser path receives direct write access to business tables.

begin;

-- ---------------------------------------------------------------------------
-- Case ownership and soft-delete boundary
-- ---------------------------------------------------------------------------

alter table public.service_cases
  add column if not exists service_type text,
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid,
  add column if not exists archive_reason text;

update public.service_cases
set service_type = case
  when kind in ('complaint','account') then 'customer_service'
  else 'sav'
end
where service_type is null;

alter table public.service_cases
  alter column service_type set default 'sav',
  alter column service_type set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='service_cases_service_type_check'
      and conrelid='public.service_cases'::regclass
  ) then
    alter table public.service_cases
      add constraint service_cases_service_type_check
      check (service_type in ('sav','customer_service'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname='service_cases_archive_reason_check'
      and conrelid='public.service_cases'::regclass
  ) then
    alter table public.service_cases
      add constraint service_cases_archive_reason_check
      check (archive_reason is null or char_length(archive_reason) between 3 and 1000);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname='service_cases_archived_by_fkey'
      and conrelid='public.service_cases'::regclass
  ) then
    alter table public.service_cases
      add constraint service_cases_archived_by_fkey
      foreign key (archived_by) references auth.users(id) on delete set null;
  end if;
end;
$$;

create index if not exists service_cases_org_service_active_idx
  on public.service_cases(organization_id,service_type,updated_at desc)
  where archived_at is null;

create index if not exists service_cases_org_archived_idx
  on public.service_cases(organization_id,archived_at desc)
  where archived_at is not null;

-- Reference counters are not API-facing and are mutated only by a security
-- definer function. Existing six-digit references seed the counter.
create table if not exists app_private.case_reference_counters (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  service_type text not null check (service_type in ('sav','customer_service')),
  reference_year integer not null check (reference_year between 2020 and 9999),
  current_value bigint not null check (current_value >= 0),
  primary key (organization_id,service_type,reference_year)
);
revoke all on app_private.case_reference_counters from public,anon,authenticated;

insert into app_private.case_reference_counters(
  organization_id,service_type,reference_year,current_value
)
select
  organization_id,
  service_type,
  split_part(reference,'-',2)::integer,
  max(split_part(reference,'-',3)::bigint)
from public.service_cases
where reference ~ '^(SAV|SC)-[0-9]{4}-[0-9]{6}$'
group by organization_id,service_type,split_part(reference,'-',2)::integer
on conflict (organization_id,service_type,reference_year)
do update set current_value=greatest(
  app_private.case_reference_counters.current_value,
  excluded.current_value
);

-- ---------------------------------------------------------------------------
-- Authorization and lifecycle helpers
-- ---------------------------------------------------------------------------

create or replace function app_private.case_service_read_allowed(
  p_organization_id uuid,
  p_service_type text
)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select
    app_private.is_admin(p_organization_id,array['super_admin','adviser'],true)
    or (
      p_service_type='sav'
      and app_private.is_admin(p_organization_id,array['sav_manager'],true)
    )
    or (
      p_service_type='customer_service'
      and app_private.is_admin(p_organization_id,array['sc_manager'],true)
    );
$$;
revoke all on function app_private.case_service_read_allowed(uuid,text)
  from public,anon,authenticated;
grant execute on function app_private.case_service_read_allowed(uuid,text)
  to authenticated;

create or replace function app_private.case_service_manage_allowed(
  p_organization_id uuid,
  p_service_type text
)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select
    app_private.is_admin(p_organization_id,array['super_admin'],true)
    or (
      p_service_type='sav'
      and app_private.is_admin(p_organization_id,array['sav_manager'],true)
    )
    or (
      p_service_type='customer_service'
      and app_private.is_admin(p_organization_id,array['sc_manager'],true)
    );
$$;
revoke all on function app_private.case_service_manage_allowed(uuid,text)
  from public,anon,authenticated;
grant execute on function app_private.case_service_manage_allowed(uuid,text)
  to authenticated;

create or replace function app_private.next_case_reference(
  p_organization_id uuid,
  p_service_type text
)
returns text
language plpgsql
security definer
set search_path=''
as $$
declare
  v_year integer := extract(year from now())::integer;
  v_value bigint;
  v_prefix text;
  v_reference text;
begin
  if p_service_type not in ('sav','customer_service') then
    raise exception using errcode='22023',message='invalid_service_type';
  end if;

  v_prefix := case when p_service_type='sav' then 'SAV' else 'SC' end;

  loop
    insert into app_private.case_reference_counters(
      organization_id,service_type,reference_year,current_value
    ) values (
      p_organization_id,p_service_type,v_year,1
    )
    on conflict (organization_id,service_type,reference_year)
    do update
      set current_value=app_private.case_reference_counters.current_value+1
    returning current_value into v_value;

    v_reference := format(
      '%s-%s-%s',
      v_prefix,
      v_year,
      lpad(v_value::text,6,'0')
    );

    exit when not exists(
      select 1
      from public.service_cases
      where organization_id=p_organization_id
        and upper(reference)=upper(v_reference)
    );
  end loop;

  return v_reference;
end;
$$;
revoke all on function app_private.next_case_reference(uuid,text)
  from public,anon,authenticated;

create or replace function app_private.random_numeric_code(
  p_length integer default 8
)
returns text
language plpgsql
volatile
security definer
set search_path=''
as $$
declare
  v_result text := '';
  v_byte integer;
begin
  if p_length not between 6 and 12 then
    raise exception using errcode='22023',message='invalid_code_length';
  end if;

  while char_length(v_result)<p_length loop
    v_byte := get_byte(extensions.gen_random_bytes(1),0);
    -- 250 is divisible by 10; rejection sampling prevents modulo bias.
    if v_byte<250 then
      v_result := v_result||(v_byte%10)::text;
    end if;
  end loop;

  return v_result;
end;
$$;
revoke all on function app_private.random_numeric_code(integer)
  from public,anon,authenticated;

create or replace function app_private.case_transition_allowed(
  p_service_type text,
  p_from text,
  p_to text
)
returns boolean
language sql
immutable
set search_path=''
as $$
  select case
    when p_from=p_to then false
    when p_from in ('resolved','cancelled') then false
    when p_service_type='sav' then case p_from
      when 'opened' then p_to in (
        'deposited','received','diagnosis','quote_pending','refund_pending',
        'cancelled','delayed'
      )
      when 'deposited' then p_to in (
        'received','diagnosis','cancelled','delayed'
      )
      when 'received' then p_to in (
        'diagnosis','repairing','quote_pending','exchanged','refund_pending',
        'cancelled','delayed'
      )
      when 'diagnosis' then p_to in (
        'waiting_part','quote_pending','repairing','exchanged','refund_pending',
        'cancelled','delayed'
      )
      when 'waiting_part' then p_to in (
        'diagnosis','repairing','cancelled','delayed'
      )
      when 'quote_pending' then p_to in (
        'repairing','refund_pending','cancelled','delayed'
      )
      when 'repairing' then p_to in (
        'waiting_part','repaired','cancelled','delayed'
      )
      when 'repaired' then p_to in (
        'ready','shipping','delivered','resolved','delayed'
      )
      when 'shipping' then p_to in ('transit','ready','delivered','delayed')
      when 'transit' then p_to in ('ready','delivered','delayed')
      when 'ready' then p_to in ('delivered','exchanged','refunded','resolved')
      when 'refund_pending' then p_to in ('refunded','cancelled','delayed')
      when 'exchanged' then p_to in ('resolved','delivered')
      when 'delivered' then p_to='resolved'
      when 'refunded' then p_to='resolved'
      when 'delayed' then p_to in (
        'received','diagnosis','waiting_part','quote_pending','repairing',
        'repaired','shipping','transit','ready','refund_pending','cancelled',
        'resolved'
      )
      else false
    end
    when p_service_type='customer_service' then case p_from
      when 'opened' then p_to in (
        'complaint_review','refund_pending','resolved','cancelled','delayed'
      )
      when 'complaint_review' then p_to in (
        'refund_pending','resolved','cancelled','delayed'
      )
      when 'refund_pending' then p_to in (
        'refunded','resolved','cancelled','delayed'
      )
      when 'refunded' then p_to='resolved'
      when 'delayed' then p_to in (
        'complaint_review','refund_pending','resolved','cancelled'
      )
      else false
    end
    else false
  end;
$$;
revoke all on function app_private.case_transition_allowed(text,text,text)
  from public,anon,authenticated;
grant execute on function app_private.case_transition_allowed(text,text,text)
  to authenticated;

create or replace function app_private.case_status_label(p_status text)
returns text
language sql
immutable
set search_path=''
as $$
  select case p_status
    when 'opened' then 'Dossier ouvert'
    when 'deposited' then 'Produit déposé'
    when 'received' then 'Produit reçu au SAV'
    when 'diagnosis' then 'Diagnostic en cours'
    when 'waiting_part' then 'Pièce attendue'
    when 'quote_pending' then 'Devis à confirmer'
    when 'repairing' then 'Réparation en cours'
    when 'repaired' then 'Réparation terminée'
    when 'exchanged' then 'Produit échangé'
    when 'shipping' then 'Expédition en cours'
    when 'transit' then 'Transport en cours'
    when 'ready' then 'Dossier prêt'
    when 'delivered' then 'Livré'
    when 'refund_pending' then 'Remboursement en cours'
    when 'refunded' then 'Remboursé'
    when 'complaint_review' then 'Demande en cours d’analyse'
    when 'resolved' then 'Dossier résolu'
    when 'cancelled' then 'Dossier annulé'
    when 'delayed' then 'Retard signalé'
    else 'Dossier mis à jour'
  end;
$$;
revoke all on function app_private.case_status_label(text)
  from public,anon,authenticated;

create or replace function app_private.case_id_read_allowed(
  p_organization_id uuid,
  p_case_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path=''
as $
declare
  v_service_type text;
begin
  if p_case_id is null then
    return app_private.is_admin(
      p_organization_id,
      array['super_admin','sav_manager','sc_manager','adviser'],
      true
    );
  end if;

  select service_type into v_service_type
  from public.service_cases
  where organization_id=p_organization_id and id=p_case_id;

  return v_service_type is not null
    and app_private.case_service_read_allowed(
      p_organization_id,v_service_type
    );
end;
$;
revoke all on function app_private.case_id_read_allowed(uuid,uuid)
  from public,anon,authenticated;
grant execute on function app_private.case_id_read_allowed(uuid,uuid)
  to authenticated;

create or replace function app_private.conversation_read_allowed(
  p_organization_id uuid,
  p_conversation_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path=''
as $
declare
  v_case_id uuid;
begin
  if p_conversation_id is null then
    return app_private.is_admin(
      p_organization_id,
      array['super_admin','sav_manager','sc_manager','adviser'],
      true
    );
  end if;

  select case_id into v_case_id
  from public.assistant_conversations
  where organization_id=p_organization_id and id=p_conversation_id;

  if not found then return false; end if;
  return app_private.case_id_read_allowed(
    p_organization_id,v_case_id
  );
end;
$;
revoke all on function app_private.conversation_read_allowed(uuid,uuid)
  from public,anon,authenticated;
grant execute on function app_private.conversation_read_allowed(uuid,uuid)
  to authenticated;

-- Direct authenticated SELECTs are constrained by the same service ownership
-- rules as the RPC layer. This prevents a manager from bypassing the admin API.
drop policy if exists cases_admin_select on public.service_cases;
create policy cases_admin_select on public.service_cases
for select to authenticated
using (
  app_private.case_service_read_allowed(
    organization_id,service_type
  )
);

drop policy if exists events_admin_select on public.case_events;
create policy events_admin_select on public.case_events
for select to authenticated
using (
  app_private.case_id_read_allowed(
    organization_id,case_id
  )
);

drop policy if exists conversations_admin_select
  on public.assistant_conversations;
create policy conversations_admin_select
on public.assistant_conversations
for select to authenticated
using (
  app_private.case_id_read_allowed(
    organization_id,case_id
  )
);

drop policy if exists messages_admin_select on public.assistant_messages;
create policy messages_admin_select on public.assistant_messages
for select to authenticated
using (
  case
    when case_id is not null then
      app_private.case_id_read_allowed(
        organization_id,case_id
      )
    else
      app_private.conversation_read_allowed(
        organization_id,conversation_id
      )
  end
);

drop policy if exists handoffs_admin_select on public.handoffs;
create policy handoffs_admin_select on public.handoffs
for select to authenticated
using (
  case
    when case_id is not null then
      app_private.case_id_read_allowed(
        organization_id,case_id
      )
    when conversation_id is not null then
      app_private.conversation_read_allowed(
        organization_id,conversation_id
      )
    else
      app_private.is_admin(
        organization_id,
        array['super_admin','sav_manager','sc_manager','adviser'],
        true
      )
  end
);

-- ---------------------------------------------------------------------------
-- Read models
-- ---------------------------------------------------------------------------

create or replace function public.admin_case_form_options(
  p_organization_id uuid
)
returns jsonb
language plpgsql
stable
security invoker
set search_path=''
as $$
begin
  if not app_private.is_admin(
    p_organization_id,
    array['super_admin','sav_manager','sc_manager'],
    true
  ) then
    raise exception using errcode='42501',message='admin_access_denied';
  end if;

  return jsonb_build_object(
    'stores',coalesce((
      select jsonb_agg(to_jsonb(s) order by s.name,s.id)
      from (
        select id,code,name,city
        from public.stores
        where organization_id=p_organization_id and active
        order by name,id
        limit 200
      ) s
    ),'[]'::jsonb)
  );
end;
$$;
revoke all on function public.admin_case_form_options(uuid) from public,anon;
grant execute on function public.admin_case_form_options(uuid) to authenticated;

create or replace function public.admin_list_cases_v2(
  p_organization_id uuid,
  p_limit integer default 50,
  p_offset integer default 0,
  p_search text default null,
  p_status text default null,
  p_kind text default null,
  p_service_type text default null,
  p_archive_filter text default 'active'
)
returns jsonb
language plpgsql
stable
security invoker
set search_path=''
as $$
begin
  if p_service_type is not null
     and p_service_type not in ('sav','customer_service') then
    raise exception using errcode='22023',message='invalid_service_type';
  end if;
  if p_archive_filter not in ('active','archived','all') then
    raise exception using errcode='22023',message='invalid_archive_filter';
  end if;

  return jsonb_build_object(
    'items',coalesce((
      select jsonb_agg(row_data order by row_data->>'updated_at' desc)
      from (
        select jsonb_build_object(
          'id',c.id,
          'reference',c.reference,
          'service_type',c.service_type,
          'kind',c.kind,
          'title',c.title,
          'status',c.status,
          'warranty_status',c.warranty_status,
          'product',p.name,
          'store',s.name,
          'customer',trim(concat_ws(' ',u.first_name,u.last_name)),
          'estimated_at',c.estimated_at,
          'updated_at',c.updated_at,
          'version',c.version,
          'archived_at',c.archived_at
        ) row_data
        from public.service_cases c
        left join public.products p
          on p.id=c.product_id and p.organization_id=c.organization_id
        left join public.stores s
          on s.id=c.store_id and s.organization_id=c.organization_id
        left join public.customers u
          on u.id=c.customer_id and u.organization_id=c.organization_id
        where c.organization_id=p_organization_id
          and app_private.case_service_read_allowed(
            p_organization_id,c.service_type
          )
          and (p_service_type is null or c.service_type=p_service_type)
          and (p_status is null or c.status=p_status)
          and (p_kind is null or c.kind=p_kind)
          and (
            p_archive_filter='all'
            or (p_archive_filter='active' and c.archived_at is null)
            or (p_archive_filter='archived' and c.archived_at is not null)
          )
          and (
            p_search is null
            or p_search=''
            or c.reference ilike '%'||p_search||'%'
            or c.title ilike '%'||p_search||'%'
            or p.name ilike '%'||p_search||'%'
            or trim(concat_ws(' ',u.first_name,u.last_name))
              ilike '%'||p_search||'%'
          )
        order by c.updated_at desc,c.id
        limit least(greatest(coalesce(p_limit,50),1),100)
        offset greatest(coalesce(p_offset,0),0)
      ) listed
    ),'[]'::jsonb),
    'total',(
      select count(*)
      from public.service_cases c
      left join public.products p
        on p.id=c.product_id and p.organization_id=c.organization_id
      left join public.customers u
        on u.id=c.customer_id and u.organization_id=c.organization_id
      where c.organization_id=p_organization_id
        and app_private.case_service_read_allowed(
          p_organization_id,c.service_type
        )
        and (p_service_type is null or c.service_type=p_service_type)
        and (p_status is null or c.status=p_status)
        and (p_kind is null or c.kind=p_kind)
        and (
          p_archive_filter='all'
          or (p_archive_filter='active' and c.archived_at is null)
          or (p_archive_filter='archived' and c.archived_at is not null)
        )
        and (
          p_search is null
          or p_search=''
          or c.reference ilike '%'||p_search||'%'
          or c.title ilike '%'||p_search||'%'
          or p.name ilike '%'||p_search||'%'
          or trim(concat_ws(' ',u.first_name,u.last_name))
            ilike '%'||p_search||'%'
        )
    )
  );
end;
$$;
revoke all on function public.admin_list_cases_v2(
  uuid,integer,integer,text,text,text,text,text
) from public,anon;
grant execute on function public.admin_list_cases_v2(
  uuid,integer,integer,text,text,text,text,text
) to authenticated;

create or replace function public.admin_case_detail_v2(
  p_organization_id uuid,
  p_case_id uuid
)
returns jsonb
language plpgsql
stable
security invoker
set search_path=''
as $$
declare
  v_service_type text;
begin
  select service_type into v_service_type
  from public.service_cases
  where organization_id=p_organization_id and id=p_case_id;

  if v_service_type is null then return null; end if;
  if not app_private.case_service_read_allowed(
    p_organization_id,v_service_type
  ) then
    raise exception using errcode='42501',message='admin_access_denied';
  end if;

  return (
    select jsonb_build_object(
      'id',c.id,
      'reference',c.reference,
      'service_type',c.service_type,
      'title',c.title,
      'description',c.description,
      'kind',c.kind,
      'status',c.status,
      'version',c.version,
      'updated_at',c.updated_at,
      'estimated_at',c.estimated_at,
      'created_at',c.created_at,
      'closed_at',c.closed_at,
      'archived_at',c.archived_at,
      'archive_reason',c.archive_reason,
      'source_system',c.source_system,
      'source_updated_at',c.source_updated_at,
      'warranty_status',c.warranty_status,
      'warranty_label',c.warranty_label,
      'quote_cents',c.quote_cents,
      'refund_cents',c.refund_cents,
      'currency',c.currency,
      'delivery_mode',c.delivery_mode,
      'customer_id',c.customer_id,
      'customer',case when u.id is null then null else jsonb_build_object(
        'id',u.id,
        'external_id',u.external_id,
        'first_name',u.first_name,
        'last_name',u.last_name,
        'email',u.email,
        'phone',u.phone
      ) end,
      'product_id',c.product_id,
      'product',case when p.id is null then null else jsonb_build_object(
        'id',p.id,
        'external_id',p.external_id,
        'sku',p.sku,
        'name',p.name,
        'category',p.category,
        'serial_number',p.serial_number
      ) end,
      'store_id',c.store_id,
      'store',case when s.id is null then null else jsonb_build_object(
        'id',s.id,
        'code',s.code,
        'name',s.name,
        'city',s.city
      ) end,
      'events',coalesce((
        select jsonb_agg(to_jsonb(e) order by e.occurred_at desc,e.id desc)
        from (
          select
            id,
            label,
            details->>'detail' detail,
            customer_visible,
            occurred_at,
            source
          from public.case_events
          where organization_id=p_organization_id and case_id=c.id
          order by occurred_at desc,id desc
          limit 100
        ) e
      ),'[]'::jsonb)
    )
    from public.service_cases c
    left join public.products p
      on p.id=c.product_id and p.organization_id=c.organization_id
    left join public.stores s
      on s.id=c.store_id and s.organization_id=c.organization_id
    left join public.customers u
      on u.id=c.customer_id and u.organization_id=c.organization_id
    where c.organization_id=p_organization_id and c.id=p_case_id
  );
end;
$$;
revoke all on function public.admin_case_detail_v2(uuid,uuid) from public,anon;
grant execute on function public.admin_case_detail_v2(uuid,uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Audited mutations
-- ---------------------------------------------------------------------------

create or replace function app_private.admin_create_case(
  p_organization_id uuid,
  p_payload jsonb,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_service_type text := p_payload->>'service_type';
  v_kind text := p_payload->>'kind';
  v_title text := trim(coalesce(p_payload->>'title',''));
  v_description text := coalesce(p_payload->>'description','');
  v_warranty_status text := coalesce(p_payload->>'warranty_status','unknown');
  v_currency text := upper(coalesce(p_payload->>'currency','EUR'));
  v_quote_cents integer := nullif(p_payload->>'quote_cents','')::integer;
  v_refund_cents integer := nullif(p_payload->>'refund_cents','')::integer;
  v_customer_id uuid;
  v_product_id uuid;
  v_store_id uuid;
  v_case_id uuid;
  v_reference text;
  v_code text;
  v_fingerprint text;
  v_previous public.case_commands%rowtype;
  v_response jsonb;
begin
  if p_request_id is null
     or p_request_id !~ '^[a-zA-Z0-9-]{16,80}$' then
    raise exception using errcode='22023',message='invalid_request_id';
  end if;

  if v_service_type not in ('sav','customer_service')
     or not app_private.case_service_manage_allowed(
       p_organization_id,v_service_type
     ) then
    raise exception using errcode='42501',message='admin_access_denied';
  end if;

  if v_kind not in (
       'repair','exchange','refund','complaint','delivery','account','other'
     )
     or char_length(v_title) not between 2 and 180
     or char_length(v_description)>6000
     or v_warranty_status not in (
       'covered','not_covered','partial','unknown'
     )
     or v_currency !~ '^[A-Z]{3}$'
     or v_quote_cents not between 0 and 100000000
     or v_refund_cents not between 0 and 100000000
     or (v_service_type='sav' and v_kind in ('complaint','account'))
     or (
       v_service_type='customer_service'
       and v_kind in ('repair','exchange','delivery')
     ) then
    raise exception using errcode='22023',message='invalid_case_payload';
  end if;

  if nullif(p_payload->>'customer_id','') is not null
     and coalesce(
       nullif(trim(p_payload->>'customer_external_id'),''),
       nullif(trim(p_payload->>'customer_first_name'),''),
       nullif(trim(p_payload->>'customer_last_name'),''),
       nullif(trim(p_payload->>'customer_email'),''),
       nullif(trim(p_payload->>'customer_phone'),'')
     ) is not null then
    raise exception using errcode='22023',message='ambiguous_customer';
  end if;

  if nullif(p_payload->>'product_id','') is not null
     and coalesce(
       nullif(trim(p_payload->>'product_external_id'),''),
       nullif(trim(p_payload->>'product_name'),''),
       nullif(trim(p_payload->>'product_sku'),''),
       nullif(trim(p_payload->>'product_serial_number'),'')
     ) is not null then
    raise exception using errcode='22023',message='ambiguous_product';
  end if;

  v_fingerprint := encode(
    extensions.digest(
      concat_ws(
        '|',
        auth.uid()::text,
        p_organization_id::text,
        p_payload::text
      ),
      'sha256'
    ),
    'hex'
  );

  select * into v_previous
  from public.case_commands
  where organization_id=p_organization_id and request_id=p_request_id;

  if v_previous.id is not null then
    if v_previous.action<>'admin.case.create'
       or v_previous.response->>'fingerprint'
          is distinct from v_fingerprint then
      raise exception using errcode='40001',message='request_conflict';
    end if;

    return (v_previous.response-'fingerprint')
      || jsonb_build_object(
        'access_code',null,
        'access_code_available',false,
        'replayed',true
      );
  end if;

  if nullif(p_payload->>'customer_id','') is not null then
    v_customer_id := (p_payload->>'customer_id')::uuid;
    if not exists(
      select 1
      from public.customers
      where organization_id=p_organization_id and id=v_customer_id
    ) then
      raise exception using errcode='P0002',message='customer_not_found';
    end if;
  elsif coalesce(
    nullif(trim(p_payload->>'customer_external_id'),''),
    nullif(trim(p_payload->>'customer_first_name'),''),
    nullif(trim(p_payload->>'customer_last_name'),''),
    nullif(trim(p_payload->>'customer_email'),''),
    nullif(trim(p_payload->>'customer_phone'),'')
  ) is not null then
    if nullif(trim(p_payload->>'customer_external_id'),'') is not null then
      insert into public.customers(
        organization_id,external_id,first_name,last_name,email,phone
      ) values (
        p_organization_id,
        trim(p_payload->>'customer_external_id'),
        nullif(trim(p_payload->>'customer_first_name'),''),
        nullif(trim(p_payload->>'customer_last_name'),''),
        nullif(trim(p_payload->>'customer_email'),''),
        nullif(trim(p_payload->>'customer_phone'),'')
      )
      on conflict (organization_id,external_id) do nothing
      returning id into v_customer_id;

      if v_customer_id is null then
        select id into v_customer_id
        from public.customers
        where organization_id=p_organization_id
          and external_id=trim(p_payload->>'customer_external_id')
        limit 1;
      end if;
    else
      insert into public.customers(
        organization_id,first_name,last_name,email,phone
      ) values (
        p_organization_id,
        nullif(trim(p_payload->>'customer_first_name'),''),
        nullif(trim(p_payload->>'customer_last_name'),''),
        nullif(trim(p_payload->>'customer_email'),''),
        nullif(trim(p_payload->>'customer_phone'),'')
      )
      returning id into v_customer_id;
    end if;
  end if;

  if nullif(p_payload->>'product_id','') is not null then
    v_product_id := (p_payload->>'product_id')::uuid;
    if not exists(
      select 1
      from public.products
      where organization_id=p_organization_id and id=v_product_id
    ) then
      raise exception using errcode='P0002',message='product_not_found';
    end if;
  elsif nullif(trim(p_payload->>'product_name'),'') is not null then
    if nullif(trim(p_payload->>'product_external_id'),'') is not null then
      insert into public.products(
        organization_id,external_id,sku,name,category,serial_number
      ) values (
        p_organization_id,
        trim(p_payload->>'product_external_id'),
        nullif(trim(p_payload->>'product_sku'),''),
        trim(p_payload->>'product_name'),
        nullif(trim(p_payload->>'product_category'),''),
        nullif(trim(p_payload->>'product_serial_number'),'')
      )
      on conflict (organization_id,external_id) do nothing
      returning id into v_product_id;

      if v_product_id is null then
        select id into v_product_id
        from public.products
        where organization_id=p_organization_id
          and external_id=trim(p_payload->>'product_external_id')
        limit 1;
      end if;
    else
      insert into public.products(
        organization_id,sku,name,category,serial_number
      ) values (
        p_organization_id,
        nullif(trim(p_payload->>'product_sku'),''),
        trim(p_payload->>'product_name'),
        nullif(trim(p_payload->>'product_category'),''),
        nullif(trim(p_payload->>'product_serial_number'),'')
      )
      returning id into v_product_id;
    end if;
  end if;

  if nullif(p_payload->>'store_id','') is not null then
    v_store_id := (p_payload->>'store_id')::uuid;
    if not exists(
      select 1
      from public.stores
      where organization_id=p_organization_id
        and id=v_store_id
        and active
    ) then
      raise exception using errcode='P0002',message='store_not_found';
    end if;
  end if;

  v_reference := app_private.next_case_reference(
    p_organization_id,v_service_type
  );

  insert into public.service_cases(
    organization_id,
    customer_id,
    product_id,
    store_id,
    reference,
    service_type,
    kind,
    title,
    description,
    status,
    warranty_status,
    warranty_label,
    quote_cents,
    refund_cents,
    currency,
    delivery_mode,
    estimated_at,
    source_system,
    source_updated_at
  ) values (
    p_organization_id,
    v_customer_id,
    v_product_id,
    v_store_id,
    v_reference,
    v_service_type,
    v_kind,
    v_title,
    v_description,
    'opened',
    v_warranty_status,
    nullif(trim(p_payload->>'warranty_label'),''),
    v_quote_cents,
    v_refund_cents,
    v_currency,
    nullif(trim(p_payload->>'delivery_mode'),''),
    nullif(p_payload->>'estimated_at','')::timestamptz,
    'admin_ui',
    now()
  )
  returning id into v_case_id;

  insert into public.case_events(
    organization_id,
    case_id,
    status,
    label,
    details,
    customer_visible,
    source,
    actor_user_id
  ) values (
    p_organization_id,
    v_case_id,
    'opened',
    case
      when v_service_type='sav' then 'Dossier SAV enregistré'
      else 'Demande service client enregistrée'
    end,
    '{}'::jsonb,
    true,
    'admin',
    auth.uid()
  );

  v_code := app_private.random_numeric_code(8);
  insert into public.case_access_codes(
    organization_id,
    case_id,
    code_hash,
    expires_at,
    created_by
  ) values (
    p_organization_id,
    v_case_id,
    extensions.crypt(v_code,extensions.gen_salt('bf',12)),
    now()+interval '90 days',
    auth.uid()
  );

  insert into public.audit_events(
    organization_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    request_id,
    metadata
  ) values (
    p_organization_id,
    auth.uid(),
    'case.create',
    'service_case',
    v_case_id,
    p_request_id,
    jsonb_build_object(
      'reference',v_reference,
      'service_type',v_service_type,
      'kind',v_kind,
      'version',1
    )
  );

  v_response := jsonb_build_object(
    'ok',true,
    'id',v_case_id,
    'reference',v_reference,
    'version',1
  );

  insert into public.case_commands(
    organization_id,
    case_id,
    request_id,
    action,
    status,
    response
  ) values (
    p_organization_id,
    v_case_id,
    p_request_id,
    'admin.case.create',
    'completed',
    v_response||jsonb_build_object('fingerprint',v_fingerprint)
  );

  return v_response||jsonb_build_object(
    'access_code',v_code,
    'access_code_available',true,
    'replayed',false
  );
end;
$$;
revoke all on function app_private.admin_create_case(uuid,jsonb,text)
  from public,anon,authenticated;
grant execute on function app_private.admin_create_case(uuid,jsonb,text)
  to authenticated;

create or replace function public.admin_create_case(
  p_organization_id uuid,
  p_payload jsonb,
  p_request_id text
)
returns jsonb
language sql
security invoker
set search_path=''
as $$
  select app_private.admin_create_case(
    p_organization_id,p_payload,p_request_id
  );
$$;
revoke all on function public.admin_create_case(uuid,jsonb,text)
  from public,anon;
grant execute on function public.admin_create_case(uuid,jsonb,text)
  to authenticated;

create or replace function app_private.admin_update_case(
  p_organization_id uuid,
  p_case_id uuid,
  p_expected_version integer,
  p_payload jsonb,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  c public.service_cases%rowtype;
  v_customer_id uuid;
  v_product_id uuid;
  v_store_id uuid;
  v_title text := trim(coalesce(p_payload->>'title',''));
  v_description text := coalesce(p_payload->>'description','');
  v_warranty_status text := coalesce(
    p_payload->>'warranty_status','unknown'
  );
  v_currency text := upper(coalesce(p_payload->>'currency','EUR'));
  v_quote_cents integer := nullif(p_payload->>'quote_cents','')::integer;
  v_refund_cents integer := nullif(p_payload->>'refund_cents','')::integer;
  v_fingerprint text;
  v_previous public.case_commands%rowtype;
  v_changed_fields text[] := array[]::text[];
  v_response jsonb;
begin
  if p_expected_version is null
     or p_expected_version<1
     or p_request_id is null
     or p_request_id !~ '^[a-zA-Z0-9-]{16,80}$'
     or char_length(v_title) not between 2 and 180
     or char_length(v_description)>6000
     or v_warranty_status not in (
       'covered','not_covered','partial','unknown'
     )
     or v_currency !~ '^[A-Z]{3}$'
     or v_quote_cents not between 0 and 100000000
     or v_refund_cents not between 0 and 100000000 then
    raise exception using errcode='22023',message='invalid_case_update';
  end if;

  select * into c
  from public.service_cases
  where id=p_case_id and organization_id=p_organization_id
  for update;

  if c.id is null then
    raise exception using errcode='P0002',message='case_not_found';
  end if;
  if c.archived_at is not null then
    raise exception using errcode='40001',message='case_archived';
  end if;
  if not app_private.case_service_manage_allowed(
    p_organization_id,c.service_type
  ) then
    raise exception using errcode='42501',message='admin_access_denied';
  end if;

  v_fingerprint := encode(
    extensions.digest(
      concat_ws(
        '|',
        auth.uid()::text,
        p_case_id::text,
        p_expected_version::text,
        p_payload::text
      ),
      'sha256'
    ),
    'hex'
  );

  select * into v_previous
  from public.case_commands
  where organization_id=p_organization_id and request_id=p_request_id;

  if v_previous.id is not null then
    if v_previous.action<>'admin.case.update'
       or v_previous.case_id<>p_case_id
       or v_previous.response->>'fingerprint'
          is distinct from v_fingerprint then
      raise exception using errcode='40001',message='request_conflict';
    end if;
    return v_previous.response-'fingerprint';
  end if;

  if c.version<>p_expected_version then
    raise exception using errcode='40001',message='version_conflict';
  end if;

  if nullif(p_payload->>'customer_id','') is not null then
    v_customer_id := (p_payload->>'customer_id')::uuid;
    if not exists(
      select 1 from public.customers
      where organization_id=p_organization_id and id=v_customer_id
    ) then
      raise exception using errcode='P0002',message='customer_not_found';
    end if;
  end if;

  if nullif(p_payload->>'product_id','') is not null then
    v_product_id := (p_payload->>'product_id')::uuid;
    if not exists(
      select 1 from public.products
      where organization_id=p_organization_id and id=v_product_id
    ) then
      raise exception using errcode='P0002',message='product_not_found';
    end if;
  end if;

  if nullif(p_payload->>'store_id','') is not null then
    v_store_id := (p_payload->>'store_id')::uuid;
    if not exists(
      select 1 from public.stores
      where organization_id=p_organization_id
        and id=v_store_id
        and active
    ) then
      raise exception using errcode='P0002',message='store_not_found';
    end if;
  end if;

  if c.title is distinct from v_title then
    v_changed_fields:=array_append(v_changed_fields,'title');
  end if;
  if c.description is distinct from v_description then
    v_changed_fields:=array_append(v_changed_fields,'description');
  end if;
  if c.warranty_status is distinct from v_warranty_status then
    v_changed_fields:=array_append(v_changed_fields,'warranty_status');
  end if;
  if c.warranty_label is distinct from
     nullif(trim(p_payload->>'warranty_label'),'') then
    v_changed_fields:=array_append(v_changed_fields,'warranty_label');
  end if;
  if c.quote_cents is distinct from v_quote_cents then
    v_changed_fields:=array_append(v_changed_fields,'quote_cents');
  end if;
  if c.refund_cents is distinct from v_refund_cents then
    v_changed_fields:=array_append(v_changed_fields,'refund_cents');
  end if;
  if c.currency is distinct from v_currency then
    v_changed_fields:=array_append(v_changed_fields,'currency');
  end if;
  if c.delivery_mode is distinct from
     nullif(trim(p_payload->>'delivery_mode'),'') then
    v_changed_fields:=array_append(v_changed_fields,'delivery_mode');
  end if;
  if c.estimated_at is distinct from
     nullif(p_payload->>'estimated_at','')::timestamptz then
    v_changed_fields:=array_append(v_changed_fields,'estimated_at');
  end if;
  if c.customer_id is distinct from v_customer_id then
    v_changed_fields:=array_append(v_changed_fields,'customer_id');
  end if;
  if c.product_id is distinct from v_product_id then
    v_changed_fields:=array_append(v_changed_fields,'product_id');
  end if;
  if c.store_id is distinct from v_store_id then
    v_changed_fields:=array_append(v_changed_fields,'store_id');
  end if;

  if cardinality(v_changed_fields)=0 then
    v_response := jsonb_build_object(
      'ok',true,
      'id',p_case_id,
      'reference',c.reference,
      'version',c.version,
      'changed_fields','[]'::jsonb
    );
    insert into public.case_commands(
      organization_id,case_id,request_id,action,status,response
    ) values (
      p_organization_id,p_case_id,p_request_id,
      'admin.case.update','completed',
      v_response||jsonb_build_object('fingerprint',v_fingerprint)
    );
    return v_response;
  end if;

  update public.service_cases set
    customer_id=v_customer_id,
    product_id=v_product_id,
    store_id=v_store_id,
    title=v_title,
    description=v_description,
    warranty_status=v_warranty_status,
    warranty_label=nullif(trim(p_payload->>'warranty_label'),''),
    quote_cents=v_quote_cents,
    refund_cents=v_refund_cents,
    currency=v_currency,
    delivery_mode=nullif(trim(p_payload->>'delivery_mode'),''),
    estimated_at=nullif(p_payload->>'estimated_at','')::timestamptz,
    source_system='admin_ui',
    source_updated_at=now(),
    version=version+1
  where id=p_case_id;

  insert into public.case_events(
    organization_id,
    case_id,
    status,
    label,
    details,
    customer_visible,
    source,
    actor_user_id
  ) values (
    p_organization_id,
    p_case_id,
    c.status,
    'Dossier mis à jour',
    jsonb_build_object(
      'changed_fields',to_jsonb(v_changed_fields)
    ),
    false,
    'admin',
    auth.uid()
  );

  insert into public.audit_events(
    organization_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    request_id,
    metadata
  ) values (
    p_organization_id,
    auth.uid(),
    'case.update',
    'service_case',
    p_case_id,
    p_request_id,
    jsonb_build_object(
      'from_version',c.version,
      'to_version',c.version+1,
      'changed_fields',to_jsonb(v_changed_fields)
    )
  );

  v_response := jsonb_build_object(
    'ok',true,
    'id',p_case_id,
    'reference',c.reference,
    'version',c.version+1,
    'changed_fields',to_jsonb(v_changed_fields)
  );

  insert into public.case_commands(
    organization_id,
    case_id,
    request_id,
    action,
    status,
    response
  ) values (
    p_organization_id,
    p_case_id,
    p_request_id,
    'admin.case.update',
    'completed',
    v_response||jsonb_build_object('fingerprint',v_fingerprint)
  );

  return v_response;
end;
$$;
revoke all on function app_private.admin_update_case(
  uuid,uuid,integer,jsonb,text
) from public,anon,authenticated;
grant execute on function app_private.admin_update_case(
  uuid,uuid,integer,jsonb,text
) to authenticated;

create or replace function public.admin_update_case(
  p_organization_id uuid,
  p_case_id uuid,
  p_expected_version integer,
  p_payload jsonb,
  p_request_id text
)
returns jsonb
language sql
security invoker
set search_path=''
as $$
  select app_private.admin_update_case(
    p_organization_id,
    p_case_id,
    p_expected_version,
    p_payload,
    p_request_id
  );
$$;
revoke all on function public.admin_update_case(
  uuid,uuid,integer,jsonb,text
) from public,anon;
grant execute on function public.admin_update_case(
  uuid,uuid,integer,jsonb,text
) to authenticated;

create or replace function app_private.admin_transition_case(
  p_organization_id uuid,
  p_case_id uuid,
  p_expected_version integer,
  p_status text,
  p_note text,
  p_customer_visible boolean,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  c public.service_cases%rowtype;
  v_previous public.case_commands%rowtype;
  v_fingerprint text;
  v_response jsonb;
begin
  if p_expected_version is null
     or p_expected_version<1
     or p_customer_visible is null
     or p_request_id is null
     or p_request_id !~ '^[a-zA-Z0-9-]{16,80}$'
     or p_status not in (
       'opened','deposited','received','diagnosis','waiting_part',
       'quote_pending','repairing','repaired','exchanged','shipping',
       'transit','ready','delivered','refund_pending','refunded',
       'complaint_review','resolved','cancelled','delayed'
     )
     or char_length(coalesce(p_note,''))>2000 then
    raise exception using errcode='22023',message='invalid_case_transition';
  end if;

  select * into c
  from public.service_cases
  where id=p_case_id and organization_id=p_organization_id
  for update;

  if c.id is null then
    raise exception using errcode='P0002',message='case_not_found';
  end if;
  if c.archived_at is not null then
    raise exception using errcode='40001',message='case_archived';
  end if;
  if not app_private.case_service_manage_allowed(
    p_organization_id,c.service_type
  ) then
    raise exception using errcode='42501',message='admin_access_denied';
  end if;

  v_fingerprint := encode(
    extensions.digest(
      concat_ws(
        '|',
        auth.uid()::text,
        p_case_id::text,
        p_expected_version::text,
        p_status,
        coalesce(trim(p_note),''),
        p_customer_visible::text
      ),
      'sha256'
    ),
    'hex'
  );

  select * into v_previous
  from public.case_commands
  where organization_id=p_organization_id and request_id=p_request_id;

  if v_previous.id is not null then
    if v_previous.action<>'admin.case.transition'
       or v_previous.case_id<>p_case_id
       or v_previous.response->>'fingerprint'
          is distinct from v_fingerprint then
      raise exception using errcode='40001',message='request_conflict';
    end if;
    return v_previous.response-'fingerprint';
  end if;

  if c.version<>p_expected_version then
    raise exception using errcode='40001',message='version_conflict';
  end if;
  if not app_private.case_transition_allowed(
    c.service_type,c.status,p_status
  ) then
    raise exception using errcode='22023',message='invalid_status_transition';
  end if;

  update public.service_cases set
    status=p_status,
    closed_at=case
      when p_status in ('resolved','cancelled') then now()
      else closed_at
    end,
    source_system='admin_ui',
    source_updated_at=now(),
    version=version+1
  where id=p_case_id;

  insert into public.case_events(
    organization_id,
    case_id,
    status,
    label,
    details,
    customer_visible,
    source,
    actor_user_id
  ) values (
    p_organization_id,
    p_case_id,
    p_status,
    app_private.case_status_label(p_status),
    case
      when nullif(trim(p_note),'') is null then '{}'::jsonb
      else jsonb_build_object('detail',trim(p_note))
    end,
    p_customer_visible,
    'admin',
    auth.uid()
  );

  insert into public.audit_events(
    organization_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    request_id,
    metadata
  ) values (
    p_organization_id,
    auth.uid(),
    'case.transition',
    'service_case',
    p_case_id,
    p_request_id,
    jsonb_build_object(
      'from_status',c.status,
      'to_status',p_status,
      'from_version',c.version,
      'to_version',c.version+1,
      'customer_visible',p_customer_visible
    )
  );

  v_response := jsonb_build_object(
    'ok',true,
    'id',p_case_id,
    'reference',c.reference,
    'status',p_status,
    'version',c.version+1
  );

  insert into public.case_commands(
    organization_id,
    case_id,
    request_id,
    action,
    status,
    response
  ) values (
    p_organization_id,
    p_case_id,
    p_request_id,
    'admin.case.transition',
    'completed',
    v_response||jsonb_build_object('fingerprint',v_fingerprint)
  );

  return v_response;
end;
$$;
revoke all on function app_private.admin_transition_case(
  uuid,uuid,integer,text,text,boolean,text
) from public,anon,authenticated;
grant execute on function app_private.admin_transition_case(
  uuid,uuid,integer,text,text,boolean,text
) to authenticated;

create or replace function public.admin_transition_case(
  p_organization_id uuid,
  p_case_id uuid,
  p_expected_version integer,
  p_status text,
  p_note text,
  p_customer_visible boolean,
  p_request_id text
)
returns jsonb
language sql
security invoker
set search_path=''
as $$
  select app_private.admin_transition_case(
    p_organization_id,
    p_case_id,
    p_expected_version,
    p_status,
    p_note,
    p_customer_visible,
    p_request_id
  );
$$;
revoke all on function public.admin_transition_case(
  uuid,uuid,integer,text,text,boolean,text
) from public,anon;
grant execute on function public.admin_transition_case(
  uuid,uuid,integer,text,text,boolean,text
) to authenticated;

create or replace function app_private.admin_rotate_case_access_code(
  p_organization_id uuid,
  p_case_id uuid,
  p_expected_version integer,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  c public.service_cases%rowtype;
  v_previous public.case_commands%rowtype;
  v_fingerprint text;
  v_code text;
  v_response jsonb;
begin
  if p_expected_version is null
     or p_expected_version<1
     or p_request_id is null
     or p_request_id !~ '^[a-zA-Z0-9-]{16,80}$' then
    raise exception
      using errcode='22023',message='invalid_access_code_rotation';
  end if;

  select * into c
  from public.service_cases
  where id=p_case_id and organization_id=p_organization_id
  for update;

  if c.id is null then
    raise exception using errcode='P0002',message='case_not_found';
  end if;
  if c.archived_at is not null then
    raise exception using errcode='40001',message='case_archived';
  end if;
  if not app_private.case_service_manage_allowed(
    p_organization_id,c.service_type
  ) then
    raise exception using errcode='42501',message='admin_access_denied';
  end if;

  v_fingerprint := encode(
    extensions.digest(
      concat_ws(
        '|',
        auth.uid()::text,
        p_case_id::text,
        p_expected_version::text,
        'rotate'
      ),
      'sha256'
    ),
    'hex'
  );

  select * into v_previous
  from public.case_commands
  where organization_id=p_organization_id and request_id=p_request_id;

  if v_previous.id is not null then
    if v_previous.action<>'admin.case.access.rotate'
       or v_previous.case_id<>p_case_id
       or v_previous.response->>'fingerprint'
          is distinct from v_fingerprint then
      raise exception using errcode='40001',message='request_conflict';
    end if;

    return (v_previous.response-'fingerprint')
      || jsonb_build_object(
        'access_code',null,
        'access_code_available',false,
        'replayed',true
      );
  end if;

  if c.version<>p_expected_version then
    raise exception using errcode='40001',message='version_conflict';
  end if;

  update public.case_access_codes
  set revoked_at=now()
  where organization_id=p_organization_id
    and case_id=p_case_id
    and revoked_at is null;

  -- Explicit revocation keeps the security property independent from trigger
  -- ordering and makes rotation semantics self-contained.
  update public.case_sessions
  set revoked_at=now()
  where organization_id=p_organization_id
    and case_id=p_case_id
    and revoked_at is null;

  v_code := app_private.random_numeric_code(8);
  insert into public.case_access_codes(
    organization_id,
    case_id,
    code_hash,
    expires_at,
    created_by
  ) values (
    p_organization_id,
    p_case_id,
    extensions.crypt(v_code,extensions.gen_salt('bf',12)),
    now()+interval '90 days',
    auth.uid()
  );

  update public.service_cases set
    version=version+1,
    source_system='admin_ui',
    source_updated_at=now()
  where id=p_case_id;

  insert into public.case_events(
    organization_id,
    case_id,
    status,
    label,
    details,
    customer_visible,
    source,
    actor_user_id
  ) values (
    p_organization_id,
    p_case_id,
    c.status,
    'Code d’accès renouvelé',
    '{}'::jsonb,
    false,
    'admin',
    auth.uid()
  );

  insert into public.audit_events(
    organization_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    request_id,
    metadata
  ) values (
    p_organization_id,
    auth.uid(),
    'case.access_code.rotate',
    'service_case',
    p_case_id,
    p_request_id,
    jsonb_build_object(
      'from_version',c.version,
      'to_version',c.version+1
    )
  );

  v_response := jsonb_build_object(
    'ok',true,
    'id',p_case_id,
    'reference',c.reference,
    'version',c.version+1
  );

  insert into public.case_commands(
    organization_id,
    case_id,
    request_id,
    action,
    status,
    response
  ) values (
    p_organization_id,
    p_case_id,
    p_request_id,
    'admin.case.access.rotate',
    'completed',
    v_response||jsonb_build_object('fingerprint',v_fingerprint)
  );

  return v_response||jsonb_build_object(
    'access_code',v_code,
    'access_code_available',true,
    'replayed',false
  );
end;
$$;
revoke all on function app_private.admin_rotate_case_access_code(
  uuid,uuid,integer,text
) from public,anon,authenticated;
grant execute on function app_private.admin_rotate_case_access_code(
  uuid,uuid,integer,text
) to authenticated;

create or replace function public.admin_rotate_case_access_code(
  p_organization_id uuid,
  p_case_id uuid,
  p_expected_version integer,
  p_request_id text
)
returns jsonb
language sql
security invoker
set search_path=''
as $$
  select app_private.admin_rotate_case_access_code(
    p_organization_id,p_case_id,p_expected_version,p_request_id
  );
$$;
revoke all on function public.admin_rotate_case_access_code(
  uuid,uuid,integer,text
) from public,anon;
grant execute on function public.admin_rotate_case_access_code(
  uuid,uuid,integer,text
) to authenticated;

create or replace function app_private.admin_archive_case(
  p_organization_id uuid,
  p_case_id uuid,
  p_expected_version integer,
  p_reason text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  c public.service_cases%rowtype;
  v_previous public.case_commands%rowtype;
  v_fingerprint text;
  v_response jsonb;
begin
  if p_expected_version is null
     or p_expected_version<1
     or char_length(trim(coalesce(p_reason,''))) not between 3 and 1000
     or p_request_id is null
     or p_request_id !~ '^[a-zA-Z0-9-]{16,80}$' then
    raise exception using errcode='22023',message='invalid_case_archive';
  end if;

  select * into c
  from public.service_cases
  where id=p_case_id and organization_id=p_organization_id
  for update;

  if c.id is null then
    raise exception using errcode='P0002',message='case_not_found';
  end if;
  if c.archived_at is not null then
    raise exception using errcode='40001',message='case_already_archived';
  end if;
  if not app_private.case_service_manage_allowed(
    p_organization_id,c.service_type
  ) then
    raise exception using errcode='42501',message='admin_access_denied';
  end if;

  v_fingerprint := encode(
    extensions.digest(
      concat_ws(
        '|',
        auth.uid()::text,
        p_case_id::text,
        p_expected_version::text,
        trim(p_reason)
      ),
      'sha256'
    ),
    'hex'
  );

  select * into v_previous
  from public.case_commands
  where organization_id=p_organization_id and request_id=p_request_id;

  if v_previous.id is not null then
    if v_previous.action<>'admin.case.archive'
       or v_previous.case_id<>p_case_id
       or v_previous.response->>'fingerprint'
          is distinct from v_fingerprint then
      raise exception using errcode='40001',message='request_conflict';
    end if;
    return v_previous.response-'fingerprint';
  end if;

  if c.version<>p_expected_version then
    raise exception using errcode='40001',message='version_conflict';
  end if;

  update public.case_access_codes
  set revoked_at=now()
  where organization_id=p_organization_id
    and case_id=p_case_id
    and revoked_at is null;

  update public.case_sessions
  set revoked_at=now()
  where organization_id=p_organization_id
    and case_id=p_case_id
    and revoked_at is null;

  update public.handoffs
  set status='cancelled'
  where organization_id=p_organization_id
    and case_id=p_case_id
    and status in ('open','assigned');

  update public.assistant_conversations
  set ended_at=coalesce(ended_at,now())
  where organization_id=p_organization_id
    and case_id=p_case_id
    and ended_at is null;

  update public.service_cases set
    archived_at=now(),
    archived_by=auth.uid(),
    archive_reason=trim(p_reason),
    version=version+1,
    source_system='admin_ui',
    source_updated_at=now()
  where id=p_case_id;

  insert into public.case_events(
    organization_id,
    case_id,
    status,
    label,
    details,
    customer_visible,
    source,
    actor_user_id
  ) values (
    p_organization_id,
    p_case_id,
    c.status,
    'Dossier archivé',
    jsonb_build_object('detail',trim(p_reason)),
    false,
    'admin',
    auth.uid()
  );

  insert into public.audit_events(
    organization_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    request_id,
    metadata
  ) values (
    p_organization_id,
    auth.uid(),
    'case.archive',
    'service_case',
    p_case_id,
    p_request_id,
    jsonb_build_object(
      'reference',c.reference,
      'service_type',c.service_type,
      'from_version',c.version,
      'to_version',c.version+1
    )
  );

  v_response := jsonb_build_object(
    'ok',true,
    'id',p_case_id,
    'reference',c.reference,
    'version',c.version+1,
    'archived',true
  );

  insert into public.case_commands(
    organization_id,
    case_id,
    request_id,
    action,
    status,
    response
  ) values (
    p_organization_id,
    p_case_id,
    p_request_id,
    'admin.case.archive',
    'completed',
    v_response||jsonb_build_object('fingerprint',v_fingerprint)
  );

  return v_response;
end;
$$;
revoke all on function app_private.admin_archive_case(
  uuid,uuid,integer,text,text
) from public,anon,authenticated;
grant execute on function app_private.admin_archive_case(
  uuid,uuid,integer,text,text
) to authenticated;

create or replace function public.admin_archive_case(
  p_organization_id uuid,
  p_case_id uuid,
  p_expected_version integer,
  p_reason text,
  p_request_id text
)
returns jsonb
language sql
security invoker
set search_path=''
as $$
  select app_private.admin_archive_case(
    p_organization_id,
    p_case_id,
    p_expected_version,
    p_reason,
    p_request_id
  );
$$;
revoke all on function public.admin_archive_case(
  uuid,uuid,integer,text,text
) from public,anon;
grant execute on function public.admin_archive_case(
  uuid,uuid,integer,text,text
) to authenticated;

-- Existing note/handoff operations become archive-aware and use the same
-- service ownership checks as the new case manager.

create or replace function app_private.admin_add_note(
  p_organization_id uuid,
  p_case_id uuid,
  p_version integer,
  p_note text,
  p_visible boolean,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  c public.service_cases%rowtype;
  previous public.case_commands%rowtype;
  event_id uuid;
  fingerprint text;
  result jsonb;
begin
  if p_note is null
     or char_length(trim(p_note)) not between 3 and 4000
     or p_visible is null
     or p_version is null
     or p_request_id is null
     or p_request_id !~ '^[a-zA-Z0-9-]{16,80}$' then
    raise exception using errcode='22023',message='invalid_note';
  end if;

  select * into c
  from public.service_cases
  where id=p_case_id and organization_id=p_organization_id
  for update;

  if c.id is null then
    raise exception using errcode='P0002',message='case_not_found';
  end if;
  if c.archived_at is not null then
    raise exception using errcode='40001',message='case_archived';
  end if;
  if not app_private.case_service_read_allowed(
    p_organization_id,c.service_type
  ) then
    raise exception using errcode='42501',message='admin_access_denied';
  end if;

  fingerprint := encode(
    extensions.digest(
      concat_ws(
        '|',
        auth.uid()::text,
        p_case_id::text,
        p_visible::text,
        trim(p_note)
      ),
      'sha256'
    ),
    'hex'
  );

  select * into previous
  from public.case_commands
  where organization_id=p_organization_id and request_id=p_request_id;

  if previous.id is not null then
    if previous.action<>'admin.note'
       or previous.response->>'fingerprint'
          is distinct from fingerprint then
      raise exception using errcode='40001',message='request_conflict';
    end if;
    return previous.response-'fingerprint';
  end if;

  if c.version<>p_version then
    raise exception using errcode='40001',message='version_conflict';
  end if;

  insert into public.case_events(
    organization_id,
    case_id,
    status,
    label,
    details,
    customer_visible,
    source,
    actor_user_id
  ) values (
    p_organization_id,
    p_case_id,
    c.status,
    case
      when p_visible then 'Message de votre conseiller'
      else 'Note interne'
    end,
    jsonb_build_object('detail',trim(p_note)),
    p_visible,
    'admin',
    auth.uid()
  )
  returning id into event_id;

  update public.service_cases
  set
    version=version+1,
    source_system='admin_ui',
    source_updated_at=now()
  where id=p_case_id;

  insert into public.audit_events(
    organization_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    request_id,
    metadata
  ) values (
    p_organization_id,
    auth.uid(),
    'case.note',
    'service_case',
    p_case_id,
    p_request_id,
    jsonb_build_object(
      'customer_visible',p_visible,
      'event_id',event_id
    )
  );

  result := jsonb_build_object(
    'ok',true,
    'version',c.version+1,
    'event_id',event_id
  );

  insert into public.case_commands(
    organization_id,
    case_id,
    request_id,
    action,
    status,
    response
  ) values (
    p_organization_id,
    p_case_id,
    p_request_id,
    'admin.note',
    'completed',
    result||jsonb_build_object('fingerprint',fingerprint)
  );

  return result;
end;
$$;
revoke all on function app_private.admin_add_note(
  uuid,uuid,integer,text,boolean,text
) from public,anon,authenticated;
grant execute on function app_private.admin_add_note(
  uuid,uuid,integer,text,boolean,text
) to authenticated;

create or replace function public.admin_add_note(
  p_organization_id uuid,
  p_case_id uuid,
  p_version integer,
  p_note text,
  p_visible boolean,
  p_request_id text
)
returns jsonb
language sql
security invoker
set search_path=''
as $$
  select app_private.admin_add_note(
    p_organization_id,
    p_case_id,
    p_version,
    p_note,
    p_visible,
    p_request_id
  );
$$;
revoke all on function public.admin_add_note(
  uuid,uuid,integer,text,boolean,text
) from public,anon;
grant execute on function public.admin_add_note(
  uuid,uuid,integer,text,boolean,text
) to authenticated;

create or replace function app_private.admin_manage_handoff(
  p_organization_id uuid,
  p_handoff_id uuid,
  p_status text,
  p_expected_updated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  h public.handoffs%rowtype;
  c public.service_cases%rowtype;
begin
  if p_status is null
     or p_status not in ('assigned','resolved')
     or p_expected_updated_at is null then
    raise exception using errcode='22023',message='invalid_status';
  end if;

  select * into h
  from public.handoffs
  where id=p_handoff_id and organization_id=p_organization_id
  for update;

  if h.id is null then
    raise exception using errcode='P0002',message='handoff_not_found';
  end if;

  if h.case_id is not null then
    select * into c
    from public.service_cases
    where id=h.case_id and organization_id=p_organization_id;

    if c.id is null or c.archived_at is not null then
      raise exception using errcode='40001',message='case_archived';
    end if;
    if not app_private.case_service_read_allowed(
      p_organization_id,c.service_type
    ) then
      raise exception using errcode='42501',message='admin_access_denied';
    end if;
  elsif not app_private.is_admin(
    p_organization_id,
    array['super_admin','sav_manager','sc_manager','adviser'],
    true
  ) then
    raise exception using errcode='42501',message='admin_access_denied';
  end if;

  if h.updated_at<>p_expected_updated_at then
    raise exception using errcode='40001',message='version_conflict';
  end if;
  if h.status not in ('open','assigned') then
    raise exception using errcode='40001',message='handoff_closed';
  end if;
  if h.assigned_to is not null
     and h.assigned_to<>auth.uid()
     and not app_private.is_admin(
       p_organization_id,
       array['super_admin','sav_manager','sc_manager'],
       true
     ) then
    raise exception using errcode='42501',message='assignment_denied';
  end if;

  update public.handoffs
  set
    status=p_status,
    assigned_to=coalesce(h.assigned_to,auth.uid())
  where id=h.id;

  insert into public.audit_events(
    organization_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata
  ) values (
    p_organization_id,
    auth.uid(),
    'handoff.'||p_status,
    'handoff',
    h.id,
    jsonb_build_object('previous_status',h.status)
  );

  return jsonb_build_object('ok',true);
end;
$$;
revoke all on function app_private.admin_manage_handoff(
  uuid,uuid,text,timestamptz
) from public,anon,authenticated;
grant execute on function app_private.admin_manage_handoff(
  uuid,uuid,text,timestamptz
) to authenticated;

create or replace function public.admin_manage_handoff(
  p_organization_id uuid,
  p_handoff_id uuid,
  p_status text,
  p_expected_updated_at timestamptz
)
returns jsonb
language sql
security invoker
set search_path=''
as $$
  select app_private.admin_manage_handoff(
    p_organization_id,
    p_handoff_id,
    p_status,
    p_expected_updated_at
  );
$$;
revoke all on function public.admin_manage_handoff(
  uuid,uuid,text,timestamptz
) from public,anon;
grant execute on function public.admin_manage_handoff(
  uuid,uuid,text,timestamptz
) to authenticated;

-- ---------------------------------------------------------------------------
-- Operational projections exclude archives and respect service ownership.
-- ---------------------------------------------------------------------------

create or replace function public.admin_dashboard(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path=''
as $$
begin
  if not app_private.is_admin(p_organization_id,null,true) then
    raise exception using errcode='42501',message='admin_access_denied';
  end if;

  return jsonb_build_object(
    'generated_at',now(),
    'cases',jsonb_build_object(
      'total',(
        select count(*)
        from public.service_cases c
        where c.organization_id=p_organization_id
          and c.archived_at is null
          and app_private.case_service_read_allowed(
            p_organization_id,c.service_type
          )
      ),
      'open',(
        select count(*)
        from public.service_cases c
        where c.organization_id=p_organization_id
          and c.archived_at is null
          and app_private.case_service_read_allowed(
            p_organization_id,c.service_type
          )
          and c.closed_at is null
          and c.status not in (
            'resolved','cancelled','delivered','refunded'
          )
      ),
      'overdue',(
        select count(*)
        from public.service_cases c
        where c.organization_id=p_organization_id
          and c.archived_at is null
          and app_private.case_service_read_allowed(
            p_organization_id,c.service_type
          )
          and c.closed_at is null
          and c.estimated_at<now()
      ),
      'resolved_30d',(
        select count(*)
        from public.service_cases c
        where c.organization_id=p_organization_id
          and c.archived_at is null
          and app_private.case_service_read_allowed(
            p_organization_id,c.service_type
          )
          and c.closed_at>=now()-interval '30 days'
      )
    ),
    'handoffs',jsonb_build_object(
      'open',(
        select count(*)
        from public.handoffs h
        left join public.service_cases c
          on c.id=h.case_id and c.organization_id=h.organization_id
        where h.organization_id=p_organization_id
          and h.status in ('open','assigned')
          and (
            c.id is null
            or (
              c.archived_at is null
              and app_private.case_service_read_allowed(
                p_organization_id,c.service_type
              )
            )
          )
      )
    ),
    'assistant',jsonb_build_object(
      'messages_24h',(
        select count(*)
        from public.assistant_messages
        where organization_id=p_organization_id
          and created_at>=now()-interval '24 hours'
      ),
      'conversations_30d',(
        select count(*)
        from public.assistant_conversations
        where organization_id=p_organization_id
          and started_at>=now()-interval '30 days'
      )
    ),
    'performance',jsonb_build_object(
      'requests_24h',(
        select count(*)
        from public.performance_samples
        where organization_id=p_organization_id
          and created_at>=now()-interval '24 hours'
      ),
      'error_rate_24h',coalesce((
        select round(
          100.0*count(*) filter(where status_code>=500)
          /nullif(count(*),0),
          2
        )
        from public.performance_samples
        where organization_id=p_organization_id
          and created_at>=now()-interval '24 hours'
      ),0),
      'avg_latency_ms_24h',coalesce((
        select round(avg(latency_ms))
        from public.performance_samples
        where organization_id=p_organization_id
          and created_at>=now()-interval '24 hours'
      ),0)
    ),
    'by_status',coalesce((
      select jsonb_object_agg(status,amount)
      from (
        select status,count(*) amount
        from public.service_cases c
        where c.organization_id=p_organization_id
          and c.archived_at is null
          and app_private.case_service_read_allowed(
            p_organization_id,c.service_type
          )
        group by status
      ) grouped
    ),'{}'::jsonb),
    'by_kind',coalesce((
      select jsonb_object_agg(kind,amount)
      from (
        select kind,count(*) amount
        from public.service_cases c
        where c.organization_id=p_organization_id
          and c.archived_at is null
          and app_private.case_service_read_allowed(
            p_organization_id,c.service_type
          )
        group by kind
      ) grouped
    ),'{}'::jsonb)
  );
end;
$$;
revoke all on function public.admin_dashboard(uuid) from public,anon;
grant execute on function public.admin_dashboard(uuid) to authenticated;

create or replace function app_private.admin_overview(
  p_organization_id uuid,
  p_days integer default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_days integer := least(greatest(coalesce(p_days,30),1),90);
begin
  if not app_private.is_admin(p_organization_id,null,true) then
    raise exception using errcode='42501',message='admin_access_denied';
  end if;

  return (
    with cases as materialized (
      select
        c.*,
        c.closed_at is null
          and c.status not in (
            'resolved','cancelled','delivered','refunded'
          ) as is_open
      from public.service_cases c
      where c.organization_id=p_organization_id
        and c.archived_at is null
        and app_private.case_service_read_allowed(
          p_organization_id,c.service_type
        )
    ),
    perf as materialized (
      select *
      from public.performance_samples
      where organization_id=p_organization_id
        and created_at>=now()-interval '24 hours'
    )
    select jsonb_build_object(
      'generated_at',now(),
      'period_days',v_days,
      'cases',(
        select jsonb_build_object(
          'total',count(*),
          'open',count(*) filter(where is_open),
          'overdue',count(*) filter(
            where is_open and estimated_at<now()
          ),
          'without_eta',count(*) filter(
            where is_open and estimated_at is null
          ),
          'stale',count(*) filter(
            where is_open
              and coalesce(source_updated_at,updated_at)
                  <now()-interval '3 days'
          ),
          'resolved',count(*) filter(
            where closed_at>=now()-make_interval(days=>v_days)
              and status<>'cancelled'
          ),
          'avg_resolution_hours',round(
            avg(
              extract(epoch from (closed_at-created_at))/3600
            ) filter(
              where closed_at>=now()-make_interval(days=>v_days)
                and closed_at>=created_at
                and status<>'cancelled'
            ),
            1
          )
        )
        from cases
      ),
      'by_status',coalesce((
        select jsonb_object_agg(status,n)
        from (
          select status,count(*) n
          from cases
          group by status
        ) t
      ),'{}'::jsonb),
      'trend',(
        select jsonb_agg(
          jsonb_build_object(
            'day',day::date,
            'opened',opened,
            'closed',closed
          )
          order by day
        )
        from (
          select
            day,
            (
              select count(*)
              from cases
              where created_at>=day
                and created_at<day+interval '1 day'
            ) as opened,
            (
              select count(*)
              from cases
              where closed_at>=day
                and closed_at<day+interval '1 day'
            ) as closed
          from generate_series(
            date_trunc('day',now())
              -make_interval(days=>v_days-1),
            date_trunc('day',now()),
            interval '1 day'
          ) day
        ) t
      ),
      'performance',(
        select jsonb_build_object(
          'requests_24h',count(*),
          'error_rate_24h',round(
            100.0*count(*) filter(where status_code>=500)
            /nullif(count(*),0),
            2
          ),
          'avg_latency_ms_24h',round(avg(latency_ms)),
          'p95_latency_ms_24h',round(
            (
              percentile_cont(0.95)
              within group(order by latency_ms)
            )::numeric
          ),
          'denied_24h',count(*) filter(
            where status_code in (401,403)
          ),
          'rate_limited_24h',count(*) filter(
            where status_code=429
          )
        )
        from perf
      ),
      'routes',coalesce((
        select jsonb_agg(to_jsonb(t))
        from (
          select
            route,
            count(*) requests,
            count(*) filter(where status_code>=500) errors,
            round(avg(latency_ms)) avg_ms
          from perf
          group by route
          order by count(*) desc
          limit 20
        ) t
      ),'[]'::jsonb),
      'documents',(
        select jsonb_build_object(
          'total',count(*),
          'published',count(*) filter(where status='published'),
          'review',count(*) filter(
            where status in ('draft','review')
          ),
          'expired',count(*) filter(
            where status='published'
              and effective_until<current_date
          )
        )
        from public.knowledge_documents
        where organization_id=p_organization_id
      ),
      'assistant',jsonb_build_object(
        'messages_24h',(
          select count(*)
          from public.assistant_messages
          where organization_id=p_organization_id
            and created_at>=now()-interval '24 hours'
        ),
        'conversations',(
          select count(*)
          from public.assistant_conversations
          where organization_id=p_organization_id
            and started_at>=now()-make_interval(days=>v_days)
        )
      ),
      'handoffs',jsonb_build_object(
        'open',(
          select count(*)
          from public.handoffs h
          left join public.service_cases c
            on c.id=h.case_id
            and c.organization_id=h.organization_id
          where h.organization_id=p_organization_id
            and h.status in ('open','assigned')
            and (
              c.id is null
              or (
                c.archived_at is null
                and app_private.case_service_read_allowed(
                  p_organization_id,c.service_type
                )
              )
            )
        ),
        'unassigned',(
          select count(*)
          from public.handoffs h
          left join public.service_cases c
            on c.id=h.case_id
            and c.organization_id=h.organization_id
          where h.organization_id=p_organization_id
            and h.status in ('open','assigned')
            and h.assigned_to is null
            and (
              c.id is null
              or (
                c.archived_at is null
                and app_private.case_service_read_allowed(
                  p_organization_id,c.service_type
                )
              )
            )
        )
      )
    )
  );
end;
$$;
revoke all on function app_private.admin_overview(uuid,integer)
  from public,anon,authenticated;
grant execute on function app_private.admin_overview(uuid,integer)
  to authenticated;

create or replace function public.admin_overview(
  p_organization_id uuid,
  p_days integer default 30
)
returns jsonb
language sql
stable
security invoker
set search_path=''
as $$
  select app_private.admin_overview(
    p_organization_id,p_days
  );
$$;
revoke all on function public.admin_overview(uuid,integer)
  from public,anon;
grant execute on function public.admin_overview(uuid,integer)
  to authenticated;

create or replace function public.admin_queue(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path=''
as $$
begin
  if not app_private.is_admin(
    p_organization_id,
    array['super_admin','sav_manager','sc_manager','adviser'],
    true
  ) then
    raise exception using errcode='42501',message='admin_access_denied';
  end if;

  return jsonb_build_object(
    'priorities',coalesce((
      select jsonb_agg(to_jsonb(t))
      from (
        select
          id,
          reference,
          title,
          status,
          estimated_at,
          updated_at
        from public.service_cases c
        where c.organization_id=p_organization_id
          and c.archived_at is null
          and app_private.case_service_read_allowed(
            p_organization_id,c.service_type
          )
          and c.closed_at is null
          and c.status not in (
            'resolved','cancelled','delivered','refunded'
          )
          and (
            c.estimated_at<now()
            or c.status in ('quote_pending','delayed')
          )
        order by
          c.estimated_at asc nulls last,
          c.updated_at asc,
          c.id
        limit 20
      ) t
    ),'[]'::jsonb),
    'handoffs',coalesce((
      select jsonb_agg(to_jsonb(t))
      from (
        select
          h.id,
          h.case_id,
          c.reference,
          h.summary,
          h.status,
          h.assigned_to,
          h.updated_at,
          h.created_at
        from public.handoffs h
        left join public.service_cases c
          on c.id=h.case_id
          and c.organization_id=h.organization_id
        where h.organization_id=p_organization_id
          and h.status in ('open','assigned')
          and (
            c.id is null
            or (
              c.archived_at is null
              and app_private.case_service_read_allowed(
                p_organization_id,c.service_type
              )
            )
          )
        order by h.created_at,h.id
        limit 30
      ) t
    ),'[]'::jsonb)
  );
end;
$$;
revoke all on function public.admin_queue(uuid) from public,anon;
grant execute on function public.admin_queue(uuid) to authenticated;

comment on column public.service_cases.service_type is
  'Business ownership of the case: SAV or customer service.';
comment on column public.service_cases.archived_at is
  'Soft-delete boundary. Archived cases keep their event and audit history.';
comment on function public.admin_create_case(uuid,jsonb,text) is
  'MFA-gated, role-scoped, idempotent creation. Plaintext access code is returned once and never persisted.';
comment on function public.admin_archive_case(uuid,uuid,integer,text,text) is
  'Audited soft-delete: revokes customer access and preserves business history.';

commit;
