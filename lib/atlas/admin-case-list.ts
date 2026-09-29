import { z } from 'zod';
import type { CaseServiceType, CaseStatus } from './case-management';

export const CASE_PAGE_SIZE = 30;
export const caseListWindowSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100),
  offset: z.coerce.number().int().min(0).max(2_147_483_647),
});
export type CaseListFilters = {
  search: string;
  service: '' | CaseServiceType;
  archive: 'active' | 'archived' | 'all';
  status?: '' | CaseStatus;
};

export async function loadAdminCasePage<T>(
  request: (path: string, init: RequestInit) => Promise<{ items: T[]; total: number }>,
  organizationId: string,
  filters: CaseListFilters,
  offset = 0,
  signal?: AbortSignal,
) {
  const window = caseListWindowSchema.parse({ limit: CASE_PAGE_SIZE, offset });
  const params = new URLSearchParams({
    organizationId,
    search: filters.search,
    archive: filters.archive,
    limit: String(window.limit),
    offset: String(window.offset),
  });
  if (filters.service) params.set('serviceType', filters.service);
  if (filters.status) params.set('status', filters.status);
  let result = await request(`/api/production/admin/cases?${params}`, { signal });
  // A concurrent archive may remove the last page. Correct once, without a retry loop.
  if (offset > 0 && offset >= result.total && !signal?.aborted) {
    offset = Math.max(0, Math.floor((result.total - 1) / CASE_PAGE_SIZE) * CASE_PAGE_SIZE);
    params.set('offset', String(offset));
    result = await request(`/api/production/admin/cases?${params}`, { signal });
  }
  return { ...result, offset, filters: { ...filters } };
}
