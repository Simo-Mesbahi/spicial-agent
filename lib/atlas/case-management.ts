import { z } from 'zod';

export const caseServiceTypes = ['sav', 'customer_service'] as const;
export type CaseServiceType = (typeof caseServiceTypes)[number];

export const caseKinds = [
  'repair',
  'exchange',
  'refund',
  'complaint',
  'delivery',
  'account',
  'other',
] as const;
export type CaseKind = (typeof caseKinds)[number];

export const caseStatuses = [
  'opened',
  'deposited',
  'received',
  'diagnosis',
  'waiting_part',
  'quote_pending',
  'repairing',
  'repaired',
  'exchanged',
  'shipping',
  'transit',
  'ready',
  'delivered',
  'refund_pending',
  'refunded',
  'complaint_review',
  'resolved',
  'cancelled',
  'delayed',
] as const;
export type CaseStatus = (typeof caseStatuses)[number];

export const warrantyStatuses = ['covered', 'not_covered', 'partial', 'unknown'] as const;
export type WarrantyStatus = (typeof warrantyStatuses)[number];

export const adminRoles = [
  'super_admin',
  'sav_manager',
  'sc_manager',
  'adviser',
  'analyst',
] as const;
export type AdminRole = (typeof adminRoles)[number];

export const caseServiceLabels: Record<CaseServiceType, string> = {
  sav: 'SAV',
  customer_service: 'Service client',
};

export const caseKindLabels: Record<CaseKind, string> = {
  repair: 'Réparation',
  exchange: 'Échange',
  refund: 'Remboursement',
  complaint: 'Réclamation',
  delivery: 'Livraison',
  account: 'Compte / accès',
  other: 'Autre demande',
};

export const caseStatusLabels: Record<CaseStatus, string> = {
  opened: 'Ouvert',
  deposited: 'Déposé',
  received: 'Reçu au SAV',
  diagnosis: 'Diagnostic',
  waiting_part: 'Pièce attendue',
  quote_pending: 'Devis à confirmer',
  repairing: 'En réparation',
  repaired: 'Réparé',
  exchanged: 'Échangé',
  shipping: 'Expédition',
  transit: 'En transit',
  ready: 'Disponible',
  delivered: 'Livré',
  refund_pending: 'Remboursement en cours',
  refunded: 'Remboursé',
  complaint_review: 'Réclamation analysée',
  resolved: 'Résolu',
  cancelled: 'Annulé',
  delayed: 'Retard signalé',
};

const savTransitions: Record<CaseStatus, readonly CaseStatus[]> = {
  opened: ['deposited', 'received', 'diagnosis', 'quote_pending', 'refund_pending', 'cancelled', 'delayed'],
  deposited: ['received', 'diagnosis', 'cancelled', 'delayed'],
  received: ['diagnosis', 'repairing', 'quote_pending', 'exchanged', 'refund_pending', 'cancelled', 'delayed'],
  diagnosis: ['waiting_part', 'quote_pending', 'repairing', 'exchanged', 'refund_pending', 'cancelled', 'delayed'],
  waiting_part: ['diagnosis', 'repairing', 'cancelled', 'delayed'],
  quote_pending: ['repairing', 'refund_pending', 'cancelled', 'delayed'],
  repairing: ['waiting_part', 'repaired', 'cancelled', 'delayed'],
  repaired: ['ready', 'shipping', 'delivered', 'resolved', 'delayed'],
  exchanged: ['resolved', 'delivered'],
  shipping: ['transit', 'ready', 'delivered', 'delayed'],
  transit: ['ready', 'delivered', 'delayed'],
  ready: ['delivered', 'exchanged', 'refunded', 'resolved'],
  delivered: ['resolved'],
  refund_pending: ['refunded', 'cancelled', 'delayed'],
  refunded: ['resolved'],
  complaint_review: [],
  resolved: [],
  cancelled: [],
  delayed: ['received', 'diagnosis', 'waiting_part', 'quote_pending', 'repairing', 'repaired', 'shipping', 'transit', 'ready', 'refund_pending', 'cancelled', 'resolved'],
};

const serviceTransitions: Record<CaseStatus, readonly CaseStatus[]> = {
  opened: ['complaint_review', 'refund_pending', 'resolved', 'cancelled', 'delayed'],
  complaint_review: ['refund_pending', 'resolved', 'cancelled', 'delayed'],
  refund_pending: ['refunded', 'resolved', 'cancelled', 'delayed'],
  refunded: ['resolved'],
  delayed: ['complaint_review', 'refund_pending', 'resolved', 'cancelled'],
  resolved: [],
  cancelled: [],
  deposited: [],
  received: [],
  diagnosis: [],
  waiting_part: [],
  quote_pending: [],
  repairing: [],
  repaired: [],
  exchanged: [],
  shipping: [],
  transit: [],
  ready: [],
  delivered: [],
};

