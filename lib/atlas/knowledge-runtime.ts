import { z } from 'zod';
import { retrieve, type Article } from './domain';
import {
  SupabaseConfigError,
  SupabaseRequestError,
  supabaseRequest,
  type SupabaseRuntimeEnv,
} from './supabase';

const searchRowSchema = z.object({
  document_id: z.string().uuid(),
  chunk_id: z.string().uuid(),
  title: z.string().min(1).max(240),
  category: z.string().min(1).max(120),
  version: z.string().min(1).max(80),
  locale: z.string().min(2).max(12),
  market: z.string().min(2).max(16),
  effective_from: z.string().nullable(),
  effective_until: z.string().nullable(),
  chunk_ordinal: z.number().int().nonnegative(),
  content: z.string().min(1).max(4000),
  rank: z.number().nonnegative(),
});

export type KnowledgeSearchResult = {
  articles: Article[];
  scope: 'supabase_published' | 'legacy_demo' | 'supabase_unavailable' | 'not_required';
};

function configured(env: SupabaseRuntimeEnv) {
  return Boolean(
    env.SUPABASE_URL?.trim() &&
      env.SUPABASE_SECRET_KEY?.trim() &&
      env.SUPABASE_ORGANIZATION_ID?.trim(),
  );
}

export async function searchKnowledge(
  env: SupabaseRuntimeEnv & { RAG_RESULTS?: number; RAG_MIN_ANCHORS?: number },
  query: string,
): Promise<KnowledgeSearchResult> {
  const limit = Number.isFinite(env.RAG_RESULTS)
    ? Math.max(1, Math.min(Math.floor(env.RAG_RESULTS ?? 3), 8))
    : 3;

  if (!configured(env))
    return {
      articles: retrieve(query, limit, env.RAG_MIN_ANCHORS),
      scope: 'legacy_demo',
    };

  try {
    const raw = await supabaseRequest<unknown>(
      env,
      '/rest/v1/rpc/knowledge_search',
      {
        mode: { kind: 'privileged' },
        method: 'POST',
        timeoutMs: 5000,
        body: {
          p_organization_id: env.SUPABASE_ORGANIZATION_ID,
          p_query: query.slice(0, 500),
          p_limit: limit,
          p_locale: 'fr-FR',
          p_market: null,
        },
      },
    );
    const parsed = z.array(searchRowSchema).max(8).safeParse(raw);
    if (!parsed.success) return { articles: [], scope: 'supabase_unavailable' };

    return {
      articles: parsed.data.map((row) => ({
        id: row.document_id,
        title: row.title,
        category: row.category,
        version: row.version,
        effective: row.effective_from ?? '',
        tags: '',
        body: row.content,
      })),
      scope: 'supabase_published',
    };
  } catch (error) {
    if (error instanceof SupabaseConfigError || error instanceof SupabaseRequestError)
      return { articles: [], scope: 'supabase_unavailable' };
    throw error;
  }
}
