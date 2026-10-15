-- Business administration: audited reference data, restoration, bounded batch commands,
-- filtered exports and saved conversation history. Existing MFA/service scopes remain.
begin;

alter table public.customers add column if not exists revision integer not null default 1 check (revision > 0);
alter table public.products add column if not exists revision integer not null default 1 check (revision > 0);
alter table public.stores add column if not exists revision integer not null default 1 check (revision > 0);
-- All reference-data writes must pass the audited, revision-checked RPCs below.
revoke insert,update,delete on public.customers,public.products,public.stores from authenticated;
create index if not exists customers_admin_directory_idx on public.customers(organization_id, updated_at desc, id);
create index if not exists products_admin_directory_idx on public.products(organization_id, updated_at desc, id);
create index if not exists stores_admin_directory_idx on public.stores(organization_id, updated_at desc, id);
create index if not exists stores_admin_search_idx on public.stores using gin
  ((lower(coalesce(code,'')||' '||coalesce(name,'')||' '||coalesce(city,''))) extensions.gin_trgm_ops);
create index if not exists messages_case_history_idx on public.assistant_messages(organization_id, case_id, created_at desc, id);

create table if not exists app_private.admin_business_commands (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id text not null,
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  fingerprint text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, request_id)
);
alter table app_private.admin_business_commands enable row level security;
revoke all on app_private.admin_business_commands from public, anon, authenticated;
create index if not exists admin_business_commands_actor_idx on app_private.admin_business_commands(actor_user_id);

