-- Read all export rows in one statement snapshot. OFFSET pages in a volatile
-- auditing function can otherwise shift under concurrent case updates.
create or replace function app_private.admin_export_cases(
  p_organization_id uuid,p_search text,p_service text,p_status text,p_archive text
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_items jsonb; v_total integer;
begin
  if not app_private.is_admin(p_organization_id,array['super_admin','sav_manager','sc_manager','adviser'],true) then
    raise exception using errcode='42501',message='admin_access_denied'; end if;
  if char_length(coalesce(p_search,''))>120 then
    raise exception using errcode='22023',message='invalid_export_query'; end if;
  if nullif(p_service,'') is not null and p_service not in ('sav','customer_service') then
    raise exception using errcode='22023',message='invalid_service_type'; end if;
  if p_archive is null or p_archive not in ('active','archived','all') then
    raise exception using errcode='22023',message='invalid_archive_filter'; end if;

  with selected as (
    select c.id,c.updated_at,jsonb_build_object(
      'id',c.id,'reference',c.reference,'service_type',c.service_type,'kind',c.kind,
      'title',c.title,'status',c.status,'warranty_status',c.warranty_status,
      'product',p.name,'store',s.name,'customer',trim(concat_ws(' ',u.first_name,u.last_name)),
      'estimated_at',c.estimated_at,'updated_at',c.updated_at,'version',c.version,'archived_at',c.archived_at
    ) as row_data
    from public.service_cases c
    left join public.products p on p.id=c.product_id and p.organization_id=c.organization_id
    left join public.stores s on s.id=c.store_id and s.organization_id=c.organization_id
    left join public.customers u on u.id=c.customer_id and u.organization_id=c.organization_id
    where c.organization_id=p_organization_id
      and app_private.case_service_read_allowed(p_organization_id,c.service_type)
      and (nullif(p_service,'') is null or c.service_type=p_service)
      and (nullif(p_status,'') is null or c.status=p_status)
      and (p_archive='all' or (p_archive='active' and c.archived_at is null)
        or (p_archive='archived' and c.archived_at is not null))
      and (coalesce(p_search,'')='' or c.reference ilike '%'||p_search||'%'
        or c.title ilike '%'||p_search||'%' or p.name ilike '%'||p_search||'%'
        or trim(concat_ws(' ',u.first_name,u.last_name)) ilike '%'||p_search||'%')
    order by c.updated_at desc,c.id
    limit 1001
  )
  select coalesce(jsonb_agg(row_data order by updated_at desc,id),'[]'::jsonb),count(*)::integer
    into v_items,v_total from selected;

  if v_total>1000 then raise exception using errcode='22023',message='export_limit_exceeded'; end if;
  if octet_length(v_items::text)>400000 then
    raise exception using errcode='22023',message='export_size_exceeded'; end if;
  insert into public.audit_events(organization_id,actor_user_id,action,entity_type,metadata)
    values(p_organization_id,auth.uid(),'cases.export','service_case',jsonb_build_object('count',v_total,'format','csv'));
  return jsonb_build_object('items',v_items,'total',v_total,'generatedAt',now());
end;
$$;
revoke all on function app_private.admin_export_cases(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function app_private.admin_export_cases(uuid,text,text,text,text) to authenticated;
