-- Execute with the SQL Editor in staging. Fixtures and mutations always roll back.
begin;
set local statement_timeout='15s';
insert into auth.users(id,email,aud,role) values
 ('9a000000-0000-4000-8000-000000000101','admin-qa@example.invalid','authenticated','authenticated'),
 ('9a000000-0000-4000-8000-000000000102','analyst-qa@example.invalid','authenticated','authenticated');
insert into auth.sessions(id,user_id) values
 ('9a000000-0000-4000-8000-000000000201','9a000000-0000-4000-8000-000000000101'),
 ('9a000000-0000-4000-8000-000000000202','9a000000-0000-4000-8000-000000000102');
insert into public.organizations(id,slug,name) values
 ('9a000000-0000-4000-8000-000000000001','rollback-qa-a','QA A'),
 ('9a000000-0000-4000-8000-000000000002','rollback-qa-b','QA B');
insert into public.admin_memberships(organization_id,user_id,role) values
 ('9a000000-0000-4000-8000-000000000001','9a000000-0000-4000-8000-000000000101','super_admin'),
 ('9a000000-0000-4000-8000-000000000001','9a000000-0000-4000-8000-000000000102','analyst'),
 ('9a000000-0000-4000-8000-000000000002','9a000000-0000-4000-8000-000000000102','analyst');
insert into public.service_cases(id,organization_id,reference,kind,title,status,estimated_at,closed_at,created_at) values
 ('9a000000-0000-4000-8000-000000000401','9a000000-0000-4000-8000-000000000001','QA-REPAIR','repair','Test réparation','waiting_part',now()-interval '1 day',null,now()-interval '6 days'),
 ('9a000000-0000-4000-8000-000000000402','9a000000-0000-4000-8000-000000000001','QA-REFUND','refund','Test remboursement','refunded',null,now()-interval '1 day',now()-interval '6 days'),
 ('9a000000-0000-4000-8000-000000000403','9a000000-0000-4000-8000-000000000001','QA-OPENED','complaint','Test réclamation','opened',null,null,now());
insert into public.handoffs(id,organization_id,case_id,summary) values
 ('9a000000-0000-4000-8000-000000000501','9a000000-0000-4000-8000-000000000001','9a000000-0000-4000-8000-000000000401','Demande fictive');
insert into public.performance_samples(organization_id,route,status_code,latency_ms) values
 ('9a000000-0000-4000-8000-000000000001','/api/production/cases/verify',200,10),
 ('9a000000-0000-4000-8000-000000000001','/api/production/cases/current',500,30);
do $$ begin
 perform set_config('request.jwt.claims','{"sub":"9a000000-0000-4000-8000-000000000101","email":"admin-qa@example.invalid","role":"authenticated","aal":"aal1","session_id":"9a000000-0000-4000-8000-000000000201"}',true);
end $$;
set local role authenticated;
do $$ declare n bigint; begin
 if jsonb_array_length(public.admin_me()->'memberships') is distinct from 1 then raise exception 'AAL1 onboarding identity blocked'; end if;
 select count(*) into n from public.service_cases;
 if n is distinct from 0::bigint then raise exception 'AAL1 business data exposed'; end if;
 begin
   perform public.admin_overview('9a000000-0000-4000-8000-000000000001',30);
   raise exception 'AAL1 overview allowed';
 exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claims',jsonb_set(current_setting('request.jwt.claims')::jsonb,'{aal}','"aal2"')::text,true);
