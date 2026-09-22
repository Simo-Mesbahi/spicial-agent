-- P1.7D — privacy-preserving canary observability.
-- Stores only bounded release diagnostics: never user messages, model prose,
-- evidence text, case IDs, session IDs, secrets or customer identifiers.

begin;

create table if not exists public.p1_release_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  request_id uuid not null,
  release_mode text not null
    check (release_mode in ('off','shadow','canary','on')),
  cohort boolean not null,
  cohort_bucket smallint
    check (cohort_bucket is null or cohort_bucket between 0 and 99),
  canary_percent smallint not null
    check (canary_percent between 0 and 100),
  attempted boolean not null,
  released boolean not null,
  reason text
    check (
      reason is null or reason in (
        'disabled',
        'shadow_only',
        'not_in_canary',
        'ineligible_plan',
        'configuration',
        'generation_failed',
        'validation_failed',
        'evidence_changed',
        'knowledge_unavailable',
        'hybrid_unavailable',
        'grounding_failure',
        'invalid_candidate'
      )
    ),
  plan text
    check (
      plan is null or plan in (
        'respond',
        'clarify',
        'case',
        'knowledge',
        'case_and_knowledge',
        'handoff',
        'unsupported_action'
      )
    ),
  generation_outcome text
    check (
      generation_outcome is null or generation_outcome in (
        'skipped',
        'candidate_generated',
        'failed'
      )
    ),
  validation_outcome text
    check (
      validation_outcome is null or validation_outcome in (
        'skipped',
        'supported_candidate',
        'blocked',
        'abstained'
      )
    ),
  provider text check (provider is null or char_length(provider) between 1 and 40),
  model text check (model is null or char_length(model) between 1 and 160),
  provider_calls smallint not null default 0
    check (provider_calls between 0 and 10),
  input_tokens integer check (input_tokens is null or input_tokens between 0 and 1000000),
  output_tokens integer check (output_tokens is null or output_tokens between 0 and 1000000),
  latency_ms integer not null check (latency_ms between 0 and 300000),
  created_at timestamptz not null default now(),
  unique (organization_id, request_id)
);

create index if not exists p1_release_events_org_time_idx
  on public.p1_release_events(organization_id, created_at desc);

create index if not exists p1_release_events_org_mode_time_idx
  on public.p1_release_events(organization_id, release_mode, created_at desc);

create index if not exists p1_release_events_org_released_time_idx
  on public.p1_release_events(organization_id, released, created_at desc);

alter table public.p1_release_events enable row level security;

drop policy if exists p1_release_events_deny_direct on public.p1_release_events;
create policy p1_release_events_deny_direct
  on public.p1_release_events
  for all
  to authenticated
  using (false)
  with check (false);

revoke all on public.p1_release_events
  from public, anon, authenticated, service_role;
revoke all on sequence public.p1_release_events_id_seq
  from public, anon, authenticated, service_role;

create or replace function public.record_p1_release_event(
  p_organization_id uuid,
  p_request_id uuid,
  p_release_mode text,
  p_cohort boolean,
  p_cohort_bucket integer,
  p_canary_percent integer,
  p_attempted boolean,
  p_released boolean,
  p_reason text,
  p_plan text,
  p_generation_outcome text,
  p_validation_outcome text,
  p_provider text,
  p_model text,
  p_provider_calls integer,
  p_input_tokens integer,
  p_output_tokens integer,
  p_latency_ms integer
)
returns void
language plpgsql
security definer
set search_path=''
as $$
begin
  if p_organization_id is null
     or p_request_id is null
     or not exists(
       select 1
       from public.organizations o
       where o.id=p_organization_id and o.active
     ) then
    raise exception using errcode='22023',message='invalid_release_event_scope';
  end if;

  insert into public.p1_release_events(
    organization_id,
    request_id,
    release_mode,
    cohort,
    cohort_bucket,
    canary_percent,
    attempted,
    released,
    reason,
    plan,
    generation_outcome,
    validation_outcome,
    provider,
    model,
    provider_calls,
    input_tokens,
    output_tokens,
    latency_ms
  ) values (
    p_organization_id,
    p_request_id,
    p_release_mode,
    p_cohort,
    p_cohort_bucket,
    p_canary_percent,
    p_attempted,
    p_released,
    p_reason,
    p_plan,
    p_generation_outcome,
    p_validation_outcome,
    nullif(left(trim(coalesce(p_provider,'')),40),''),
    nullif(left(trim(coalesce(p_model,'')),160),''),
    least(greatest(coalesce(p_provider_calls,0),0),10),
    case
      when p_input_tokens is null then null
      else least(greatest(p_input_tokens,0),1000000)
    end,
    case
      when p_output_tokens is null then null
      else least(greatest(p_output_tokens,0),1000000)
    end,
    least(greatest(coalesce(p_latency_ms,0),0),300000)
  )
  on conflict (organization_id,request_id) do nothing;
end;
$$;

revoke all on function public.record_p1_release_event(
  uuid,uuid,text,boolean,integer,integer,boolean,boolean,text,text,text,text,text,text,integer,integer,integer,integer
) from public,anon,authenticated;
grant execute on function public.record_p1_release_event(
  uuid,uuid,text,boolean,integer,integer,boolean,boolean,text,text,text,text,text,text,integer,integer,integer,integer
) to service_role;

