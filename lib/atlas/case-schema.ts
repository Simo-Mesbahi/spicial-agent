import { z } from 'zod';

export const caseStatuses = [
  'deposited',
  'received',
  'diagnosis',
  'waiting_part',
  'quote_pending',
  'repairing',
  'repaired',
  'replacement',
  'shipping',
  'ready',
  'delivered',
  'preparing',
  'transit',
  'delayed',
  'return_requested',
  'return_approved',
  'return_received',
  'refund_pending',
  'refunded',
  'open',
  'reviewing',
  'resolved',
  'declined',
] as const;
export type CaseStatus = (typeof caseStatuses)[number];

export const caseSchema = z
  .object({
    id: z.string().uuid(),
    reference: z.string().min(6).max(64),
    kind: z.string().min(2).max(40),
    title: z.string().min(2).max(180),
    description: z.string().max(6000),
    status: z.enum(caseStatuses),
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