create or replace function app_private.admin_entity_manage_allowed(p_organization_id uuid,p_kind text,p_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select app_private.is_admin(p_organization_id,array['super_admin'],true)
    or (p_kind in ('customer','product')
      and app_private.is_admin(p_organization_id,array['sav_manager','sc_manager'],true)
      and not exists (select 1 from public.service_cases c
        where c.organization_id=p_organization_id
          and ((p_kind='customer' and c.customer_id=p_id) or (p_kind='product' and c.product_id=p_id))
          and not app_private.case_service_manage_allowed(p_organization_id,c.service_type)));
$$;

create or replace function app_private.admin_entity_record(p_organization_id uuid,p_kind text,p_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_row jsonb; v_linked integer;
begin
  if not app_private.is_admin(p_organization_id,array['super_admin','sav_manager','sc_manager'],true) then
    raise exception using errcode='42501',message='admin_access_denied';
  end if;
  if p_kind='customer' then
    select to_jsonb(c) into v_row from public.customers c where c.organization_id=p_organization_id and c.id=p_id;
    select count(*) into v_linked from public.service_cases c where c.organization_id=p_organization_id and c.customer_id=p_id;
  elsif p_kind='product' then
    select to_jsonb(p) into v_row from public.products p where p.organization_id=p_organization_id and p.id=p_id;
    select count(*) into v_linked from public.service_cases c where c.organization_id=p_organization_id and c.product_id=p_id;
  elsif p_kind='store' then
    select to_jsonb(s) into v_row from public.stores s where s.organization_id=p_organization_id and s.id=p_id;
    select count(*) into v_linked from public.service_cases c where c.organization_id=p_organization_id and c.store_id=p_id;
  else raise exception using errcode='22023',message='invalid_entity_kind'; end if;
  if v_row is null then raise exception using errcode='P0002',message='entity_not_found'; end if;
  return jsonb_build_object('id',p_id,'kind',p_kind,'revision',(v_row->>'revision')::integer,
    'updatedAt',v_row->>'updated_at','linkedCases',v_linked,
    'canEdit',app_private.admin_entity_manage_allowed(p_organization_id,p_kind,p_id),
    'data',v_row-array['id','organization_id','revision','created_at','updated_at']);
end;
$$;

create or replace function app_private.admin_entities(p_organization_id uuid,p_kind text,p_search text default '',p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_items jsonb; v_total integer; v_table text; v_query text; v_expression text;
begin
  if not app_private.is_admin(p_organization_id,array['super_admin','sav_manager','sc_manager'],true) then
    raise exception using errcode='42501',message='admin_access_denied'; end if;
  if p_kind not in ('customer','product','store') or p_kind is null or char_length(coalesce(p_search,''))>120
    or p_offset is null or p_offset not between 0 and 100000 then
    raise exception using errcode='22023',message='invalid_entity_query'; end if;
  v_table:=case p_kind when 'customer' then 'customers' when 'product' then 'products' else 'stores' end;
  -- The closed expressions below match the existing trigram indexes exactly.
  v_expression:=case p_kind
    when 'customer' then 'lower(coalesce(external_id,'''')||'' ''||coalesce(first_name,'''')||'' ''||coalesce(last_name,'''')||'' ''||coalesce(email,'''')||'' ''||coalesce(phone,''''))'
    when 'product' then 'lower(coalesce(external_id,'''')||'' ''||coalesce(sku,'''')||'' ''||coalesce(name,'''')||'' ''||coalesce(category,'''')||'' ''||coalesce(serial_number,''''))'
    else 'lower(coalesce(code,'''')||'' ''||coalesce(name,'''')||'' ''||coalesce(city,''''))' end;
  v_query:='%'||replace(replace(replace(lower(trim(coalesce(p_search,''))),'!','!!'),'%','!%'),'_','!_')||'%';
  execute format('select coalesce(jsonb_agg(app_private.admin_entity_record($1,$2,t.id)),''[]''::jsonb)
    from (select id from public.%I r where organization_id=$1
      and ($3='''' or %s like $4 escape ''!'')
      order by updated_at desc,id limit 30 offset $5) t',v_table,v_expression)
    into v_items using p_organization_id,p_kind,trim(coalesce(p_search,'')),v_query,p_offset;
  execute format('select count(*) from public.%I r where organization_id=$1
    and ($2='''' or %s like $3 escape ''!'')',v_table,v_expression)
    into v_total using p_organization_id,trim(coalesce(p_search,'')),v_query;
  return jsonb_build_object('items',v_items,'total',v_total,
    'canCreate',app_private.admin_entity_manage_allowed(p_organization_id,p_kind,null));
end;
$$;

create or replace function app_private.admin_save_entity(p_organization_id uuid,p_kind text,p_id uuid,
  p_expected_revision integer,p_data jsonb,p_request_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_id uuid:=coalesce(p_id,gen_random_uuid()); v_revision integer; v_result jsonb; v_previous app_private.admin_business_commands%rowtype;
  v_fingerprint text; v_key text; v_allowed text[]; v_max integer; v_case record; v_current jsonb;
begin
  if not app_private.is_admin(p_organization_id,array['super_admin','sav_manager','sc_manager'],true) then
    raise exception using errcode='42501',message='admin_access_denied'; end if;
  if p_kind not in ('customer','product','store') or p_kind is null or p_data is null or jsonb_typeof(p_data)<>'object'
    or p_expected_revision is null or p_expected_revision<0 or p_request_id is null
    or p_request_id !~ '^[a-zA-Z0-9-]{16,80}$' or octet_length(p_data::text)>8000 then
    raise exception using errcode='22023',message='invalid_entity_command'; end if;
  v_fingerprint:=md5(auth.uid()::text||jsonb_build_object('kind',p_kind,'id',p_id,'revision',p_expected_revision,'data',p_data)::text);
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||p_request_id,0));
  select * into v_previous from app_private.admin_business_commands where organization_id=p_organization_id and request_id=p_request_id;
  if v_previous.request_id is not null then
    if v_previous.fingerprint<>v_fingerprint or v_previous.actor_user_id<>auth.uid() then
      raise exception using errcode='40001',message='request_conflict'; end if;
    return v_previous.response;
  end if;
  if p_kind='customer' then
    v_allowed:=array['external_id','first_name','last_name','email','phone'];
    if p_id is not null then select revision into v_revision from public.customers where organization_id=p_organization_id and id=p_id for update; end if;
  elsif p_kind='product' then
    v_allowed:=array['external_id','name','sku','category','serial_number'];
    if p_id is not null then select revision into v_revision from public.products where organization_id=p_organization_id and id=p_id for update; end if;
  else
    v_allowed:=array['code','name','city','address','active'];
    if p_id is not null then select revision into v_revision from public.stores where organization_id=p_organization_id and id=p_id for update; end if;
  end if;
  if not (p_data ?& v_allowed) then raise exception using errcode='22023',message='missing_entity_fields'; end if;
  if p_id is not null and v_revision is null then raise exception using errcode='P0002',message='entity_not_found'; end if;
  if not app_private.admin_entity_manage_allowed(p_organization_id,p_kind,p_id) then
    raise exception using errcode='42501',message='shared_entity_role_denied'; end if;
  if (p_id is null and p_expected_revision<>0) or (p_id is not null and p_expected_revision<>v_revision) then
    raise exception using errcode='40001',message='version_conflict'; end if;
  for v_key in select jsonb_object_keys(p_data) loop
    if not v_key=any(v_allowed) then raise exception using errcode='22023',message='unknown_entity_field'; end if;
    if v_key='active' then
      if jsonb_typeof(p_data->v_key)<>'boolean' then raise exception using errcode='22023',message='invalid_active'; end if;
    else
      v_max:=case v_key when 'email' then 320 when 'phone' then 80 when 'code' then 80 when 'name' then 240 when 'sku' then 120 when 'address' then 1000 else 160 end;
      if jsonb_typeof(p_data->v_key) not in ('string','null') or char_length(coalesce(p_data->>v_key,''))>v_max then
        raise exception using errcode='22023',message='invalid_entity_field'; end if;
    end if;
  end loop;
  if p_kind='customer' then
    if trim(concat_ws('',p_data->>'first_name',p_data->>'last_name',p_data->>'email',p_data->>'phone',p_data->>'external_id'))='' then
      raise exception using errcode='22023',message='empty_customer'; end if;
    if nullif(trim(p_data->>'email'),'') is not null and p_data->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
      raise exception using errcode='22023',message='invalid_email'; end if;
    if p_id is null then
      insert into public.customers(id,organization_id,external_id,first_name,last_name,email,phone)
        values(v_id,p_organization_id,nullif(trim(p_data->>'external_id'),''),nullif(trim(p_data->>'first_name'),''),
          nullif(trim(p_data->>'last_name'),''),nullif(trim(p_data->>'email'),''),nullif(trim(p_data->>'phone'),''));
    else
      update public.customers set external_id=nullif(trim(p_data->>'external_id'),''),first_name=nullif(trim(p_data->>'first_name'),''),
        last_name=nullif(trim(p_data->>'last_name'),''),email=nullif(trim(p_data->>'email'),''),phone=nullif(trim(p_data->>'phone'),''),revision=revision+1
        where id=v_id and organization_id=p_organization_id;
    end if;
  elsif p_kind='product' then
    if coalesce(trim(p_data->>'name'),'')='' then raise exception using errcode='22023',message='product_name_required'; end if;
    if p_id is null then
      insert into public.products(id,organization_id,external_id,name,sku,category,serial_number) values
        (v_id,p_organization_id,nullif(trim(p_data->>'external_id'),''),trim(p_data->>'name'),nullif(trim(p_data->>'sku'),''),
          nullif(trim(p_data->>'category'),''),nullif(trim(p_data->>'serial_number'),''));
    else
      update public.products set external_id=nullif(trim(p_data->>'external_id'),''),name=trim(p_data->>'name'),sku=nullif(trim(p_data->>'sku'),''),
        category=nullif(trim(p_data->>'category'),''),serial_number=nullif(trim(p_data->>'serial_number'),''),revision=revision+1
        where id=v_id and organization_id=p_organization_id;
    end if;
  else
    if coalesce(trim(p_data->>'code'),'')='' or char_length(coalesce(trim(p_data->>'name'),''))<2 or not p_data ? 'active' then
      raise exception using errcode='22023',message='store_fields_required'; end if;
    if not (p_data->>'active')::boolean and exists(select 1 from public.service_cases where organization_id=p_organization_id
      and store_id=v_id and archived_at is null) then
      raise exception using errcode='22023',message='store_has_open_cases'; end if;
    if p_id is null then
      insert into public.stores(id,organization_id,code,name,city,address,active) values(v_id,p_organization_id,trim(p_data->>'code'),
        trim(p_data->>'name'),nullif(trim(p_data->>'city'),''),nullif(trim(p_data->>'address'),''),(p_data->>'active')::boolean);
    else
      update public.stores set code=trim(p_data->>'code'),name=trim(p_data->>'name'),city=nullif(trim(p_data->>'city'),''),
        address=nullif(trim(p_data->>'address'),''),active=(p_data->>'active')::boolean,revision=revision+1
        where id=v_id and organization_id=p_organization_id;
    end if;
  end if;
  -- A corrected customer/product is a new version of the facts for every active linked case.
  if p_id is not null and p_kind in ('customer','product') then
    for v_case in select id,status from public.service_cases where organization_id=p_organization_id and archived_at is null
      and ((p_kind='customer' and customer_id=v_id) or (p_kind='product' and product_id=v_id)) order by id for update loop
      update public.service_cases set version=version+1,source_updated_at=now() where id=v_case.id;
      insert into public.case_events(organization_id,case_id,status,label,details,customer_visible,source,actor_user_id)
        values(p_organization_id,v_case.id,v_case.status,'Fiche métier corrigée',jsonb_build_object('entity_type',p_kind,'entity_id',v_id),false,'admin',auth.uid());
    end loop;
  end if;
  v_result:=app_private.admin_entity_record(p_organization_id,p_kind,v_id);
  insert into public.audit_events(organization_id,actor_user_id,action,entity_type,entity_id,request_id,metadata)
    values(p_organization_id,auth.uid(),'entity.'||case when p_id is null then 'create' else 'update' end,p_kind,v_id,p_request_id,
      jsonb_build_object('revision',v_result->'revision','fields',to_jsonb(v_allowed)));
  insert into app_private.admin_business_commands(organization_id,request_id,actor_user_id,fingerprint,response)
    values(p_organization_id,p_request_id,auth.uid(),v_fingerprint,v_result);
  return v_result;
exception when unique_violation then raise exception using errcode='22023',message='entity_reference_already_exists';
end;
$$;

-- A reassigned customer must never inherit the previous customer's code/session.
create or replace function app_private.secure_case_reference_change()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' and new.customer_id is distinct from old.customer_id then
    update public.case_access_codes set revoked_at=coalesce(revoked_at,now()) where organization_id=new.organization_id and case_id=new.id;
    update public.case_sessions set revoked_at=coalesce(revoked_at,now()) where organization_id=new.organization_id and case_id=new.id;
  end if;
  if new.store_id is not null and (tg_op='INSERT' or new.store_id is distinct from old.store_id) then
    perform id from public.stores where id=new.store_id and organization_id=new.organization_id and active for share;
    if not found then raise exception using errcode='22023',message='inactive_store'; end if;
  end if;
  return new;
end;
$$;
revoke all on function app_private.secure_case_reference_change() from public,anon,authenticated;
create trigger cases_secure_reference_change before insert or update of customer_id,store_id on public.service_cases
  for each row execute function app_private.secure_case_reference_change();

create or replace function app_private.admin_restore_case(p_organization_id uuid,p_case_id uuid,p_expected_version integer,p_reason text,p_request_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.service_cases%rowtype; v_result jsonb; v_previous public.case_commands%rowtype; v_fingerprint text;
begin
  if p_request_id is null or p_request_id !~ '^[a-zA-Z0-9-]{16,80}$' or p_reason is null or char_length(trim(p_reason)) not between 3 and 1000 then
    raise exception using errcode='22023',message='invalid_restore'; end if;
  select * into c from public.service_cases where organization_id=p_organization_id and id=p_case_id for update;
  if not app_private.case_service_manage_allowed(p_organization_id,c.service_type) then
    raise exception using errcode='42501',message='admin_access_denied'; end if;
  if c.id is null then raise exception using errcode='P0002',message='case_not_found'; end if;
  v_fingerprint:=md5(auth.uid()::text||p_case_id::text||trim(p_reason));
  select * into v_previous from public.case_commands where organization_id=p_organization_id and request_id=p_request_id;
  if v_previous.id is not null then
    if v_previous.action<>'admin.case.restore' or v_previous.response->>'fingerprint'<>v_fingerprint then
      raise exception using errcode='40001',message='request_conflict'; end if;
    return v_previous.response-'fingerprint';
  end if;
  if c.version is distinct from p_expected_version then raise exception using errcode='40001',message='version_conflict'; end if;
  if c.archived_at is null then raise exception using errcode='22023',message='case_not_archived'; end if;
  if c.store_id is not null then
    perform id from public.stores where organization_id=p_organization_id and id=c.store_id and active for share;
    if not found then raise exception using errcode='22023',message='restore_store_inactive'; end if;
  end if;
  update public.service_cases set archived_at=null,archive_reason=null,version=version+1,source_updated_at=now() where id=c.id;
  insert into public.case_events(organization_id,case_id,status,label,details,customer_visible,source,actor_user_id)
    values(p_organization_id,c.id,c.status,'Dossier restauré',jsonb_build_object('detail',trim(p_reason)),false,'admin',auth.uid());
  insert into public.audit_events(organization_id,actor_user_id,action,entity_type,entity_id,request_id,metadata)
    values(p_organization_id,auth.uid(),'case.restore','service_case',c.id,p_request_id,jsonb_build_object('from_version',c.version,'to_version',c.version+1));
  v_result:=jsonb_build_object('ok',true,'id',c.id,'reference',c.reference,'version',c.version+1);
  insert into public.case_commands(organization_id,case_id,request_id,action,status,response)
    values(p_organization_id,c.id,p_request_id,'admin.case.restore','completed',v_result||jsonb_build_object('fingerprint',v_fingerprint));
  -- Deliberately retain all previous code/session revocations. A fresh code is required.
  return v_result;
end;
$$;

create or replace function app_private.admin_batch_cases(p_organization_id uuid,p_items jsonb,p_action text,p_payload jsonb,p_request_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_item jsonb; c public.service_cases%rowtype; v_result jsonb; v_results jsonb:='[]'::jsonb;
  v_previous app_private.admin_business_commands%rowtype; v_fingerprint text; v_child text; v_id uuid;
begin
  if not app_private.is_admin(p_organization_id,array['super_admin','sav_manager','sc_manager'],true) then
    raise exception using errcode='42501',message='admin_access_denied'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 25
    or p_action not in ('transition','note','deadline') or p_action is null or p_payload is null
    or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>18000
    or p_request_id is null or p_request_id !~ '^[a-zA-Z0-9-]{16,80}$' then
    raise exception using errcode='22023',message='invalid_batch'; end if;
  if (select count(distinct x->>'id') from jsonb_array_elements(p_items) x)<>jsonb_array_length(p_items) then
    raise exception using errcode='22023',message='duplicate_batch_case'; end if;
  v_fingerprint:=md5(auth.uid()::text||jsonb_build_object('items',p_items,'action',p_action,'payload',p_payload)::text);
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||p_request_id,0));
  select * into v_previous from app_private.admin_business_commands where organization_id=p_organization_id and request_id=p_request_id;
  if v_previous.request_id is not null then
    if v_previous.fingerprint<>v_fingerprint or v_previous.actor_user_id<>auth.uid() then raise exception using errcode='40001',message='request_conflict'; end if;
    return v_previous.response;
  end if;
  if exists(select 1 from jsonb_array_elements(p_items) x where jsonb_typeof(x)<>'object'
      or not (x ?& array['id','version']) or x->>'id' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      or coalesce(x->>'version','') !~ '^[1-9][0-9]{0,8}$') then
    raise exception using errcode='22023',message='invalid_batch_item'; end if;
  -- Acquire case locks in the same order for every batch. Any failure rolls the whole command back.
  for v_item in select x from jsonb_array_elements(p_items) x order by x->>'id' loop
    v_id:=(v_item->>'id')::uuid;
    select * into c from public.service_cases where organization_id=p_organization_id and id=v_id for update;
    if c.id is null then raise exception using errcode='P0002',message='case_not_found'; end if;
    if not app_private.case_service_manage_allowed(p_organization_id,c.service_type) then raise exception using errcode='42501',message='admin_access_denied'; end if;
    if c.archived_at is not null then raise exception using errcode='22023',message='case_archived'; end if;
    if c.version is distinct from (v_item->>'version')::integer then raise exception using errcode='40001',message='version_conflict'; end if;
  end loop;
  for v_item in select x from jsonb_array_elements(p_items) x order by x->>'id' loop
    v_id:=(v_item->>'id')::uuid; v_child:='batch-'||md5(p_request_id||v_id::text);
    if p_action='transition' then
      v_result:=public.admin_transition_case(p_organization_id,v_id,(v_item->>'version')::integer,p_payload->>'status',
        coalesce(p_payload->>'note',''),coalesce((p_payload->>'visible')::boolean,false),v_child);
    elsif p_action='note' then
      v_result:=public.admin_add_note(p_organization_id,v_id,(v_item->>'version')::integer,p_payload->>'note',coalesce((p_payload->>'visible')::boolean,false),v_child);
    else
      if not p_payload ? 'estimatedAt' then raise exception using errcode='22023',message='missing_deadline'; end if;
      select * into c from public.service_cases where id=v_id and organization_id=p_organization_id;
      v_result:=public.admin_update_case(p_organization_id,v_id,c.version,jsonb_build_object(
        'title',c.title,'description',c.description,'customer_id',c.customer_id,'product_id',c.product_id,'store_id',c.store_id,
        'warranty_status',c.warranty_status,'warranty_label',c.warranty_label,'quote_cents',c.quote_cents,'refund_cents',c.refund_cents,
        'currency',c.currency,'delivery_mode',c.delivery_mode,'estimated_at',p_payload->'estimatedAt'),v_child);
    end if;
    v_results:=v_results||jsonb_build_array(jsonb_build_object('id',v_id,'version',v_result->'version'));
  end loop;
  v_result:=jsonb_build_object('ok',true,'count',jsonb_array_length(p_items),'items',v_results);
  insert into app_private.admin_business_commands(organization_id,request_id,actor_user_id,fingerprint,response)
    values(p_organization_id,p_request_id,auth.uid(),v_fingerprint,v_result);
  return v_result;
end;
$$;

create or replace function app_private.admin_export_cases(p_organization_id uuid,p_search text,p_service text,p_status text,p_archive text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_page jsonb; v_items jsonb:='[]'::jsonb; v_offset integer:=0; v_total integer;
begin
  if not app_private.is_admin(p_organization_id,array['super_admin','sav_manager','sc_manager','adviser'],true) then
    raise exception using errcode='42501',message='admin_access_denied'; end if;
  if char_length(coalesce(p_search,''))>120 then raise exception using errcode='22023',message='invalid_export_query'; end if;
  loop
    v_page:=public.admin_list_cases_v2(p_organization_id,100,v_offset,p_search,nullif(p_status,''),null,nullif(p_service,''),p_archive);
    v_total:=(v_page->>'total')::integer;
    if v_total>1000 then raise exception using errcode='22023',message='export_limit_exceeded'; end if;
    v_items:=v_items||(v_page->'items'); v_offset:=v_offset+100;
    if octet_length(v_items::text)>400000 then raise exception using errcode='22023',message='export_size_exceeded'; end if;
    exit when v_offset>=v_total or jsonb_array_length(v_page->'items')=0;
  end loop;
  insert into public.audit_events(organization_id,actor_user_id,action,entity_type,metadata)
    values(p_organization_id,auth.uid(),'cases.export','service_case',jsonb_build_object('count',jsonb_array_length(v_items),'format','csv'));
  return jsonb_build_object('items',v_items,'total',v_total,'generatedAt',now());
end;
$$;

create or replace function app_private.admin_case_messages(p_organization_id uuid,p_case_id uuid,p_before_time timestamptz default null,p_before_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_items jsonb; v_next jsonb; v_more boolean;
begin
  if not app_private.case_id_read_allowed(p_organization_id,p_case_id) then raise exception using errcode='42501',message='admin_access_denied'; end if;
  if (p_before_time is null)<>(p_before_id is null) then raise exception using errcode='22023',message='invalid_message_cursor'; end if;
  with selected as (
    select id,role,content,created_at,conversation_id from public.assistant_messages m
    where m.organization_id=p_organization_id and m.case_id=p_case_id and m.role in ('user','assistant')
      and (p_before_time is null or (m.created_at,m.id)<(p_before_time,p_before_id))
    order by m.created_at desc,m.id desc limit 51
  ), page as (select * from selected order by created_at desc,id desc limit 50)
  select coalesce((select jsonb_agg(jsonb_build_object('id',id,'role',role,'content',content,'createdAt',created_at,'conversationId',conversation_id)
    order by created_at,id) from page),'[]'::jsonb),
    (select count(*)>50 from selected),
    (select jsonb_build_object('createdAt',created_at,'id',id) from page order by created_at,id limit 1)
    into v_items,v_more,v_next;
  return jsonb_build_object('items',v_items,'hasMore',v_more,'nextCursor',case when v_more then v_next else null end);
end;
$$;

revoke all on function app_private.admin_entity_manage_allowed(uuid,text,uuid) from public,anon,authenticated;
grant execute on function app_private.admin_entity_manage_allowed(uuid,text,uuid) to authenticated;

revoke all on function app_private.admin_entity_record(uuid,text,uuid) from public,anon,authenticated;
grant execute on function app_private.admin_entity_record(uuid,text,uuid) to authenticated;
create or replace function public.admin_entity_record(p_organization_id uuid,p_kind text,p_id uuid) returns jsonb language sql security invoker set search_path='' as $$
 select app_private.admin_entity_record(p_organization_id,p_kind,p_id);
$$;
revoke all on function public.admin_entity_record(uuid,text,uuid) from public,anon;
grant execute on function public.admin_entity_record(uuid,text,uuid) to authenticated;

revoke all on function app_private.admin_entities(uuid,text,text,integer) from public,anon,authenticated;
grant execute on function app_private.admin_entities(uuid,text,text,integer) to authenticated;
create or replace function public.admin_entities(p_organization_id uuid,p_kind text,p_search text default '',p_offset integer default 0) returns jsonb language sql security invoker set search_path='' as $$
 select app_private.admin_entities(p_organization_id,p_kind,p_search,p_offset);
$$;
revoke all on function public.admin_entities(uuid,text,text,integer) from public,anon;
grant execute on function public.admin_entities(uuid,text,text,integer) to authenticated;

revoke all on function app_private.admin_save_entity(uuid,text,uuid,integer,jsonb,text) from public,anon,authenticated;
grant execute on function app_private.admin_save_entity(uuid,text,uuid,integer,jsonb,text) to authenticated;
create or replace function public.admin_save_entity(p_organization_id uuid,p_kind text,p_id uuid,p_expected_revision integer,p_data jsonb,p_request_id text) returns jsonb language sql security invoker set search_path='' as $$
 select app_private.admin_save_entity(p_organization_id,p_kind,p_id,p_expected_revision,p_data,p_request_id);
$$;
revoke all on function public.admin_save_entity(uuid,text,uuid,integer,jsonb,text) from public,anon;
grant execute on function public.admin_save_entity(uuid,text,uuid,integer,jsonb,text) to authenticated;

revoke all on function app_private.admin_restore_case(uuid,uuid,integer,text,text) from public,anon,authenticated;
grant execute on function app_private.admin_restore_case(uuid,uuid,integer,text,text) to authenticated;
create or replace function public.admin_restore_case(p_organization_id uuid,p_case_id uuid,p_expected_version integer,p_reason text,p_request_id text) returns jsonb language sql security invoker set search_path='' as $$
 select app_private.admin_restore_case(p_organization_id,p_case_id,p_expected_version,p_reason,p_request_id);
$$;
revoke all on function public.admin_restore_case(uuid,uuid,integer,text,text) from public,anon;
grant execute on function public.admin_restore_case(uuid,uuid,integer,text,text) to authenticated;

revoke all on function app_private.admin_batch_cases(uuid,jsonb,text,jsonb,text) from public,anon,authenticated;
grant execute on function app_private.admin_batch_cases(uuid,jsonb,text,jsonb,text) to authenticated;
create or replace function public.admin_batch_cases(p_organization_id uuid,p_items jsonb,p_action text,p_payload jsonb,p_request_id text) returns jsonb language sql security invoker set search_path='' as $$
 select app_private.admin_batch_cases(p_organization_id,p_items,p_action,p_payload,p_request_id);
$$;
revoke all on function public.admin_batch_cases(uuid,jsonb,text,jsonb,text) from public,anon;
grant execute on function public.admin_batch_cases(uuid,jsonb,text,jsonb,text) to authenticated;

revoke all on function app_private.admin_export_cases(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function app_private.admin_export_cases(uuid,text,text,text,text) to authenticated;
create or replace function public.admin_export_cases(p_organization_id uuid,p_search text,p_service text,p_status text,p_archive text) returns jsonb language sql security invoker set search_path='' as $$
 select app_private.admin_export_cases(p_organization_id,p_search,p_service,p_status,p_archive);
$$;
revoke all on function public.admin_export_cases(uuid,text,text,text,text) from public,anon;
grant execute on function public.admin_export_cases(uuid,text,text,text,text) to authenticated;

revoke all on function app_private.admin_case_messages(uuid,uuid,timestamptz,uuid) from public,anon,authenticated;
grant execute on function app_private.admin_case_messages(uuid,uuid,timestamptz,uuid) to authenticated;
create or replace function public.admin_case_messages(p_organization_id uuid,p_case_id uuid,p_before_time timestamptz default null,p_before_id uuid default null) returns jsonb language sql security invoker set search_path='' as $$
 select app_private.admin_case_messages(p_organization_id,p_case_id,p_before_time,p_before_id);
$$;
revoke all on function public.admin_case_messages(uuid,uuid,timestamptz,uuid) from public,anon;
grant execute on function public.admin_case_messages(uuid,uuid,timestamptz,uuid) to authenticated;

commit;
