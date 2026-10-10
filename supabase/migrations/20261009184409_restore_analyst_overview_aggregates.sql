-- Restore the documented analyst aggregate-only contract.
-- Keep organization, MFA, current-session and archived-case checks intact.
-- No table, raw-case RPC or RLS grants are changed.

begin;

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
  v_is_analyst boolean;
  v_aggregate_services text[];
begin
  if not app_private.is_admin(p_organization_id,null,true) then
    raise exception using errcode='42501',message='admin_access_denied';
  end if;

  -- Aggregates are allowed for analysts, but raw-case access remains unchanged.
  -- Resolve the caller's two service scopes once, not once per case or handoff.
  v_is_analyst := app_private.is_admin(p_organization_id,array['analyst'],true);
  select coalesce(array_agg(service_type),array[]::text[])
  into v_aggregate_services
  from unnest(array['sav','customer_service']) as services(service_type)
  where v_is_analyst
    or app_private.case_service_read_allowed(p_organization_id,service_type);

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
        and c.service_type = any(v_aggregate_services)
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
                and c.service_type = any(v_aggregate_services)
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
                and c.service_type = any(v_aggregate_services)
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

commit;
