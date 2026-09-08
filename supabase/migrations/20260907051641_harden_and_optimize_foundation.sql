-- Follow-up hardening validated against the live Supabase advisors.
-- Keeps authenticated admin queries under RLS and indexes every foreign key.

begin;

alter function public.admin_me() security invoker;
alter function public.admin_dashboard(uuid) security invoker;
alter function public.admin_list_cases(uuid, integer, integer, text, text, text) security invoker;

drop policy if exists memberships_self_select on public.admin_memberships;
create policy memberships_self_select on public.admin_memberships
for select to authenticated
using (
  user_id = (select auth.uid())
  and active
  and coalesce((select auth.jwt())->>'aal', 'aal1') = 'aal2'
);

drop policy if exists stores_admin_write on public.stores;
create policy stores_admin_insert on public.stores for insert to authenticated
with check (app_private.is_admin(organization_id, array['super_admin'], true));
create policy stores_admin_update on public.stores for update to authenticated
using (app_private.is_admin(organization_id, array['super_admin'], true))
with check (app_private.is_admin(organization_id, array['super_admin'], true));

drop policy if exists customers_admin_write on public.customers;
create policy customers_admin_insert on public.customers for insert to authenticated
with check (app_private.is_admin(organization_id, array['super_admin','sav_manager','sc_manager'], true));
create policy customers_admin_update on public.customers for update to authenticated
using (app_private.is_admin(organization_id, array['super_admin','sav_manager','sc_manager'], true))
with check (app_private.is_admin(organization_id, array['super_admin','sav_manager','sc_manager'], true));

drop policy if exists products_admin_write on public.products;
create policy products_admin_insert on public.products for insert to authenticated
with check (app_private.is_admin(organization_id, array['super_admin','sav_manager','sc_manager'], true));
create policy products_admin_update on public.products for update to authenticated
using (app_private.is_admin(organization_id, array['super_admin','sav_manager','sc_manager'], true))
with check (app_private.is_admin(organization_id, array['super_admin','sav_manager','sc_manager'], true));

drop policy if exists cases_admin_write on public.service_cases;
create policy cases_admin_insert on public.service_cases for insert to authenticated
with check (app_private.is_admin(organization_id, array['super_admin','sav_manager','sc_manager'], true));
create policy cases_admin_update on public.service_cases for update to authenticated
using (app_private.is_admin(organization_id, array['super_admin','sav_manager','sc_manager'], true))
with check (app_private.is_admin(organization_id, array['super_admin','sav_manager','sc_manager'], true));

drop policy if exists handoffs_admin_write on public.handoffs;
create policy handoffs_admin_insert on public.handoffs for insert to authenticated
with check (app_private.is_admin(organization_id, array['super_admin','sav_manager','sc_manager','adviser'], true));
create policy handoffs_admin_update on public.handoffs for update to authenticated
using (app_private.is_admin(organization_id, array['super_admin','sav_manager','sc_manager','adviser'], true))
with check (app_private.is_admin(organization_id, array['super_admin','sav_manager','sc_manager','adviser'], true));

drop policy if exists knowledge_admin_write on public.knowledge_documents;
create policy knowledge_admin_insert on public.knowledge_documents for insert to authenticated
with check (app_private.is_admin(organization_id, array['super_admin','sav_manager','sc_manager'], true));
create policy knowledge_admin_update on public.knowledge_documents for update to authenticated
using (app_private.is_admin(organization_id, array['super_admin','sav_manager','sc_manager'], true))
with check (app_private.is_admin(organization_id, array['super_admin','sav_manager','sc_manager'], true));

create index if not exists admin_memberships_user_id_idx on public.admin_memberships(user_id);
create index if not exists admin_memberships_created_by_idx on public.admin_memberships(created_by) where created_by is not null;
create index if not exists conversations_case_id_idx on public.assistant_conversations(case_id) where case_id is not null;
create index if not exists conversations_org_case_idx on public.assistant_conversations(organization_id, case_id);
create index if not exists conversations_case_session_id_idx on public.assistant_conversations(case_session_id) where case_session_id is not null;
create index if not exists conversations_org_session_idx on public.assistant_conversations(organization_id, case_session_id);
create index if not exists messages_case_id_idx on public.assistant_messages(case_id) where case_id is not null;
create index if not exists messages_org_case_idx on public.assistant_messages(organization_id, case_id);
create index if not exists messages_conversation_id_idx on public.assistant_messages(conversation_id);
create index if not exists messages_org_conversation_idx on public.assistant_messages(organization_id, conversation_id);
create index if not exists audit_actor_user_id_idx on public.audit_events(actor_user_id) where actor_user_id is not null;
create index if not exists access_codes_case_id_idx on public.case_access_codes(case_id);
create index if not exists access_codes_org_case_idx on public.case_access_codes(organization_id, case_id);
create index if not exists access_codes_created_by_idx on public.case_access_codes(created_by) where created_by is not null;
create index if not exists commands_case_id_idx on public.case_commands(case_id);
create index if not exists commands_org_case_idx on public.case_commands(organization_id, case_id);
create index if not exists events_actor_user_id_idx on public.case_events(actor_user_id) where actor_user_id is not null;
create index if not exists events_case_id_idx on public.case_events(case_id);
create index if not exists events_org_case_idx on public.case_events(organization_id, case_id);
create index if not exists sessions_case_id_idx on public.case_sessions(case_id);
create index if not exists sessions_org_case_idx on public.case_sessions(organization_id, case_id);
create index if not exists handoffs_assigned_to_idx on public.handoffs(assigned_to) where assigned_to is not null;
create index if not exists handoffs_case_id_idx on public.handoffs(case_id) where case_id is not null;
create index if not exists handoffs_org_case_idx on public.handoffs(organization_id, case_id);
create index if not exists handoffs_conversation_id_idx on public.handoffs(conversation_id) where conversation_id is not null;
create index if not exists handoffs_org_conversation_idx on public.handoffs(organization_id, conversation_id);
create index if not exists chunks_org_document_idx on public.knowledge_chunks(organization_id, document_id);
create index if not exists documents_approved_by_idx on public.knowledge_documents(approved_by) where approved_by is not null;
create index if not exists documents_created_by_idx on public.knowledge_documents(created_by) where created_by is not null;
create index if not exists cases_customer_id_idx on public.service_cases(customer_id) where customer_id is not null;
create index if not exists cases_org_customer_idx on public.service_cases(organization_id, customer_id);
create index if not exists cases_product_id_idx on public.service_cases(product_id) where product_id is not null;
create index if not exists cases_org_product_idx on public.service_cases(organization_id, product_id);
create index if not exists cases_store_id_idx on public.service_cases(store_id) where store_id is not null;
create index if not exists cases_org_store_idx on public.service_cases(organization_id, store_id);

commit;