end $$;
do $$ declare o jsonb; r jsonb; again jsonb; t timestamptz; begin
 o:=public.admin_overview('9a000000-0000-4000-8000-000000000001',7);
 if o#>>'{cases,total}' is distinct from '3' or o#>>'{cases,open}' is distinct from '2'
   or o#>>'{cases,overdue}' is distinct from '1' or o#>>'{cases,without_eta}' is distinct from '1'
   or o#>>'{cases,resolved}' is distinct from '1' then raise exception 'Incorrect dashboard case counts: %',o->'cases'; end if;
 if (o#>>'{performance,avg_latency_ms_24h}')::numeric is distinct from 20::numeric
   or (o#>>'{performance,error_rate_24h}')::numeric is distinct from 50::numeric
   or jsonb_array_length(o->'trend') is distinct from 7 then raise exception 'Incorrect measured metrics'; end if;
 begin
   perform public.admin_overview('9a000000-0000-4000-8000-000000000002',7);
   raise exception 'Cross-organization access allowed';
 exception when insufficient_privilege then null; end;
 if public.admin_case_detail('9a000000-0000-4000-8000-000000000001','9a000000-0000-4000-8000-000000000401')->>'reference' is distinct from 'QA-REPAIR' then raise exception 'Detail missing'; end if;
 begin
   update public.service_cases set status='delivered' where id='9a000000-0000-4000-8000-000000000401';
   raise exception 'Direct mutation bypass allowed';
 exception when insufficient_privilege then null; end;
 r:=public.admin_add_note('9a000000-0000-4000-8000-000000000001','9a000000-0000-4000-8000-000000000401',1,'Interne uniquement',false,'qa-note-private-0001');
 again:=public.admin_add_note('9a000000-0000-4000-8000-000000000001','9a000000-0000-4000-8000-000000000401',1,'Interne uniquement',false,'qa-note-private-0001');
 if r is distinct from again or r->>'version' is distinct from '2' then raise exception 'Idempotency failed'; end if;
 begin
   perform public.admin_add_note('9a000000-0000-4000-8000-000000000001','9a000000-0000-4000-8000-000000000401',1,'Version obsolète',true,'qa-note-stale-0002');
   raise exception 'Stale write accepted';
 exception when serialization_failure then null; end;
 begin
   perform public.admin_add_note('9a000000-0000-4000-8000-000000000001','9a000000-0000-4000-8000-000000000401',2,'Contenu modifié',false,'qa-note-private-0001');
   raise exception 'Idempotency key reuse accepted';
 exception when serialization_failure then null; end;
 perform public.admin_add_note('9a000000-0000-4000-8000-000000000001','9a000000-0000-4000-8000-000000000401',2,'Message visible au client',true,'qa-note-public-0003');
 select updated_at into t from public.handoffs where id='9a000000-0000-4000-8000-000000000501';
 perform public.admin_manage_handoff('9a000000-0000-4000-8000-000000000001','9a000000-0000-4000-8000-000000000501','assigned',t);
 if public.admin_queue('9a000000-0000-4000-8000-000000000001')#>>'{handoffs,0,assigned_to}' is distinct from '9a000000-0000-4000-8000-000000000101' then raise exception 'Assignment failed'; end if;
 if public.admin_audit('9a000000-0000-4000-8000-000000000001')::text like '%Interne uniquement%' then raise exception 'Note leaked in audit'; end if;
end $$;
do $$ declare o jsonb; n bigint; begin
 perform set_config('request.jwt.claims','{"sub":"9a000000-0000-4000-8000-000000000102","email":"analyst-qa@example.invalid","role":"authenticated","aal":"aal2","session_id":"9a000000-0000-4000-8000-000000000202"}',true);
 o:=public.admin_overview('9a000000-0000-4000-8000-000000000001',30);
 if o#>>'{cases,total}' is distinct from '3' then raise exception 'Analyst aggregates hidden'; end if;
 select count(*) into n from public.service_cases;
 if n is distinct from 0::bigint then raise exception 'Analyst raw cases visible'; end if;
 begin
   perform public.admin_case_detail('9a000000-0000-4000-8000-000000000001','9a000000-0000-4000-8000-000000000401');
   raise exception 'Analyst case detail allowed';
 exception when insufficient_privilege then null; end;
 o:=public.admin_overview('9a000000-0000-4000-8000-000000000002',30);
 if o#>>'{performance,avg_latency_ms_24h}' is not null or o#>>'{performance,error_rate_24h}' is not null then raise exception 'Absent measurements displayed as zero'; end if;
end $$;
reset role;
do $$ declare r jsonb; token text; n bigint; begin
 perform public.set_case_access_code('9a000000-0000-4000-8000-000000000001','9a000000-0000-4000-8000-000000000401','901234',now()+interval '10 minutes');
 r:=public.customer_open_case_session('9a000000-0000-4000-8000-000000000001','QA-REPAIR','999999');
 if r->>'error' is distinct from 'invalid_case_credentials' then raise exception 'Wrong code accepted'; end if;
 select count(*) into n from public.audit_events where organization_id='9a000000-0000-4000-8000-000000000001' and outcome='denied';
 if n is distinct from 1::bigint then raise exception 'Denied audit rolled back'; end if;
 r:=public.customer_open_case_session('9a000000-0000-4000-8000-000000000001','QA-REPAIR','901234'); token:=r->>'access_token';
 if token is null or jsonb_array_length(r#>'{case,events}') is distinct from 1 then raise exception 'Customer session or event filtering failed'; end if;
 if r::text like '%Interne uniquement%' then raise exception 'Internal note exposed'; end if;
 if (r->>'expires_at')::timestamptz > now()+interval '10 minutes' then raise exception 'Code expiry ignored'; end if;
 update public.organizations set active=false where id='9a000000-0000-4000-8000-000000000001';
 begin perform public.customer_case_snapshot(token); raise exception 'Inactive organization allowed'; exception when sqlstate 'P0001' then
   if sqlerrm<>'invalid_case_session' then raise; end if; end;
 update public.organizations set active=true where id='9a000000-0000-4000-8000-000000000001';
 perform public.set_case_access_code('9a000000-0000-4000-8000-000000000001','9a000000-0000-4000-8000-000000000401','902345',null);
 begin perform public.customer_case_snapshot(token); raise exception 'Rotated code session allowed'; exception when sqlstate 'P0001' then
   if sqlerrm<>'invalid_case_session' then raise; end if; end;
 if has_function_privilege('anon','public.customer_case_snapshot(text)','EXECUTE')
   or has_function_privilege('authenticated','public.bootstrap_admin(uuid,text,text,text)','EXECUTE') then raise exception 'Privileged RPC exposed'; end if;
end $$;
delete from auth.sessions where id='9a000000-0000-4000-8000-000000000202';
set local role authenticated;
do $$ begin
 if jsonb_array_length(public.admin_me()->'memberships') is distinct from 0 then raise exception 'Revoked Auth session retained'; end if;
 begin perform public.admin_overview('9a000000-0000-4000-8000-000000000001',7);
 raise exception 'Revoked session accessed overview'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'PASS: onboarding, MFA, roles, tenancy, metrics, notes, idempotency, conflicts, assignment, audit, client sessions, revocation; fixtures rolled back' as result;
rollback;
