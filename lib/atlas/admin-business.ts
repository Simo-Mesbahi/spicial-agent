import { z } from 'zod';
import { caseStatuses } from './case-management';

export const entityKinds = ['customer', 'product', 'store'] as const;
export type EntityKind = (typeof entityKinds)[number];
const nullableText = (length: number) => z.string().trim().max(length).nullable();
const command = {
  organizationId: z.string().uuid(),
  id: z.string().uuid().nullable(),
  expectedRevision: z.number().int().nonnegative(),
  requestId: z.string().uuid(),
};
export const entitySaveSchema = z.discriminatedUnion('kind', [
  z
    .object({
      ...command,
      kind: z.literal('customer'),
      data: z
        .object({
          external_id: nullableText(160),
          first_name: nullableText(160),
          last_name: nullableText(160),
          email: z.string().trim().email().max(320).nullable(),
          phone: nullableText(80),
        })
        .strict()
        .refine(
          (data) => Object.values(data).some((value) => !!value?.trim()),
          'Renseignez au moins une information client.',
        ),
    })
    .strict(),
  z
    .object({
      ...command,
      kind: z.literal('product'),
      data: z
        .object({
          external_id: nullableText(160),
          name: z.string().trim().min(1).max(240),
          sku: nullableText(120),
          category: nullableText(160),
          serial_number: nullableText(160),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...command,
      kind: z.literal('store'),
      data: z
        .object({
          code: z.string().trim().min(1).max(80),
          name: z.string().trim().min(2).max(240),
          city: nullableText(160),
          address: nullableText(1000),
          active: z.boolean(),
        })
        .strict(),
    })
    .strict(),
]);
export const entityRecordSchema = z
  .object({
    id: z.string().uuid(),
    kind: z.enum(entityKinds),
    revision: z.number().int().positive(),
    data: z.record(z.union([z.string().max(2000), z.boolean(), z.null()])),
    linkedCases: z.number().int().nonnegative(),
    canEdit: z.boolean(),
    updatedAt: z.string(),
  })
  .strict();
export type EntityRecord = z.infer<typeof entityRecordSchema>;
export const entityListSchema = z
  .object({
    items: z.array(entityRecordSchema).max(30),
    total: z.number().int().nonnegative(),
    canCreate: z.boolean(),
  })
  .strict();
export type EntityList = z.infer<typeof entityListSchema>;
export const restoreCaseSchema = z
  .object({
    organizationId: z.string().uuid(),
    caseId: z.string().uuid(),
    expectedVersion: z.number().int().positive(),
    reason: z.string().trim().min(3).max(1000),
    requestId: z.string().uuid(),
  })
  .strict();
const batchBase = {
  organizationId: z.string().uuid(),
  requestId: z.string().uuid(),
  items: z
    .array(z.object({ id: z.string().uuid(), version: z.number().int().positive() }).strict())
    .min(1)
    .max(25),
};
export const batchCaseSchema = z
  .discriminatedUnion('action', [
    z
      .object({
        ...batchBase,
        action: z.literal('transition'),
        status: z.enum(caseStatuses),
        note: z.string().trim().max(2000),
        visible: z.boolean(),
      })
      .strict(),
    z
      .object({
        ...batchBase,
        action: z.literal('note'),
        note: z.string().trim().min(3).max(4000),
        visible: z.boolean(),
      })
      .strict(),
    z
      .object({
        ...batchBase,
        action: z.literal('deadline'),
        estimatedAt: z.string().datetime({ offset: true }).nullable(),
      })
      .strict(),
  ])
  .superRefine((value, ctx) => {
    if (new Set(value.items.map((item) => item.id)).size !== value.items.length)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['items'],
        message: 'Un dossier ne peut être sélectionné deux fois.',
      });
  });
export const exportCasesSchema = z
  .object({
    organizationId: z.string().uuid(),
    search: z.string().trim().max(120).default(''),
    service: z.enum(['', 'sav', 'customer_service']).default(''),
    status: z.enum(['', ...caseStatuses]).default(''),
    archive: z.enum(['active', 'archived', 'all']).default('active'),
  })
  .strict();

/** Quote every cell and neutralize spreadsheet formula prefixes, including whitespace. */
export function csv(rows: readonly (readonly unknown[])[]): string {
  return (
    '\ufeff' +
    rows
      .map((row) =>
        row
          .map((value) => {
            let cell = value == null ? '' : String(value);
            if (/^[\s\u0000-\u001f]*[=+\-@]/u.test(cell) || /^[\t\r\n]/u.test(cell))
              cell = "'" + cell;
            return '"' + cell.replaceAll('"', '""') + '"';
          })
          .join(';'),
      )
      .join('\r\n') +
    '\r\n'
  );
}