create or replace function public.admin_p1_release_metrics(
  p_organization_id uuid,
  p_hours integer default 24
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_hours integer := least(greatest(coalesce(p_hours,24),1),168);
begin
  if not app_private.is_admin(p_organization_id,null,true) then
    raise exception using errcode='42501',message='admin_access_denied';
  end if;

  return (
    with events as materialized (
      select *
      from public.p1_release_events
      where organization_id=p_organization_id
        and created_at>=now()-make_interval(hours=>v_hours)
    ),
    canary as materialized (
      select *
      from events
      where release_mode='canary' and cohort
    ),
    reasons as (
      select reason,count(*)::bigint as count
      from events
      where reason is not null
      group by reason
    ),
    plans as (
      select plan,count(*)::bigint as count
      from events
      where plan is not null
      group by plan
    ),
    modes as (
      select release_mode,count(*)::bigint as count
      from events
      group by release_mode
    )
    select jsonb_build_object(
      'generated_at',now(),
      'period_hours',v_hours,
      'events',(select count(*) from events),
      'release_modes',coalesce(
        (select jsonb_object_agg(release_mode,count) from modes),
        '{}'::jsonb
      ),
      'canary',jsonb_build_object(
        'selected',(select count(*) from canary),
        'attempted',(select count(*) from canary where attempted),
        'released',(select count(*) from canary where released),
        'blocked',(select count(*) from canary where attempted and not released),
        'release_rate',(
          select round(
            100.0*count(*) filter(where released)/
            nullif(count(*) filter(where attempted),0),
            2
          )
          from canary
        )
      ),
      'quality',jsonb_build_object(
        'invariant_violations',(
          select count(*)
          from events
          where released and (
            reason is not null
            or generation_outcome is distinct from 'candidate_generated'
            or validation_outcome is distinct from 'supported_candidate'
          )
        ),
        'generation_failed',(select count(*) from events where reason='generation_failed'),
        'validation_failed',(select count(*) from events where reason='validation_failed'),
        'evidence_invalidated',(
          select count(*)
          from events
          where reason in (
            'evidence_changed',
            'knowledge_unavailable',
            'hybrid_unavailable',
            'grounding_failure'
          )
        ),
        'invalid_candidate',(select count(*) from events where reason='invalid_candidate'),
        'configuration_blocked',(select count(*) from events where reason='configuration')
      ),
      'latency',jsonb_build_object(
        'p50_ms',(
          select round(
            (percentile_cont(0.50) within group(order by latency_ms))::numeric
          )
          from events
        ),
        'p95_ms',(
          select round(
            (percentile_cont(0.95) within group(order by latency_ms))::numeric
          )
          from events
        )
      ),
      'usage',jsonb_build_object(
        'provider_calls',(select coalesce(sum(provider_calls),0) from events),
        'input_tokens',(select sum(input_tokens) from events),
        'output_tokens',(select sum(output_tokens) from events)
      ),
      'by_reason',coalesce(
        (select jsonb_object_agg(reason,count) from reasons),
        '{}'::jsonb
      ),
      'by_plan',coalesce(
        (select jsonb_object_agg(plan,count) from plans),
        '{}'::jsonb
      )
    )
  );
end;
$$;

revoke all on function public.admin_p1_release_metrics(uuid,integer)
  from public,anon;
grant execute on function public.admin_p1_release_metrics(uuid,integer)
  to authenticated;

create or replace function public.purge_p1_release_events(
  p_organization_id uuid,
  p_days integer default null
)
returns bigint
language plpgsql
security definer
set search_path=''
as $$
declare
  v_days integer;
  v_deleted bigint;
begin
  if not exists(
    select 1 from public.organizations where id=p_organization_id
  ) then
    raise exception using errcode='22023',message='invalid_release_event_scope';
  end if;

  select least(
    greatest(coalesce(p_days,o.retention_days),30),
    least(o.retention_days,3650)
  )
  into v_days
  from public.organizations o
  where o.id=p_organization_id;

  delete from public.p1_release_events
  where organization_id=p_organization_id
    and created_at<now()-make_interval(days=>v_days);

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.purge_p1_release_events(uuid,integer)
  from public,anon,authenticated;
grant execute on function public.purge_p1_release_events(uuid,integer)
  to service_role;

comment on table public.p1_release_events is
  'P1.7 release telemetry only. Never stores user content, generated prose, evidence text, case IDs or session IDs.';
comment on function public.record_p1_release_event(
  uuid,uuid,text,boolean,integer,integer,boolean,boolean,text,text,text,text,text,text,integer,integer,integer,integer
) is
  'Server-only idempotent insert for bounded P1.7 release diagnostics.';
comment on function public.admin_p1_release_metrics(uuid,integer) is
  'MFA-backed aggregate P1.7 rollout observability. Returns no per-customer or per-request rows.';
comment on function public.purge_p1_release_events(uuid,integer) is
  'Server-only retention helper capped by the organization retention policy.';

commit;
