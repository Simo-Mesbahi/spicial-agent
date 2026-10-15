import { z } from 'zod';
import {
  batchCaseSchema,
  csv,
  entityKinds,
  entityListSchema,
  entityRecordSchema,
  entitySaveSchema,
  exportCasesSchema,
  restoreCaseSchema,
} from './admin-business';
import {
  caseKindLabels,
  caseServiceLabels,
  caseStatuses,
  caseStatusLabels,
} from './case-management';

type Context = {
  organization: (value: string) => string;
  guard: () => void;
  body: () => Promise<unknown>;
  rpc: (name: string, payload: Record<string, unknown>) => Promise<unknown>;
  json: (body: unknown, status?: number) => Response;
};
const base = '/api/production/admin/operations/business';
const mutationResult = z.object({
  ok: z.literal(true),
  id: z.string().uuid(),
  reference: z.string(),
  version: z.number().int().positive(),
});
const exportResult = z.object({
  items: z
    .array(
      z.object({
        reference: z.string(),
        service_type: z.enum(['sav', 'customer_service']),
        kind: z.enum(['repair', 'exchange', 'refund', 'complaint', 'delivery', 'account', 'other']),
        title: z.string(),
        status: z.enum(caseStatuses),
        customer: z.string().nullable(),
        product: z.string().nullable(),
        store: z.string().nullable(),
        estimated_at: z.string().nullable(),
        updated_at: z.string(),
        archived_at: z.string().nullable(),
      }),
    )
    .max(1000),
  total: z.number().int().min(0).max(1000),
  generatedAt: z.string(),
});

