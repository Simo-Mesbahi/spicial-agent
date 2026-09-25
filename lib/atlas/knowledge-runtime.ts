import { searchHybridKnowledge, type KnowledgeEnvironment } from './knowledge-hybrid';
import { digest } from './embedding-runtime';
import type { EmbeddingTrace } from './embedding-runtime';
import { z } from 'zod';
import { retrieve, type Article } from './domain';
import {
  SupabaseConfigError,
  SupabaseRequestError,
  supabaseRequest,
  type SupabaseRuntimeEnv,
} from './supabase';

const revalidationRowSchema = z
  .object({
    document_id: z.string().uuid(),
    chunk_id: z.string().uuid(),
    version: z.string().min(1).max(80),
    revision: z.number().int().positive(),
    locale: z.string().min(2).max(12),
    market: z.string().min(2).max(16),
    effective_from: z.string().nullable(),
    effective_until: z.string().nullable(),
    content: z.string().min(1).max(4000),
  })
  .strict();

export class KnowledgeFreshnessError extends Error {
  reason: 'knowledge_changed' | 'knowledge_unavailable';

  constructor(reason: 'knowledge_changed' | 'knowledge_unavailable') {
    super(reason);
    this.reason = reason;
  }
}

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
  provenance?: {
    organizationId: string;
    retrievedAt: string;
    locale: string;
    market: string | null;
  };
  evidence?: {
    documentId: string;
    chunkId: string;
    version: string;
    score: number;
    locale: string;
    market: string;
    contentHash?: string;
    effectiveFrom?: string | null;
    effectiveUntil?: string | null;
    channels?: string[];
    lexicalScore?: number | null;
    similarity?: number | null;
    lexicalChunkId?: string | null;
    vectorChunkId?: string | null;
    embeddingSpace?: string | null;
  }[];
  retrieval?: {
    mode: 'hybrid';
    outcome: string;
    fallbackReason: string | null;
    candidateCount: number;
    latencyMs: number;
    embedding: EmbeddingTrace;
    backend: {
      calls: number;
      retries: number;
      timeoutMs: number;
      retryTimeoutMs: number;
      attemptTimeoutMs: number[];
      error: 'timeout' | 'network' | 'rate_limited' | 'unavailable' | 'request_failed' | null;
    };
    evaluationProbe?: {
      candidateFloor: number;
      vectorCandidates: Array<{
        documentId: string;
        title: string;
        similarity: number;
      }>;
    };
  };
  scope: 'supabase_published' | 'legacy_demo' | 'supabase_unavailable' | 'not_required';
};

function configured(env: SupabaseRuntimeEnv) {
  return Boolean(
    env.SUPABASE_URL?.trim() &&
    env.SUPABASE_SECRET_KEY?.trim() &&
    env.SUPABASE_ORGANIZATION_ID?.trim(),
  );
}

