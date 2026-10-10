-- Synthetic fixtures only; run in a disposable database or staging, never seed production.
begin;
set local statement_timeout='15s';

insert into public.organizations(id,slug,name) values
  ('9b000000-0000-4000-8000-000000000001','overview-qa-a','Overview A'),
  ('9b000000-0000-4000-8000-000000000002','overview-qa-b','Overview B');
insert into auth.users(id,email,aud,role)
select ('9b000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  'overview-'||n||'@example.invalid','authenticated','authenticated'
from generate_series(101,105) n;
insert into auth.sessions(id,user_id)
select ('9b000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  ('9b000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
from generate_series(101,105) n;
insert into public.admin_memberships(organization_id,user_id,role)
select '9b000000-0000-4000-8000-000000000001'::uuid,
  ('9b000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,role
from (values (101,'analyst'),(102,'sav_manager'),(103,'sc_manager'),
  (104,'adviser'),(105,'super_admin')) roles(n,role);
insert into public.service_cases(id,organization_id,reference,kind,title,status,service_type,archived_at)
values
  ('9b000000-0000-4000-8000-000000000401','9b000000-0000-4000-8000-000000000001','QA-SAV','repair','Private SAV title','waiting_part','sav',null),
  ('9b000000-0000-4000-8000-000000000402','9b000000-0000-4000-8000-000000000001','QA-SERVICE','complaint','Private SC title','complaint_review','customer_service',null),
  ('9b000000-0000-4000-8000-000000000403','9b000000-0000-4000-8000-000000000001','QA-ARCHIVED','repair','Archived title','waiting_part','sav',now()),
  ('9b000000-0000-4000-8000-000000000404','9b000000-0000-4000-8000-000000000002','QA-OTHER','repair','Other tenant title','waiting_part','sav',null);
insert into public.handoffs(organization_id,case_id,summary)
select organization_id,id,'Private handoff summary' from public.service_cases
where id in (
  '9b000000-0000-4000-8000-000000000401','9b000000-0000-4000-8000-000000000402',
  '9b000000-0000-4000-8000-000000000403','9b000000-0000-4000-8000-000000000404'
);

set local role authenticated;
do $$
declare actor record; overview jsonb; identity text; raw_count bigint;
begin
  for actor in select * from (values
    (101,'analyst',2),(102,'sav_manager',1),(103,'sc_manager',1),
    (104,'adviser',2),(105,'super_admin',2)
  ) roles(n,role,expected_count) loop
    identity:='9b000000-0000-4000-8000-'||lpad(actor.n::text,12,'0');
    perform set_config('request.jwt.claims',jsonb_build_object(
      'sub',identity,'role','authenticated','aal','aal2','session_id',identity
    )::text,true);
    overview:=public.admin_overview('9b000000-0000-4000-8000-000000000001',7);
    if (overview#>>'{cases,total}')::integer is distinct from actor.expected_count
      or (overview#>>'{handoffs,open}')::integer is distinct from actor.expected_count
      or (overview#>>'{handoffs,unassigned}')::integer is distinct from actor.expected_count then
      raise exception 'Incorrect aggregate scope for %: %',actor.role,overview;
    end if;
    if overview::text like '%Private%' or overview::text like '%Other tenant%' then
      raise exception 'Raw business content exposed in aggregate response';
    end if;
    if actor.role='sav_manager' and overview->'by_status' ? 'complaint_review' then
      raise exception 'SAV manager saw Service Client status counts';
    end if;
    if actor.role='sc_manager' and overview->'by_status' ? 'waiting_part' then
      raise exception 'Service Client manager saw SAV status counts';
    end if;
    begin
      perform public.admin_overview('9b000000-0000-4000-8000-000000000002',7);
      raise exception 'Cross-organization aggregate access allowed';
    exception when insufficient_privilege then null; end;
    if actor.role='analyst' then
      select count(*) into raw_count from public.service_cases;
      if raw_count<>0 then raise exception 'Analyst raw-case access widened'; end if;
      begin
        perform public.admin_case_detail('9b000000-0000-4000-8000-000000000001',
          '9b000000-0000-4000-8000-000000000401');
        raise exception 'Analyst detailed-case RPC access allowed';
      exception when insufficient_privilege then null; end;
    end if;
    perform set_config('request.jwt.claims',jsonb_set(
      current_setting('request.jwt.claims')::jsonb,'{aal}','"aal1"'
    )::text,true);
    begin
      perform public.admin_overview('9b000000-0000-4000-8000-000000000001',7);
      raise exception 'Aggregate access allowed without MFA';
    exception when insufficient_privilege then null; end;
  end loop;
end $$;
reset role;
update auth.sessions set not_after=now()-interval '1 second'
where id='9b000000-0000-4000-8000-000000000101';
select set_config('request.jwt.claims',
  '{"sub":"9b000000-0000-4000-8000-000000000101","role":"authenticated","aal":"aal2","session_id":"9b000000-0000-4000-8000-000000000101"}',true);
set local role authenticated;
do $$ begin
  begin
    perform public.admin_overview('9b000000-0000-4000-8000-000000000001',7);
    raise exception 'Expired analyst session retained aggregate access';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'PASS: aggregate roles, service scopes, tenant isolation, archive exclusion, raw-case denial, MFA and session expiry' as result;
rollback;