export async function handleAdminBusinessApi(req: Request, context: Context): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.slice(base.length);
  const bad = () =>
    context.json(
      {
        error: 'Paramètres invalides. Vérifiez les champs et réessayez.',
        code: 'invalid_business_input',
      },
      400,
    );
  const invalidResult = () =>
    context.json(
      { error: 'La réponse du service métier est invalide.', code: 'invalid_business_response' },
      502,
    );
  const org = () => context.organization(url.searchParams.get('organizationId') ?? '');
  if (path === '/entities' && req.method === 'GET') {
    const input = z
      .object({
        kind: z.enum(entityKinds),
        search: z.string().trim().max(120),
        offset: z.coerce.number().int().min(0).max(100000),
      })
      .safeParse({
        kind: url.searchParams.get('kind'),
        search: url.searchParams.get('search') ?? '',
        offset: url.searchParams.get('offset') ?? 0,
      });
    if (!input.success) return bad();
    const result = entityListSchema.safeParse(
      await context.rpc('admin_entities', {
        p_organization_id: org(),
        p_kind: input.data.kind,
        p_search: input.data.search,
        p_offset: input.data.offset,
      }),
    );
    return result.success ? context.json(result.data) : invalidResult();
  }
  if (path === '/entity' && req.method === 'GET') {
    const input = z
      .object({ kind: z.enum(entityKinds), id: z.string().uuid() })
      .safeParse({ kind: url.searchParams.get('kind'), id: url.searchParams.get('id') });
    if (!input.success) return bad();
    const result = entityRecordSchema.safeParse(
      await context.rpc('admin_entity_record', {
        p_organization_id: org(),
        p_kind: input.data.kind,
        p_id: input.data.id,
      }),
    );
    return result.success ? context.json(result.data) : invalidResult();
  }
  if (path === '/messages' && req.method === 'GET') {
    const input = z
      .object({
        caseId: z.string().uuid(),
        beforeTime: z.string().datetime({ offset: true }).nullable(),
        beforeId: z.string().uuid().nullable(),
      })
      .refine((value) => (value.beforeTime === null) === (value.beforeId === null))
      .safeParse({
        caseId: url.searchParams.get('caseId'),
        beforeTime: url.searchParams.get('beforeTime'),
        beforeId: url.searchParams.get('beforeId'),
      });
    if (!input.success) return bad();
    const result = z
      .object({
        items: z
          .array(
            z
              .object({
                id: z.string().uuid(),
                role: z.enum(['user', 'assistant']),
                content: z.string().max(12000),
                createdAt: z.string(),
                conversationId: z.string().uuid(),
              })
              .strict(),
          )
          .max(50),
        hasMore: z.boolean(),
        nextCursor: z.object({ createdAt: z.string(), id: z.string().uuid() }).nullable(),
      })
      .strict()
      .safeParse(
        await context.rpc('admin_case_messages', {
          p_organization_id: org(),
          p_case_id: input.data.caseId,
          p_before_time: input.data.beforeTime,
          p_before_id: input.data.beforeId,
        }),
      );
    return result.success ? context.json(result.data) : invalidResult();
  }
  if (req.method === 'POST') {
    context.guard();
    const raw = await context.body();
    if (path === '/entity/save') {
      const input = entitySaveSchema.safeParse(raw);
      if (!input.success) return bad();
      const data = input.data;
      const result = entityRecordSchema.safeParse(
        await context.rpc('admin_save_entity', {
          p_organization_id: context.organization(data.organizationId),
          p_kind: data.kind,
          p_id: data.id,
          p_expected_revision: data.expectedRevision,
          p_data: data.data,
          p_request_id: data.requestId,
        }),
      );
      return result.success ? context.json(result.data, data.id ? 200 : 201) : invalidResult();
    }
    if (path === '/case/restore') {
      const input = restoreCaseSchema.safeParse(raw);
      if (!input.success) return bad();
      const data = input.data;
      const result = mutationResult.safeParse(
        await context.rpc('admin_restore_case', {
          p_organization_id: context.organization(data.organizationId),
          p_case_id: data.caseId,
          p_expected_version: data.expectedVersion,
          p_reason: data.reason,
          p_request_id: data.requestId,
        }),
      );
      return result.success ? context.json(result.data) : invalidResult();
    }
    if (path === '/cases/batch') {
      const input = batchCaseSchema.safeParse(raw);
      if (!input.success) return bad();
      const { organizationId, items, action, requestId, ...payload } = input.data;
      const result = z
        .object({
          ok: z.literal(true),
          count: z.number().int().min(1).max(25),
          items: z
            .array(z.object({ id: z.string().uuid(), version: z.number().int().positive() }))
            .min(1)
            .max(25),
        })
        .strict()
        .safeParse(
          await context.rpc('admin_batch_cases', {
            p_organization_id: context.organization(organizationId),
            p_items: items,
            p_action: action,
            p_payload: payload,
            p_request_id: requestId,
          }),
        );
      return result.success ? context.json(result.data) : invalidResult();
    }
    if (path === '/cases/export') {
      const input = exportCasesSchema.safeParse(raw);
      if (!input.success) return bad();
      const data = input.data;
      const result = exportResult.safeParse(
        await context.rpc('admin_export_cases', {
          p_organization_id: context.organization(data.organizationId),
          p_search: data.search,
          p_service: data.service,
          p_status: data.status,
          p_archive: data.archive,
        }),
      );
      if (
        !result.success ||
        result.data.total !== result.data.items.length ||
        new Set(result.data.items.map((item) => item.reference)).size !== result.data.items.length
      )
        return invalidResult();
      const rows = [
        [
          'Référence',
          'Service',
          'Type',
          'Objet',
          'État',
          'Client',
          'Produit',
          'Magasin',
          'Échéance',
          'Mise à jour',
          'Archivé le',
        ],
        ...result.data.items.map((item) => [
          item.reference,
          caseServiceLabels[item.service_type],
          caseKindLabels[item.kind],
          item.title,
          caseStatusLabels[item.status],
          item.customer,
          item.product,
          item.store,
          item.estimated_at,
          item.updated_at,
          item.archived_at,
        ]),
      ];
      return context.json({
        csv: csv(rows),
        count: result.data.total,
        generatedAt: result.data.generatedAt,
      });
    }
  }
  return context.json({ error: 'Ressource introuvable.', code: 'not_found' }, 404);
}
