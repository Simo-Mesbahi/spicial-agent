-- P1.7D hardening — keep authenticated API exposure SECURITY INVOKER,
-- move privileged aggregation behind app_private, and reduce write amplification.

begin;

drop index if exists public.p1_release_events_org_mode_time_idx;
drop index if exists public.p1_release_events_org_released_time_idx;

create or replace function app_private.admin_p1_release_metrics(
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
            release_mode not in ('canary','on')
            or not cohort
            or not attempted
            or reason is not null
            or plan not in ('case','knowledge','case_and_knowledge')
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

revoke all on function app_private.admin_p1_release_metrics(uuid,integer)
  from public,anon,authenticated;
grant execute on function app_private.admin_p1_release_metrics(uuid,integer)
  to authenticated;

create or replace function public.admin_p1_release_metrics(
  p_organization_id uuid,
  p_hours integer default 24
)
returns jsonb
language sql
stable
security invoker
set search_path=''
as $$
  select app_private.admin_p1_release_metrics(p_organization_id,p_hours);
$$;

revoke all on function public.admin_p1_release_metrics(uuid,integer)
  from public,anon;
grant execute on function public.admin_p1_release_metrics(uuid,integer)
  to authenticated;

comment on function app_private.admin_p1_release_metrics(uuid,integer) is
  'Privileged P1.7 aggregate implementation. Requires current MFA-backed organization membership.';
comment on function public.admin_p1_release_metrics(uuid,integer) is
  'SECURITY INVOKER API wrapper for MFA-backed aggregate P1.7 rollout observability.';

commit;
