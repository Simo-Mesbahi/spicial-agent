begin;

-- Authorization always checks current membership, organization and server session.
create or replace function app_private.is_admin(p_organization_id uuid, p_roles text[] default null, p_require_mfa boolean default true)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.admin_memberships m
    join public.organizations o on o.id = m.organization_id and o.active
    join auth.sessions s on s.user_id = m.user_id and s.id::text = (select auth.jwt())->>'session_id'
    where m.organization_id = p_organization_id and m.user_id = (select auth.uid()) and m.active
      and (s.not_after is null or s.not_after > now())
      and (p_roles is null or m.role = any(p_roles))
      and (not p_require_mfa or (select auth.jwt())->>'aal' = 'aal2')
  );
$$;

-- Only the caller's own onboarding identity is visible before MFA.
-- All business data remains inaccessible at AAL1.
create or replace function app_private.admin_identity()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  return jsonb_build_object('user_id', (select auth.uid()), 'email', (select auth.jwt())->>'email',
    'aal', coalesce((select auth.jwt())->>'aal', 'aal1'),
    'memberships', coalesce((
      select jsonb_agg(jsonb_build_object('organization_id', o.id, 'organization_name', o.name,
        'role', m.role, 'display_name', m.display_name) order by o.name)
      from public.admin_memberships m join public.organizations o on o.id=m.organization_id
      where m.user_id=(select auth.uid()) and app_private.is_admin(o.id, null, false)
    ), '[]'::jsonb));
end;
$$;
revoke all on function app_private.admin_identity() from public, anon, authenticated;
grant execute on function app_private.admin_identity() to authenticated;
create or replace function public.admin_me()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select app_private.admin_identity();
$$;

