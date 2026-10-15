-- Synthetic fixtures only. This entire contract rolls back locally and on staging.
begin;
set local statement_timeout='20s';
insert into auth.users(id,email,aud,role) values
 ('9b000000-0000-4000-8000-000000000101','business-admin@example.invalid','authenticated','authenticated'),
 ('9b000000-0000-4000-8000-000000000102','business-sav@example.invalid','authenticated','authenticated'),
 ('9b000000-0000-4000-8000-000000000103','business-adviser@example.invalid','authenticated','authenticated'),
 ('9b000000-0000-4000-8000-000000000104','business-analyst@example.invalid','authenticated','authenticated');
insert into auth.sessions(id,user_id) values
 ('9b000000-0000-4000-8000-000000000201','9b000000-0000-4000-8000-000000000101'),
 ('9b000000-0000-4000-8000-000000000202','9b000000-0000-4000-8000-000000000102'),
 ('9b000000-0000-4000-8000-000000000203','9b000000-0000-4000-8000-000000000103'),
 ('9b000000-0000-4000-8000-000000000204','9b000000-0000-4000-8000-000000000104');
insert into public.organizations(id,slug,name) values
 ('9b000000-0000-4000-8000-000000000001','business-qa-a','Business QA A'),
 ('9b000000-0000-4000-8000-000000000002','business-qa-b','Business QA B');
insert into public.admin_memberships(organization_id,user_id,role) values
 ('9b000000-0000-4000-8000-000000000001','9b000000-0000-4000-8000-000000000101','super_admin'),
 ('9b000000-0000-4000-8000-000000000001','9b000000-0000-4000-8000-000000000102','sav_manager'),
 ('9b000000-0000-4000-8000-000000000001','9b000000-0000-4000-8000-000000000103','adviser'),
 ('9b000000-0000-4000-8000-000000000001','9b000000-0000-4000-8000-000000000104','analyst');
insert into public.customers(id,organization_id,first_name,last_name,email) values
 ('9b000000-0000-4000-8000-000000000301','9b000000-0000-4000-8000-000000000001','Client','SAV','old@example.invalid'),
 ('9b000000-0000-4000-8000-000000000302','9b000000-0000-4000-8000-000000000001','Client','Partagé','shared@example.invalid'),
 ('9b000000-0000-4000-8000-000000000303','9b000000-0000-4000-8000-000000000002','Client','Étranger','foreign@example.invalid');
insert into public.products(id,organization_id,name,sku) values
 ('9b000000-0000-4000-8000-000000000311','9b000000-0000-4000-8000-000000000001','Produit synthétique','QA-100');
insert into public.stores(id,organization_id,code,name) values
 ('9b000000-0000-4000-8000-000000000321','9b000000-0000-4000-8000-000000000001','QA-STORE','Magasin synthétique');
insert into public.service_cases(id,organization_id,reference,service_type,kind,title,status,customer_id,product_id,store_id) values
 ('9b000000-0000-4000-8000-000000000401','9b000000-0000-4000-8000-000000000001','QA-SAV-001','sav','repair','Réparation A','diagnosis','9b000000-0000-4000-8000-000000000301','9b000000-0000-4000-8000-000000000311','9b000000-0000-4000-8000-000000000321'),
 ('9b000000-0000-4000-8000-000000000402','9b000000-0000-4000-8000-000000000001','QA-SAV-002','sav','repair','Réparation B','opened','9b000000-0000-4000-8000-000000000302',null,null),
 ('9b000000-0000-4000-8000-000000000403','9b000000-0000-4000-8000-000000000001','QA-SC-0003','customer_service','complaint','Réclamation','opened','9b000000-0000-4000-8000-000000000302',null,null),
 ('9b000000-0000-4000-8000-000000000404','9b000000-0000-4000-8000-000000000002','QA-OTHER-4','sav','repair','Autre organisation','opened','9b000000-0000-4000-8000-000000000303',null,null);
insert into public.case_access_codes(organization_id,case_id,code_hash) values
 ('9b000000-0000-4000-8000-000000000001','9b000000-0000-4000-8000-000000000401','synthetic-only');
insert into public.case_sessions(id,organization_id,case_id,token_hash,expires_at) values
 ('9b000000-0000-4000-8000-000000000501','9b000000-0000-4000-8000-000000000001','9b000000-0000-4000-8000-000000000401',extensions.digest('business-test-session','sha256'),now()+interval '1 hour');
insert into public.assistant_conversations(id,organization_id,case_id) values
 ('9b000000-0000-4000-8000-000000000601','9b000000-0000-4000-8000-000000000001','9b000000-0000-4000-8000-000000000401');