export async function revalidateKnowledgeEvidence(
  env: KnowledgeEnvironment,
  pack: {
    scope: { organizationId: string };
    knowledge: {
      status: 'not_requested' | 'available' | 'no_match' | 'unavailable';
      sources: Array<{
        documentId: string;
        chunkId: string;
        version: string;
        title: string;
        content: string;
        contentHash: string;
        locale: string;
        market: string;
        effectiveFrom: string | null;
        effectiveUntil: string | null;
        score: number;
      }>;
    };
  },
): Promise<KnowledgeSearchResult> {
  const sources = pack.knowledge.sources;
  if (!sources.length) {
    if (pack.knowledge.status === 'unavailable')
      throw new KnowledgeFreshnessError('knowledge_unavailable');
    return { articles: [], scope: 'not_required' };
  }
  if (
    !configured(env) ||
    env.SUPABASE_ORGANIZATION_ID !== pack.scope.organizationId ||
    sources.length > 3
  )
    throw new KnowledgeFreshnessError('knowledge_unavailable');

  let raw: unknown;
  try {
    raw = await supabaseRequest<unknown>(
      env,
      '/rest/v1/rpc/knowledge_revalidate_sources',
      {
        mode: { kind: 'privileged' },
        method: 'POST',
        timeoutMs: 3000,
        body: {
          p_organization_id: pack.scope.organizationId,
          p_sources: sources.map((source) => ({
            document_id: source.documentId,
            chunk_id: source.chunkId,
            version: source.version,
            locale: source.locale,
            market: source.market,
          })),
        },
      },
    );
  } catch (error) {
    if (error instanceof SupabaseConfigError || error instanceof SupabaseRequestError)
      throw new KnowledgeFreshnessError('knowledge_unavailable');
    throw error;
  }

  const parsed = z.array(revalidationRowSchema).max(3).safeParse(raw);
  if (!parsed.success || parsed.data.length !== sources.length)
    throw new KnowledgeFreshnessError('knowledge_changed');

  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  const originalByKey = new Map(
    sources.map((source) => [
      `${source.documentId}:${source.chunkId}`,
      source,
    ]),
  );
  const seen = new Set<string>();

  for (const row of parsed.data) {
    const key = `${row.document_id}:${row.chunk_id}`;
    const source = originalByKey.get(key);
    if (
      !source ||
      seen.has(key) ||
      row.version !== source.version ||
      row.locale !== source.locale ||
      row.market !== source.market ||
      row.effective_from !== source.effectiveFrom ||
      row.effective_until !== source.effectiveUntil ||
      row.content !== source.content ||
      (row.effective_from && row.effective_from > today) ||
      (row.effective_until && row.effective_until < today) ||
      (await digest(row.content)) !== source.contentHash
    )
      throw new KnowledgeFreshnessError('knowledge_changed');
    seen.add(key);
  }

  if (seen.size !== sources.length)
    throw new KnowledgeFreshnessError('knowledge_changed');

  const rowsByKey = new Map(
    parsed.data.map((row) => [
      `${row.document_id}:${row.chunk_id}`,
      row,
    ]),
  );
  return {
    provenance: {
      organizationId: pack.scope.organizationId,
      retrievedAt: new Date(now).toISOString(),
      locale: sources[0].locale,
      market: null,
    },
    evidence: sources.map((source) => {
      const row = rowsByKey.get(`${source.documentId}:${source.chunkId}`)!;
      return {
        documentId: source.documentId,
        chunkId: source.chunkId,
        version: source.version,
        score: source.score,
        locale: source.locale,
        market: source.market,
        effectiveFrom: row.effective_from,
        effectiveUntil: row.effective_until,
        contentHash: source.contentHash,
      };
    }),
    articles: sources.map((source) => ({
      id: source.documentId,
      title: source.title,
      category: 'verified',
      version: source.version,
      effective: source.effectiveFrom ?? '',
      tags: '',
      body: source.content,
    })),
    scope: 'supabase_published',
  };
}

export async function searchKnowledge(
  env: KnowledgeEnvironment,
  query: string,
): Promise<KnowledgeSearchResult> {
  const limit = Number.isFinite(env.RAG_RESULTS)
    ? Math.max(1, Math.min(Math.floor(env.RAG_RESULTS ?? 3), 8))
    : 3;

  if (env.RAG_MODE === 'hybrid') return searchHybridKnowledge(env, query, limit);

  if (!configured(env))
    return {
      articles: retrieve(query, limit, env.RAG_MIN_ANCHORS),
      scope: 'legacy_demo',
    };

  try {
    const raw = await supabaseRequest<unknown>(env, '/rest/v1/rpc/knowledge_search', {
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
    });
    const parsed = z.array(searchRowSchema).max(8).safeParse(raw);
    if (!parsed.success) return { articles: [], scope: 'supabase_unavailable' };

    return {
      provenance: {
        organizationId: env.SUPABASE_ORGANIZATION_ID!,
        retrievedAt: new Date().toISOString(),
        locale: 'fr-FR',
        market: null,
      },
      evidence: await Promise.all(
        parsed.data.map(async (row) => ({
          documentId: row.document_id,
          chunkId: row.chunk_id,
          version: row.version,
          score: row.rank,
          locale: row.locale,
          market: row.market,
          effectiveFrom: row.effective_from,
          effectiveUntil: row.effective_until,
          contentHash: await digest(row.content),
        })),
      ),
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