create or replace function app_private.admin_overview(p_organization_id uuid, p_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_days integer := least(greatest(coalesce(p_days,30),1),90);
begin
  if not app_private.is_admin(p_organization_id, null, true) then
    raise exception using errcode='42501', message='admin_access_denied';
  end if;
  return (
    with cases as materialized (
      select c.*, c.closed_at is null and c.status not in ('resolved','cancelled','delivered','refunded') as is_open
      from public.service_cases c where c.organization_id=p_organization_id
    ), perf as materialized (
      select * from public.performance_samples
      where organization_id=p_organization_id and created_at >= now()-interval '24 hours'
    )
    select jsonb_build_object(
      'generated_at', now(), 'period_days', v_days,
      'cases', (select jsonb_build_object('total',count(*),'open',count(*) filter(where is_open),
        'overdue',count(*) filter(where is_open and estimated_at<now()),
        'without_eta',count(*) filter(where is_open and estimated_at is null),
        'stale',count(*) filter(where is_open and coalesce(source_updated_at,updated_at)<now()-interval '3 days'),
        'resolved',count(*) filter(where closed_at>=now()-make_interval(days=>v_days) and status<>'cancelled'),
        'avg_resolution_hours',round(avg(extract(epoch from (closed_at-created_at))/3600)
          filter(where closed_at>=now()-make_interval(days=>v_days) and closed_at>=created_at and status<>'cancelled'),1)
      ) from cases),
      'by_status',coalesce((select jsonb_object_agg(status,n) from (select status,count(*) n from cases group by status) t),'{}'::jsonb),
      'trend', (select jsonb_agg(jsonb_build_object('day',day::date,'opened',opened,'closed',closed) order by day)
        from (select day,
          (select count(*) from cases where created_at>=day and created_at<day+interval '1 day') as opened,
          (select count(*) from cases where closed_at>=day and closed_at<day+interval '1 day') as closed
          from generate_series(date_trunc('day',now())-make_interval(days=>v_days-1),date_trunc('day',now()),interval '1 day') day) t),
      'performance',(select jsonb_build_object('requests_24h',count(*),
        'error_rate_24h',round(100.0*count(*) filter(where status_code>=500)/nullif(count(*),0),2),
        'avg_latency_ms_24h',round(avg(latency_ms)),
        'p95_latency_ms_24h',round((percentile_cont(0.95) within group(order by latency_ms))::numeric),
        'denied_24h',count(*) filter(where status_code in (401,403)),
        'rate_limited_24h',count(*) filter(where status_code=429)) from perf),
      'routes',coalesce((select jsonb_agg(to_jsonb(t)) from (
        select route,count(*) requests,count(*) filter(where status_code>=500) errors,
          round(avg(latency_ms)) avg_ms from perf group by route order by count(*) desc limit 20) t),'[]'::jsonb),
      'documents',(select jsonb_build_object('total',count(*),
        'published',count(*) filter(where status='published'),
        'review',count(*) filter(where status in ('draft','review')),
        'expired',count(*) filter(where status='published' and effective_until<current_date))
        from public.knowledge_documents where organization_id=p_organization_id),
      'assistant',jsonb_build_object(
        'messages_24h',(select count(*) from public.assistant_messages where organization_id=p_organization_id and created_at>=now()-interval '24 hours'),
        'conversations',(select count(*) from public.assistant_conversations where organization_id=p_organization_id and started_at>=now()-make_interval(days=>v_days))),
      'handoffs',jsonb_build_object(
        'open',(select count(*) from public.handoffs where organization_id=p_organization_id and status in ('open','assigned')),
        'unassigned',(select count(*) from public.handoffs where organization_id=p_organization_id and status in ('open','assigned') and assigned_to is null))
    )
  );
end;
$$;
revoke all on function app_private.admin_overview(uuid,integer) from public,anon,authenticated;
grant execute on function app_private.admin_overview(uuid,integer) to authenticated;
create or replace function public.admin_overview(p_organization_id uuid,p_days integer default 30)
returns jsonb language sql stable security invoker set search_path='' as $$
  select app_private.admin_overview(p_organization_id,p_days);
$$;
revoke all on function public.admin_overview(uuid,integer) from public,anon;
grant execute on function public.admin_overview(uuid,integer) to authenticated;

create or replace function public.admin_case_detail(p_organization_id uuid,p_case_id uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
  if not app_private.is_admin(p_organization_id,array['super_admin','sav_manager','sc_manager','adviser'],true) then
    raise exception using errcode='42501',message='admin_access_denied';
  end if;
  return (select jsonb_build_object(
    'id',c.id,'reference',c.reference,'title',c.title,'description',c.description,
    'kind',c.kind,'status',c.status,'version',c.version,'updated_at',c.updated_at,
    'estimated_at',c.estimated_at,'created_at',c.created_at,'closed_at',c.closed_at,
    'source_system',c.source_system,'source_updated_at',c.source_updated_at,
    'warranty_label',c.warranty_label,'quote_cents',c.quote_cents,'refund_cents',c.refund_cents,'currency',c.currency,
    'product',p.name,'store',s.name,'customer',trim(concat_ws(' ',u.first_name,u.last_name)),
    'events',coalesce((select jsonb_agg(to_jsonb(e)) from (
      select id,label,details->>'detail' detail,customer_visible,occurred_at,source
      from public.case_events where organization_id=p_organization_id and case_id=c.id
      order by occurred_at desc,id desc limit 100) e),'[]'::jsonb)
    ) from public.service_cases c
    left join public.products p on p.id=c.product_id and p.organization_id=c.organization_id
    left join public.stores s on s.id=c.store_id and s.organization_id=c.organization_id
    left join public.customers u on u.id=c.customer_id and u.organization_id=c.organization_id
    where c.organization_id=p_organization_id and c.id=p_case_id);
end;
$$;
revoke all on function public.admin_case_detail(uuid,uuid) from public,anon;
grant execute on function public.admin_case_detail(uuid,uuid) to authenticated;

create or replace function public.admin_queue(p_organization_id uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
  if not app_private.is_admin(p_organization_id,array['super_admin','sav_manager','sc_manager','adviser'],true) then
    raise exception using errcode='42501',message='admin_access_denied';
  end if;
  return jsonb_build_object(
    'priorities',coalesce((select jsonb_agg(to_jsonb(t)) from (
      select id,reference,title,status,estimated_at,updated_at from public.service_cases
      where organization_id=p_organization_id and closed_at is null
        and status not in ('resolved','cancelled','delivered','refunded')
        and (estimated_at<now() or status in ('quote_pending','delayed'))
      order by estimated_at asc nulls last,updated_at asc,id limit 20) t),'[]'::jsonb),
    'handoffs',coalesce((select jsonb_agg(to_jsonb(t)) from (
      select h.id,h.case_id,c.reference,h.summary,h.status,h.assigned_to,h.updated_at,h.created_at
      from public.handoffs h left join public.service_cases c on c.id=h.case_id and c.organization_id=h.organization_id
      where h.organization_id=p_organization_id and h.status in ('open','assigned')
      order by h.created_at,h.id limit 30) t),'[]'::jsonb));
end;
$$;
revoke all on function public.admin_queue(uuid) from public,anon;
grant execute on function public.admin_queue(uuid) to authenticated;

-- Operations are atomic and idempotent. Raw table writes cannot bypass the audit.
revoke insert,update on public.service_cases from authenticated;
revoke insert on public.case_events,public.audit_events from authenticated;
revoke insert,update on public.handoffs from authenticated;
grant select on public.audit_events to authenticated;

create or replace function app_private.admin_add_note(
  p_organization_id uuid,p_case_id uuid,p_version integer,p_note text,p_visible boolean,p_request_id text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.service_cases%rowtype; previous public.case_commands%rowtype;
  event_id uuid; fingerprint text; result jsonb;
begin
  if not app_private.is_admin(p_organization_id,array['super_admin','sav_manager','sc_manager','adviser'],true) then
    raise exception using errcode='42501',message='admin_access_denied';
  end if;
  if p_note is null or char_length(trim(p_note)) not between 3 and 4000 or p_visible is null
    or p_version is null or p_request_id is null or p_request_id !~ '^[a-zA-Z0-9-]{16,80}$' then
    raise exception using errcode='22023',message='invalid_note';
  end if;
  select * into c from public.service_cases where id=p_case_id and organization_id=p_organization_id for update;
  if c.id is null then raise exception using errcode='P0002',message='case_not_found'; end if;
  fingerprint:=encode(extensions.digest(concat_ws('|',auth.uid()::text,p_case_id::text,p_visible::text,trim(p_note)),'sha256'),'hex');
  select * into previous from public.case_commands where organization_id=p_organization_id and request_id=p_request_id;
  if previous.id is not null then
    if previous.action<>'admin.note' or previous.response->>'fingerprint' is distinct from fingerprint then
      raise exception using errcode='40001',message='request_conflict';
    end if;
    return previous.response-'fingerprint';
  end if;
  if c.version<>p_version then raise exception using errcode='40001',message='version_conflict'; end if;
  insert into public.case_events(organization_id,case_id,status,label,details,customer_visible,source,actor_user_id)
    values(p_organization_id,p_case_id,c.status,
      case when p_visible then 'Message de votre conseiller' else 'Note interne' end,
      jsonb_build_object('detail',trim(p_note)),p_visible,'admin',auth.uid()) returning id into event_id;
  update public.service_cases set version=version+1 where id=p_case_id;
  insert into public.audit_events(organization_id,actor_user_id,action,entity_type,entity_id,request_id,metadata)
    values(p_organization_id,auth.uid(),'case.note','service_case',p_case_id,p_request_id,
      jsonb_build_object('customer_visible',p_visible,'event_id',event_id));
  result:=jsonb_build_object('ok',true,'version',c.version+1,'event_id',event_id);
  insert into public.case_commands(organization_id,case_id,request_id,action,status,response)
    values(p_organization_id,p_case_id,p_request_id,'admin.note','completed',result||jsonb_build_object('fingerprint',fingerprint));
  return result;
end;
$$;
revoke all on function app_private.admin_add_note(uuid,uuid,integer,text,boolean,text) from public,anon,authenticated;
grant execute on function app_private.admin_add_note(uuid,uuid,integer,text,boolean,text) to authenticated;
create or replace function public.admin_add_note(
  p_organization_id uuid,p_case_id uuid,p_version integer,p_note text,p_visible boolean,p_request_id text
) returns jsonb language sql security invoker set search_path='' as $$
  select app_private.admin_add_note(p_organization_id,p_case_id,p_version,p_note,p_visible,p_request_id);
$$;
revoke all on function public.admin_add_note(uuid,uuid,integer,text,boolean,text) from public,anon;
grant execute on function public.admin_add_note(uuid,uuid,integer,text,boolean,text) to authenticated;

create or replace function app_private.admin_manage_handoff(
  p_organization_id uuid,p_handoff_id uuid,p_status text,p_expected_updated_at timestamptz
) returns jsonb language plpgsql security definer set search_path='' as $$
declare h public.handoffs%rowtype;
begin
  if not app_private.is_admin(p_organization_id,array['super_admin','sav_manager','sc_manager','adviser'],true) then
    raise exception using errcode='42501',message='admin_access_denied';
  end if;
  if p_status is null or p_status not in ('assigned','resolved') or p_expected_updated_at is null then
    raise exception using errcode='22023',message='invalid_status';
  end if;
  select * into h from public.handoffs where id=p_handoff_id and organization_id=p_organization_id for update;
  if h.id is null then raise exception using errcode='P0002',message='handoff_not_found'; end if;
  if h.updated_at<>p_expected_updated_at then raise exception using errcode='40001',message='version_conflict'; end if;
  if h.status not in ('open','assigned') then raise exception using errcode='40001',message='handoff_closed'; end if;
  if h.assigned_to is not null and h.assigned_to<>auth.uid()
     and not app_private.is_admin(p_organization_id,array['super_admin','sav_manager','sc_manager'],true) then
    raise exception using errcode='42501',message='assignment_denied';
  end if;
  update public.handoffs set status=p_status,assigned_to=coalesce(h.assigned_to,auth.uid()) where id=h.id;
  insert into public.audit_events(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
    values(p_organization_id,auth.uid(),'handoff.'||p_status,'handoff',h.id,jsonb_build_object('previous_status',h.status));
  return jsonb_build_object('ok',true);
end;
$$;
revoke all on function app_private.admin_manage_handoff(uuid,uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function app_private.admin_manage_handoff(uuid,uuid,text,timestamptz) to authenticated;
create or replace function public.admin_manage_handoff(p_organization_id uuid,p_handoff_id uuid,p_status text,p_expected_updated_at timestamptz)
returns jsonb language sql security invoker set search_path='' as $$
  select app_private.admin_manage_handoff(p_organization_id,p_handoff_id,p_status,p_expected_updated_at);
$$;
revoke all on function public.admin_manage_handoff(uuid,uuid,text,timestamptz) from public,anon;
grant execute on function public.admin_manage_handoff(uuid,uuid,text,timestamptz) to authenticated;

create or replace function public.admin_audit(p_organization_id uuid,p_offset integer default 0)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
  if not app_private.is_admin(p_organization_id,array['super_admin','analyst'],true) then
    raise exception using errcode='42501',message='admin_access_denied';
  end if;
  return jsonb_build_object(
    'items',coalesce((select jsonb_agg(to_jsonb(t)) from (
      select id,action,outcome,entity_type,entity_id,actor_user_id,created_at
      from public.audit_events where organization_id=p_organization_id
      order by created_at desc,id desc limit 30 offset least(greatest(coalesce(p_offset,0),0),100000)) t),'[]'::jsonb),
    'total',(select count(*) from public.audit_events where organization_id=p_organization_id));
end;
$$;
revoke all on function public.admin_audit(uuid,integer) from public,anon;
grant execute on function public.admin_audit(uuid,integer) to authenticated;

-- Avoid stale access after a store revokes or rotates a customer code.
create or replace function app_private.revoke_case_sessions_on_code_change()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  update public.case_sessions set revoked_at=now()
    where organization_id=old.organization_id and case_id=old.case_id and revoked_at is null;
  return new;
end;
$$;
revoke all on function app_private.revoke_case_sessions_on_code_change() from public,anon,authenticated;
create trigger revoke_case_sessions_on_code_change after update of revoked_at,code_hash on public.case_access_codes
for each row when (old.revoked_at is distinct from new.revoked_at or old.code_hash is distinct from new.code_hash)
execute function app_private.revoke_case_sessions_on_code_change();

commit;
