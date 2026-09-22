-- SAV SC Assistant AI — defense-in-depth archive boundary for customer access.
-- Archived business records remain auditable but can never be reopened through
-- a stale access code or stale customer session.

begin;

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
  if not exists(
    select 1
    from public.organizations
    where id=p_organization_id and active
  ) then
    return jsonb_build_object('error','invalid_case_credentials');
  end if;

  if p_reference is null
     or char_length(trim(p_reference)) not between 6 and 64
     or p_code is null
     or p_code !~ '^[0-9]{6,12}$' then
    raise exception
      using errcode='P0001',message='invalid_case_credentials';
  end if;

  select
    c.id,
    least(v_expires_at,coalesce(access.expires_at,v_expires_at))
  into
    v_case_id,
    v_expires_at
  from public.service_cases c
  join public.case_access_codes access
    on access.case_id=c.id
   and access.organization_id=c.organization_id
  where c.organization_id=p_organization_id
    and c.archived_at is null
    and upper(c.reference)=upper(trim(p_reference))
    and access.revoked_at is null
    and (access.expires_at is null or access.expires_at>now())
    and extensions.crypt(p_code,access.code_hash)=access.code_hash
  order by access.created_at desc
  limit 1;

  if v_case_id is null then
    insert into public.audit_events(
      organization_id,
      action,
      entity_type,
      outcome,
      metadata
    ) values (
      p_organization_id,
      'case.access',
      'service_case',
      'denied',
      jsonb_build_object('reason','invalid_credentials')
    );

    -- Neutral denial prevents archive-state disclosure and commits the audit row.
    return jsonb_build_object('error','invalid_case_credentials');
  end if;

  v_token := encode(extensions.gen_random_bytes(32),'hex');

  insert into public.case_sessions(
    organization_id,
    case_id,
    token_hash,
    expires_at
  ) values (
    p_organization_id,
    v_case_id,
    extensions.digest(v_token,'sha256'),
    v_expires_at
  );

  insert into public.audit_events(
    organization_id,
    action,
    entity_type,
    entity_id,
    outcome
  ) values (
    p_organization_id,
    'case.access',
    'service_case',
    v_case_id,
    'success'
  );

  return jsonb_build_object(
    'access_token',v_token,
    'expires_at',v_expires_at,
    'case',app_private.case_snapshot(v_case_id)
  );
end;
$$;

create or replace function public.customer_case_snapshot(
  p_access_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private, extensions, pg_temp
as $$
declare
  v_session public.case_sessions%rowtype;
begin
  if p_access_token is null
     or p_access_token !~ '^[a-f0-9]{64}$' then
    raise exception
      using errcode='P0001',message='invalid_case_session';
  end if;

  select * into v_session
  from public.case_sessions
  where token_hash=extensions.digest(p_access_token,'sha256')
    and revoked_at is null
    and expires_at>now()
  limit 1;

  if v_session.id is null
     or not exists(
       select 1
       from public.organizations
       where id=v_session.organization_id and active
     )
     or not exists(
       select 1
       from public.service_cases c
       where c.id=v_session.case_id
         and c.organization_id=v_session.organization_id
         and c.archived_at is null
     )
     or not exists(
       select 1
       from public.case_access_codes access
       where access.case_id=v_session.case_id
         and access.organization_id=v_session.organization_id
         and access.revoked_at is null
         and (access.expires_at is null or access.expires_at>now())
     ) then
    raise exception
      using errcode='P0001',message='invalid_case_session';
  end if;

  update public.case_sessions
  set last_seen_at=now()
  where id=v_session.id;

  return jsonb_build_object(
    'expires_at',v_session.expires_at,
    'case',app_private.case_snapshot(v_session.case_id)
  );
end;
$$;

revoke all on function public.customer_open_case_session(uuid,text,text)
  from public,anon,authenticated;
revoke all on function public.customer_case_snapshot(text)
  from public,anon,authenticated;

grant execute on function public.customer_open_case_session(uuid,text,text)
  to service_role;
grant execute on function public.customer_case_snapshot(text)
  to service_role;

comment on function public.customer_open_case_session(uuid,text,text) is
  'Server-only customer verification. Archived cases always fail with neutral credentials denial.';
comment on function public.customer_case_snapshot(text) is
  'Server-only dossier snapshot. Active token, active organization, active access code and non-archived case are all required.';

commit;