export function allowedNextStatuses(
  serviceType: CaseServiceType,
  status: CaseStatus,
): readonly CaseStatus[] {
  return (serviceType === 'sav' ? savTransitions : serviceTransitions)[status] ?? [];
}

export function canManageCase(role: AdminRole | null | undefined, serviceType: CaseServiceType) {
  return (
    role === 'super_admin' ||
    (role === 'sav_manager' && serviceType === 'sav') ||
    (role === 'sc_manager' && serviceType === 'customer_service')
  );
}

export function serviceKinds(serviceType: CaseServiceType): readonly CaseKind[] {
  return serviceType === 'sav'
    ? ['repair', 'exchange', 'refund', 'delivery', 'other']
    : ['complaint', 'refund', 'account', 'other'];
}

const nullableUuid = z.string().uuid().nullable().default(null);
const nullableText = (max: number) => z.string().trim().max(max).nullable().default(null);
const nullableMoney = z.number().int().min(0).max(100_000_000).nullable().default(null);

export const caseCreateInputSchema = z
  .object({
    organizationId: z.string().uuid(),
    serviceType: z.enum(caseServiceTypes),
    kind: z.enum(caseKinds),
    title: z.string().trim().min(2).max(180),
    description: z.string().max(6000).default(''),
    customerId: nullableUuid,
    customer: z
      .object({
        externalId: nullableText(160),
        firstName: nullableText(160),
        lastName: nullableText(160),
        email: z.string().trim().email().max(320).nullable().default(null),
        phone: nullableText(80),
      })
      .strict()
      .nullable()
      .default(null),
    productId: nullableUuid,
    product: z
      .object({
        externalId: nullableText(160),
        sku: nullableText(120),
        name: z.string().trim().min(1).max(240),
        category: nullableText(160),
        serialNumber: nullableText(160),
      })
      .strict()
      .nullable()
      .default(null),
    storeId: nullableUuid,
    warrantyStatus: z.enum(warrantyStatuses).default('unknown'),
    warrantyLabel: nullableText(240),
    quoteCents: nullableMoney,
    refundCents: nullableMoney,
    currency: z.string().trim().regex(/^[A-Z]{3}$/).default('EUR'),
    deliveryMode: nullableText(240),
    estimatedAt: z.string().datetime({ offset: true }).nullable().default(null),
    requestId: z.string().regex(/^[a-zA-Z0-9-]{16,80}$/),
  })
  .strict()
  .superRefine((value, context) => {
    if (!serviceKinds(value.serviceType).includes(value.kind)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['kind'],
        message: 'Type de dossier incompatible avec le service.',
      });
    }
    if (value.customerId && value.customer) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['customer'],
        message: 'Choisissez un client existant ou créez-en un, pas les deux.',
      });
    }
    if (value.productId && value.product) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['product'],
        message: 'Choisissez un produit existant ou créez-en un, pas les deux.',
      });
    }
  });

export const caseUpdateInputSchema = z
  .object({
    organizationId: z.string().uuid(),
    caseId: z.string().uuid(),
    expectedVersion: z.number().int().positive(),
    title: z.string().trim().min(2).max(180),
    description: z.string().max(6000),
    customerId: nullableUuid,
    productId: nullableUuid,
    storeId: nullableUuid,
    warrantyStatus: z.enum(warrantyStatuses),
    warrantyLabel: nullableText(240),
    quoteCents: nullableMoney,
    refundCents: nullableMoney,
    currency: z.string().trim().regex(/^[A-Z]{3}$/),
    deliveryMode: nullableText(240),
    estimatedAt: z.string().datetime({ offset: true }).nullable(),
    requestId: z.string().regex(/^[a-zA-Z0-9-]{16,80}$/),
  })
  .strict();

export const caseTransitionInputSchema = z
  .object({
    organizationId: z.string().uuid(),
    caseId: z.string().uuid(),
    expectedVersion: z.number().int().positive(),
    status: z.enum(caseStatuses),
    note: z.string().trim().max(2000).default(''),
    customerVisible: z.boolean().default(true),
    requestId: z.string().regex(/^[a-zA-Z0-9-]{16,80}$/),
  })
  .strict();

export const caseAccessRotateInputSchema = z
  .object({
    organizationId: z.string().uuid(),
    caseId: z.string().uuid(),
    expectedVersion: z.number().int().positive(),
    requestId: z.string().regex(/^[a-zA-Z0-9-]{16,80}$/),
  })
  .strict();

export const caseArchiveInputSchema = z
  .object({
    organizationId: z.string().uuid(),
    caseId: z.string().uuid(),
    expectedVersion: z.number().int().positive(),
    reason: z.string().trim().min(3).max(1000),
    requestId: z.string().regex(/^[a-zA-Z0-9-]{16,80}$/),
  })
  .strict();
