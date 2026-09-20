import { z } from 'zod';

export const languages = ['fr', 'en', 'de', 'es', 'ar'] as const;
export const intents = [
  'casual',
  'assistant_meta',
  'information',
  'case_lookup',
  'switch_case',
  'clarification',
  'human_handoff',
  'action',
  'off_topic',
  'preference',
  'unknown',
] as const;
export const guidanceModes = [
  'none',
  'soft_offer',
  'clarify',
  'business_direct',
  'respect_decline',
  'handoff',
] as const;
export const topics = [
  'repair',
  'return',
  'refund',
  'delivery',
  'warranty',
  'quote',
  'payment',
  'invoice',
  'general',
] as const;
export const referenceModes = ['none', 'active', 'select', 'other', 'ambiguous'] as const;
export const understandingSchema = z
  .object({
    language: z.enum(languages),
    preferredResponseLanguage: z.enum(languages).nullable(),
    intent: z.enum(intents),
    subIntent: z.enum([
      'general',
      'status',
      'eta',
      'reason',
      'procedure',
      'capabilities',
      'identity',
      'wellbeing',
    ]),
    topic: z.enum(topics).nullable(),
    guidance: z.enum(guidanceModes),
    guidancePreference: z.enum(['keep', 'decline', 'resume']),
    reference: z.enum(referenceModes),
    selectedCaseId: z.string().min(1).max(80).nullable(),
    referencedProduct: z.string().min(1).max(100).nullable(),
    referencesPreviousTurn: z.boolean(),
    conversationRepair: z.boolean(),
    requiresCase: z.boolean(),
    requiresKnowledge: z.boolean(),
    requiresClarification: z.boolean(),
    requiresHuman: z.boolean(),
    confidence: z.number().min(0).max(1),
    style: z
      .object({
        length: z.enum(['keep', 'short', 'normal']),
        emoji: z.enum(['keep', 'allow', 'avoid']),
      })
      .strict(),
    retrievalQuery: z.string().min(1).max(240).nullable(),
    response: z.string().max(1600),
  })
  .strict();
export type Understanding = z.infer<typeof understandingSchema>;

// The provider schema is deliberately portable (no model-specific SDK/dependency).
// All fields are required, including nullable fields, and every object is closed.
const enumeration = (values: readonly string[]) => ({ type: 'string', enum: values });
const nullable = (schema: object) => ({ anyOf: [schema, { type: 'null' }] });
const object = (properties: Record<string, unknown>) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const bool = { type: 'boolean' };
export const understandingJsonSchema = object({
  language: enumeration(languages),
  preferredResponseLanguage: nullable(enumeration(languages)),
  intent: enumeration(intents),
  subIntent: enumeration(understandingSchema.shape.subIntent.options),
  topic: nullable(enumeration(topics)),
  guidance: enumeration(guidanceModes),
  guidancePreference: enumeration(['keep', 'decline', 'resume']),
  reference: enumeration(referenceModes),
  selectedCaseId: nullable({ type: 'string', minLength: 1, maxLength: 80 }),
  referencedProduct: nullable({ type: 'string', minLength: 1, maxLength: 100 }),
  referencesPreviousTurn: bool,
  conversationRepair: bool,
  requiresCase: bool,
  requiresKnowledge: bool,
  requiresClarification: bool,
  requiresHuman: bool,
  confidence: { type: 'number', minimum: 0, maximum: 1 },
  style: object({
    length: enumeration(['keep', 'short', 'normal']),
    emoji: enumeration(['keep', 'allow', 'avoid']),
  }),
  retrievalQuery: nullable({ type: 'string', minLength: 1, maxLength: 240 }),
  response: { type: 'string', maxLength: 1600 },
});
