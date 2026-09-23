import type { ProviderId } from './model-policy';

const geminiSupportedKeywords = new Set([
  '$id',
  '$defs',
  '$ref',
  '$anchor',
  'type',
  'format',
  'title',
  'description',
  'enum',
  'items',
  'prefixItems',
  'minItems',
  'maxItems',
  'minimum',
  'maximum',
  'anyOf',
  'oneOf',
  'properties',
  'additionalProperties',
  'required',
  'propertyOrdering',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function sanitizeGeminiSchema(value: unknown, mapValues = false): unknown {
  if (Array.isArray(value)) return value.map((item) => sanitizeGeminiSchema(item));
  if (!isRecord(value)) return value;

  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (mapValues) {
      result[key] = sanitizeGeminiSchema(child);
      continue;
    }
    if (!geminiSupportedKeywords.has(key)) continue;
    if (key === 'properties' || key === '$defs') {
      if (isRecord(child)) result[key] = sanitizeGeminiSchema(child, true);
      continue;
    }
    result[key] = sanitizeGeminiSchema(child);
  }
  return result;
}

/**
 * Provider-facing schema only. Local Zod validation remains authoritative and keeps
 * constraints (for example string lengths) that Gemini's documented JSON Schema
 * subset does not support.
 */
export function structuredSchemaForProvider(
  provider: ProviderId,
  schema: Record<string, unknown>,
): Record<string, unknown> {
  if (provider !== 'gemini') return schema;
  return sanitizeGeminiSchema(schema) as Record<string, unknown>;
}
