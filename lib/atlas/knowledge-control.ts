import { z } from 'zod';

export const knowledgeStatusSchema = z.enum(['draft', 'review', 'published', 'archived']);
export type KnowledgeStatus = z.infer<typeof knowledgeStatusSchema>;

export const knowledgeDocumentSummarySchema = z.object({
  id: z.string().uuid(),
  series_id: z.string().uuid(),
  revision: z.number().int().positive(),
  lock_version: z.number().int().positive(),
  title: z.string().min(2).max(240),
  category: z.string().min(2).max(120),
  version: z.string().min(1).max(80),
  summary: z.string().max(1000).nullable(),
  locale: z.string().regex(/^[a-z]{2}(?:-[A-Z]{2})?$/),
  market: z.string().regex(/^[A-Z0-9][A-Z0-9_-]{1,15}$/),
  tags: z.array(z.string().max(80)).max(30),
  source_url: z.string().max(2000).nullable(),
  effective_from: z.string().nullable(),
  effective_until: z.string().nullable(),
  status: knowledgeStatusSchema,
  created_by: z.string().uuid().nullable(),
  approved_by: z.string().uuid().nullable(),
  published_at: z.string().nullable(),
  archived_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  chunk_count: z.number().int().nonnegative(),
});

export const knowledgeDocumentSchema = knowledgeDocumentSummarySchema
  .omit({ chunk_count: true })
  .extend({
    content: z.string().min(20).max(120000),
    checksum: z.string().regex(/^[a-f0-9]{64}$/),
    supersedes_id: z.string().uuid().nullable(),
    chunk_count: z.number().int().nonnegative(),
  });

export const knowledgeListSchema = z.object({
  items: z.array(knowledgeDocumentSummarySchema).max(100),
  total: z.number().int().nonnegative(),
  counts: z.object({
    draft: z.number().int().nonnegative(),
    review: z.number().int().nonnegative(),
    published: z.number().int().nonnegative(),
    archived: z.number().int().nonnegative(),
    expired: z.number().int().nonnegative(),
  }),
});

export const knowledgeDraftSchema = z
  .object({
    title: z.string().trim().min(2).max(240),
    category: z.string().trim().min(2).max(120),
    version: z.string().trim().min(1).max(80),
    summary: z.string().trim().max(1000).optional().default(''),
    content: z.string().trim().min(20).max(120000),
    locale: z.string().regex(/^[a-z]{2}(?:-[A-Z]{2})?$/).default('fr-FR'),
    market: z.string().regex(/^[A-Z0-9][A-Z0-9_-]{1,15}$/).default('GLOBAL'),
    tags: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
    sourceUrl: z.string().trim().max(2000).optional().default(''),
    effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
    effectiveUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.effectiveFrom && value.effectiveUntil && value.effectiveUntil < value.effectiveFrom)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['effectiveUntil'],
        message: 'La date de fin doit être postérieure à la date de début.',
      });
  });

export type KnowledgeDraft = z.infer<typeof knowledgeDraftSchema>;

function normalizeWhitespace(value: string) {
  return value.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').trim();
}

/**
 * Deterministic paragraph-aware chunking.
 * Chunks stay below the database/provider limits and overlap enough context
 * to keep procedures coherent across paragraph boundaries.
 */
export function chunkKnowledge(
  content: string,
  maxChars = 1800,
  overlapChars = 220,
): { content: string; metadata: { start: number; end: number } }[] {
  const normalized = normalizeWhitespace(content);
  if (!normalized) return [];
  if (maxChars < 400 || maxChars > 3500 || overlapChars < 0 || overlapChars >= maxChars / 2)
    throw new Error('Paramètres de découpage documentaire invalides.');

  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
  const pieces: string[] = [];
  for (const paragraph of paragraphs.length ? paragraphs : [normalized]) {
    if (paragraph.length <= maxChars) {
      pieces.push(paragraph);
      continue;
    }
    let cursor = 0;
    while (cursor < paragraph.length) {
      let end = Math.min(cursor + maxChars, paragraph.length);
      if (end < paragraph.length) {
        const boundary = paragraph.lastIndexOf(' ', end);
        if (boundary > cursor + Math.floor(maxChars * 0.6)) end = boundary;
      }
      pieces.push(paragraph.slice(cursor, end).trim());
      if (end >= paragraph.length) break;
      cursor = Math.max(end - overlapChars, cursor + 1);
    }
  }

  const chunks: { content: string; metadata: { start: number; end: number } }[] = [];
  let buffer = '';
  let logicalStart = 0;
  let logicalCursor = 0;

  const flush = () => {
    const text = buffer.trim();
    if (!text) return;
    chunks.push({
      content: text,
      metadata: { start: logicalStart, end: logicalStart + text.length },
    });
    const overlap = text.slice(Math.max(0, text.length - overlapChars));
    buffer = overlap;
    logicalStart = Math.max(0, logicalCursor - overlap.length);
  };

  for (const piece of pieces) {
    if (!buffer) logicalStart = logicalCursor;
    const candidate = buffer ? buffer + '\n\n' + piece : piece;
    if (candidate.length > maxChars && buffer) flush();
    buffer = buffer ? buffer + '\n\n' + piece : piece;
    if (buffer.length > maxChars) {
      const oversized = buffer;
      buffer = '';
      for (let cursor = 0; cursor < oversized.length; ) {
        const end = Math.min(cursor + maxChars, oversized.length);
        const text = oversized.slice(cursor, end).trim();
        if (text)
          chunks.push({
            content: text,
            metadata: { start: logicalStart + cursor, end: logicalStart + end },
          });
        if (end >= oversized.length) break;
        cursor = Math.max(end - overlapChars, cursor + 1);
      }
    }
    logicalCursor += piece.length + 2;
  }
  if (buffer.trim()) flush();

  return chunks.slice(0, 200);
}
