import { z } from 'zod';
import { searchKnowledge } from './knowledge-runtime';
import type { KnowledgeEnvironment } from './knowledge-hybrid';

export const ragPreviewInputSchema = z
  .object({
    query: z.string().trim().min(3).max(500),
    ragResults: z.number().int().min(1).max(3),
    ragMinAnchors: z.number().int().min(1).max(3),
    allowEmbedding: z.boolean().default(false),
  })
  .strict();

export function ragConfiguration(env: KnowledgeEnvironment) {
  const published = Boolean(
    env.SUPABASE_URL?.trim() &&
    env.SUPABASE_SECRET_KEY?.trim() &&
    env.SUPABASE_ORGANIZATION_ID?.trim(),
  );
  const mode =
    env.RAG_MODE === 'hybrid'
      ? ('hybrid' as const)
      : published
        ? ('lexical' as const)
        : ('demo' as const);
  return {
    mode,
    minAnchorsApplies: mode === 'demo',
    previewMayUseEmbedding: mode === 'hybrid',
    locale: mode === 'hybrid' ? (env.RAG_CORPUS_LOCALE ?? 'fr-FR') : 'fr-FR',
    market: mode === 'hybrid' ? (env.RAG_MARKET ?? 'GLOBAL') : null,
  };
}

/** Uses the chat retrieval path, its published-source guards and shared embedding quota. */
export async function previewKnowledge(
  env: KnowledgeEnvironment,
  input: z.infer<typeof ragPreviewInputSchema>,
) {
  const started = performance.now();
  const result = await searchKnowledge(
    { ...env, RAG_RESULTS: input.ragResults, RAG_MIN_ANCHORS: input.ragMinAnchors },
    input.query,
  );
  return {
    documents: result.articles.map((article, index) => ({
      id: article.id,
      title: article.title,
      version: article.version,
      effective: article.effective,
      body: article.body,
      evidence: result.evidence?.[index] ?? null,
    })),
    diagnostics: {
      mode: ragConfiguration(env).mode,
      scope: result.scope,
      outcome:
        result.retrieval?.outcome ??
        (result.scope === 'supabase_unavailable'
          ? 'unavailable'
          : result.articles.length
            ? 'matched'
            : 'no_match'),
      retrievedAt: result.provenance?.retrievedAt ?? new Date().toISOString(),
      latencyMs: Math.round(performance.now() - started),
      fallbackReason: result.retrieval?.fallbackReason ?? null,
      embeddingCalls: result.retrieval?.embedding.calls ?? 0,
      embeddingError: result.retrieval?.embedding.error ?? null,
    },
  };
}

export type RagConfiguration = ReturnType<typeof ragConfiguration>;
export type RagPreview = Awaited<ReturnType<typeof previewKnowledge>>;