insert into public.assistant_messages(organization_id,conversation_id,case_id,role,content,created_at,metadata)
 select '9b000000-0000-4000-8000-000000000001','9b000000-0000-4000-8000-000000000601','9b000000-0000-4000-8000-000000000401',
   case when n%2=0 then 'user' else 'assistant' end,'Message synthétique '||n,now()-n*interval '1 second','{"internal_token":"must-not-appear"}'::jsonb
 from generate_series(1,51) n;
insert into public.assistant_messages(organization_id,conversation_id,case_id,role,content) values
 ('9b000000-0000-4000-8000-000000000001','9b000000-0000-4000-8000-000000000601','9b000000-0000-4000-8000-000000000401','system','private-system-instruction');
select set_config('request.jwt.claims','{"sub":"9b000000-0000-4000-8000-000000000102","role":"authenticated","aal":"aal1","session_id":"9b000000-0000-4000-8000-000000000202"}',true);
set local role authenticated;
do $$ begin
  begin perform public.admin_entities('9b000000-0000-4000-8000-000000000001','customer','',0); raise exception 'AAL1 directory exposed';
    exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claims',jsonb_set(auth.jwt(),'{aal}','"aal2"')::text,true);
end $$;
do $$ declare r jsonb; again jsonb; payload jsonb; v integer; items jsonb; m jsonb; older jsonb; begin
  r:=public.admin_entities('9b000000-0000-4000-8000-000000000001','customer','',0);
  if r->>'total'<>'2' or r::text like '%foreign@example.invalid%' then raise exception 'Directory tenant isolation failed: %',r; end if;
  if public.admin_entities('9b000000-0000-4000-8000-000000000001','customer','%',0)->>'total'<>'0' then raise exception 'Wildcard search was not literal'; end if;
  begin perform public.admin_entities('9b000000-0000-4000-8000-000000000002','customer','',0); raise exception 'Foreign directory exposed';
    exception when insufficient_privilege then null; end;
  payload:='{"first_name":"Client","last_name":"Corrigé","email":"corrected@example.invalid","phone":null,"external_id":null}';
  begin update public.customers set email='bypass@example.invalid' where id='9b000000-0000-4000-8000-000000000301'; raise exception 'Direct entity write bypassed audit/revision';
    exception when insufficient_privilege then null; end;
  r:=public.admin_save_entity('9b000000-0000-4000-8000-000000000001','customer','9b000000-0000-4000-8000-000000000301',1,payload,'business-customer-save-001');
  again:=public.admin_save_entity('9b000000-0000-4000-8000-000000000001','customer','9b000000-0000-4000-8000-000000000301',1,payload,'business-customer-save-001');
  if r is distinct from again or r->>'revision'<>'2' or r#>>'{data,email}'<>'corrected@example.invalid' then raise exception 'Entity correction/replay failed'; end if;
  if public.admin_case_detail_v2('9b000000-0000-4000-8000-000000000001','9b000000-0000-4000-8000-000000000401')->>'version'<>'2' then raise exception 'Linked case version not invalidated'; end if;
  begin perform public.admin_save_entity('9b000000-0000-4000-8000-000000000001','customer','9b000000-0000-4000-8000-000000000301',1,payload,'business-customer-stale-02'); raise exception 'Stale entity edit accepted';
    exception when serialization_failure then null; end;
  begin perform public.admin_save_entity('9b000000-0000-4000-8000-000000000001','customer','9b000000-0000-4000-8000-000000000301',2,payload||'{"email":"other@example.invalid"}'::jsonb,'business-customer-save-001'); raise exception 'Idempotency key changed payload accepted';
    exception when serialization_failure then null; end;
  begin perform public.admin_save_entity('9b000000-0000-4000-8000-000000000001','customer','9b000000-0000-4000-8000-000000000302',1,payload,'business-shared-edit-001'); raise exception 'Shared service boundary bypassed';
    exception when insufficient_privilege then null; end;
  begin perform public.admin_save_entity('9b000000-0000-4000-8000-000000000001','customer','9b000000-0000-4000-8000-000000000301',2,payload||'{"organization_id":"9b000000-0000-4000-8000-000000000002"}'::jsonb,'business-extra-field-001'); raise exception 'Unknown field accepted';
    exception when invalid_parameter_value then null; end;
  begin perform public.admin_save_entity('9b000000-0000-4000-8000-000000000001','customer','9b000000-0000-4000-8000-000000000301',2,'{}','business-missing-field-001'); raise exception 'Missing fields cleared entity';
    exception when invalid_parameter_value then null; end;
  begin perform public.admin_save_entity('9b000000-0000-4000-8000-000000000001','store',null,0,'{"code":"B","name":"Store B","city":null,"address":null,"active":true}','business-store-denied-001'); raise exception 'Manager store creation allowed';
    exception when insufficient_privilege then null; end;
  r:=public.admin_update_case('9b000000-0000-4000-8000-000000000001','9b000000-0000-4000-8000-000000000401',2,
    '{"title":"Réparation A","description":"","customer_id":"9b000000-0000-4000-8000-000000000302","product_id":"9b000000-0000-4000-8000-000000000311","store_id":"9b000000-0000-4000-8000-000000000321","warranty_status":"unknown","warranty_label":null,"quote_cents":null,"refund_cents":null,"currency":"EUR","delivery_mode":null,"estimated_at":null}',
    'business-reassign-client-001');
  if r->>'version'<>'3' then raise exception 'Case reassociation failed'; end if;
  items:='[{"id":"9b000000-0000-4000-8000-000000000401","version":3},{"id":"9b000000-0000-4000-8000-000000000402","version":1}]';
  begin perform public.admin_batch_cases('9b000000-0000-4000-8000-000000000001',items,'transition','{"status":"repairing","note":"Test","visible":false}','business-invalid-batch-001'); raise exception 'Invalid lifecycle accepted';
    exception when invalid_parameter_value then null; end;
  if public.admin_case_detail_v2('9b000000-0000-4000-8000-000000000001','9b000000-0000-4000-8000-000000000401')->>'version'<>'3' then raise exception 'Batch did not roll back first case'; end if;
  r:=public.admin_batch_cases('9b000000-0000-4000-8000-000000000001',items,'note','{"note":"Note groupée de test","visible":false}','business-valid-batch-001');
  again:=public.admin_batch_cases('9b000000-0000-4000-8000-000000000001',items,'note','{"note":"Note groupée de test","visible":false}','business-valid-batch-001');
  if r is distinct from again or r->>'count'<>'2' then raise exception 'Batch replay duplicated notes'; end if;
  begin perform public.admin_batch_cases('9b000000-0000-4000-8000-000000000001',items,'note','{"note":"Version obsolète","visible":false}','business-stale-batch-001'); raise exception 'Stale batch accepted';
    exception when serialization_failure then null; end;
  r:=public.admin_export_cases('9b000000-0000-4000-8000-000000000001','','','','active');
  if r->>'total'<>'2' or r::text like '%QA-SC-0003%' or r::text like '%QA-OTHER-4%' then raise exception 'Export service/tenant scope failed'; end if;
  r:=public.admin_archive_case('9b000000-0000-4000-8000-000000000001','9b000000-0000-4000-8000-000000000401',4,'Archivage de test','business-archive-test-001');
  r:=public.admin_restore_case('9b000000-0000-4000-8000-000000000001','9b000000-0000-4000-8000-000000000401',5,'Restauration de test','business-restore-test-001');
  again:=public.admin_restore_case('9b000000-0000-4000-8000-000000000001','9b000000-0000-4000-8000-000000000401',5,'Restauration de test','business-restore-test-001');
  if r is distinct from again or r->>'version'<>'6' then raise exception 'Restore/replay failed'; end if;
  m:=public.admin_case_messages('9b000000-0000-4000-8000-000000000001','9b000000-0000-4000-8000-000000000401');
  if jsonb_array_length(m->'items')<>50 or m->>'hasMore'<>'true' or m::text like '%must-not-appear%' or m::text like '%private-system-instruction%' then raise exception 'Message boundary/limit failed'; end if;
  older:=public.admin_case_messages('9b000000-0000-4000-8000-000000000001','9b000000-0000-4000-8000-000000000401',
    (m#>>'{nextCursor,createdAt}')::timestamptz,(m#>>'{nextCursor,id}')::uuid);
  if jsonb_array_length(older->'items')<>1 or older->>'hasMore'<>'false' then raise exception 'Message keyset pagination failed'; end if;
  begin perform public.admin_case_messages('9b000000-0000-4000-8000-000000000002','9b000000-0000-4000-8000-000000000404'); raise exception 'Cross-tenant message access';
    exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
  if exists(select 1 from public.case_access_codes where case_id='9b000000-0000-4000-8000-000000000401' and revoked_at is null)
    or exists(select 1 from public.case_sessions where case_id='9b000000-0000-4000-8000-000000000401' and revoked_at is null) then
    raise exception 'Previous customer access survived reassociation/restoration'; end if;
  if (select count(*) from public.case_events where case_id='9b000000-0000-4000-8000-000000000401' and label='Note interne')<>1 then raise exception 'Batch note count incorrect'; end if;
end $$;
select set_config('request.jwt.claims','{"sub":"9b000000-0000-4000-8000-000000000101","role":"authenticated","aal":"aal2","session_id":"9b000000-0000-4000-8000-000000000201"}',true);
set local role authenticated;
do $$ declare r jsonb; begin
  r:=public.admin_save_entity('9b000000-0000-4000-8000-000000000001','product',null,0,'{"name":"Produit neuf","external_id":"QA-PRODUCT-NEW","sku":"SKU-NEW","category":null,"serial_number":null}','business-product-create-001');
  if r->>'revision'<>'1' or r->>'kind'<>'product' then raise exception 'Product create failed'; end if;
  if public.admin_save_entity('9b000000-0000-4000-8000-000000000001','product',null,0,'{"name":"Produit neuf","external_id":"QA-PRODUCT-NEW","sku":"SKU-NEW","category":null,"serial_number":null}','business-product-create-001') is distinct from r then raise exception 'Create replay duplicated product'; end if;
  begin perform public.admin_save_entity('9b000000-0000-4000-8000-000000000001','store','9b000000-0000-4000-8000-000000000321',1,'{"code":"QA-STORE","name":"Magasin synthétique","city":null,"address":null,"active":false}','business-store-close-001'); raise exception 'Store with open cases deactivated';
    exception when invalid_parameter_value then null; end;
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"9b000000-0000-4000-8000-000000000104","role":"authenticated","aal":"aal2","session_id":"9b000000-0000-4000-8000-000000000204"}',true);
set local role authenticated;
do $$ begin
  begin perform public.admin_export_cases('9b000000-0000-4000-8000-000000000001','','','','active'); raise exception 'Analyst exported raw cases'; exception when insufficient_privilege then null; end;
  begin perform public.admin_entities('9b000000-0000-4000-8000-0000000…291 tokens truncated…id,reference,service_type,kind,title,status,updated_at)
  select ('9b000000-0000-4000-8001-'||lpad(n::text,12,'0'))::uuid,
    '9b000000-0000-4000-8000-000000000001','QA-SNAPSHOT-'||lpad(n::text,4,'0'),
    'sav','repair','Instantané synthétique','opened','2026-01-01T00:00:00Z'::timestamptz
  from generate_series(1,300) n;
select set_config('request.jwt.claims','{"sub":"9b000000-0000-4000-8000-000000000101","role":"authenticated","aal":"aal2","session_id":"9b000000-0000-4000-8000-000000000201"}',true);
set local role authenticated;
do $$ declare r jsonb; begin
  r:=public.admin_export_cases('9b000000-0000-4000-8000-000000000001','QA-SNAPSHOT','sav','opened','active');
  if r->>'total'<>'300' or jsonb_array_length(r->'items')<>300
    or (select count(distinct x->>'id') from jsonb_array_elements(r->'items') x)<>300
    or r#>>'{items,0,reference}'<>'QA-SNAPSHOT-0001'
    or r#>>'{items,299,reference}'<>'QA-SNAPSHOT-0300' then
    raise exception 'Export completeness or stable ordering failed'; end if;
  r:=public.admin_export_cases('9b000000-0000-4000-8000-000000000001','QA-SNAPSHOT','customer_service','','all');
  if r->>'total'<>'0' or r->'items'<>'[]'::jsonb then raise exception 'Empty filtered export failed'; end if;
  begin perform public.admin_export_cases('9b000000-0000-4000-8000-000000000001','','other','','active');
    raise exception 'Invalid export service accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.admin_export_cases('9b000000-0000-4000-8000-000000000001','','','',null);
    raise exception 'Null export archive filter accepted'; exception when invalid_parameter_value then null; end;
end $$;
reset role;
insert into public.service_cases(organization_id,reference,service_type,kind,title,status)
  select '9b000000-0000-4000-8000-000000000001','QA-LIMIT-'||n,'sav','repair',repeat('V',180),'opened'
  from generate_series(1,1001) n;
select set_config('request.jwt.claims','{"sub":"9b000000-0000-4000-8000-000000000101","role":"authenticated","aal":"aal2","session_id":"9b000000-0000-4000-8000-000000000201"}',true);
set local role authenticated;
do $$ begin
  begin perform public.admin_export_cases('9b000000-0000-4000-8000-000000000001','QA-LIMIT','','','active'); raise exception 'Unbounded export accepted';
    exception when invalid_parameter_value then
      if sqlerrm<>'export_limit_exceeded' then raise; end if;
  end;
end $$;
reset role;
update public.service_cases set status='diagnosis' where organization_id='9b000000-0000-4000-8000-000000000001' and reference='QA-LIMIT-1';
set local role authenticated;
do $$ begin
  begin perform public.admin_export_cases('9b000000-0000-4000-8000-000000000001','QA-LIMIT','','opened','active');
    raise exception 'Oversized export accepted'; exception when invalid_parameter_value then
      if sqlerrm<>'export_size_exceeded' then raise; end if;
  end;
end $$;
reset role;
rollback;
select 'PASS: admin business scopes, revisions, replay, atomic batches, exports, access revocation and message pagination' as result;
