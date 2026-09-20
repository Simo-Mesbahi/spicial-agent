import { z } from 'zod';

export const caseSchema = z
  .object({
    id: z.string().uuid(),
    reference: z.string().min(6).max(64),
    kind: z.string().min(2).max(40),
    title: z.string().min(2).max(180),
    description: z.string().max(6000),
    status: z.string().min(2).max(50),
    warranty_status: z.string().max(40),
    warranty_label: z.string().max(240).nullable(),
    quote_cents: z.number().int().nonnegative().nullable(),
    refund_cents: z.number().int().nonnegative().nullable(),
    currency: z.string().length(3),
    delivery_mode: z.string().max(240).nullable(),
    estimated_at: z.string().nullable(),
    version: z.number().int().positive(),
    updated_at: z.string(),
    product: z
      .object({
        name: z.string().max(240),
        category: z.string().max(160).nullable(),
        sku: z.string().max(120).nullable(),
      })
      .nullable(),
    store: z.object({ name: z.string().max(240), city: z.string().max(160).nullable() }).nullable(),
    events: z
      .array(
        z.object({
          id: z.string().uuid(),
          status: z.string().max(50),
          label: z.string().max(240),
          details: z.record(z.string(), z.unknown()),
          occurred_at: z.string(),
        }),
      )
      .max(250),
  })
  .strict();
