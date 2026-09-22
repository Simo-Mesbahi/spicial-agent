-- SAV SC Assistant AI — post-deployment hardening for case management.
-- Covers the archive actor foreign key reported by Supabase Performance Advisor.

create index if not exists service_cases_archived_by_idx
  on public.service_cases(archived_by)
  where archived_by is not null;
