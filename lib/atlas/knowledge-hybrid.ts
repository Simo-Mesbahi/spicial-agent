import { z } from 'zod';
import type { Database } from './api';
import {
  SupabaseRequestError,
  supabaseRequest,
  supabaseSettings,
  type SupabaseRuntimeEnv,
} from './supabase';
import {
  embedTexts,
  embeddingSettings,
  embeddingSpace,
  embeddingTrace,
  digest,
  type EmbeddingEnv,
} from './embedding-runtime';
import { ProviderError } from './provider-runtime';
import type { KnowledgeSearchResult } from './knowledge-runtime';
export type HybridSettings = EmbeddingEnv & {
  RAG_MODE?: string;
  RAG_CORPUS_LOCALE?: string;
  RAG_MARKET?: string;
  RAG_MIN_SIMILARITY?: string;
  RAG_MIN_LEXICAL_SCORE?: string;
  RAG_EVAL_VECTOR_CANDIDATE_FLOOR?: string;
  RAG_EVAL_VECTOR_PROBE?: string;
  RAG_EVAL_REQUIRE_EMBEDDING?: string;
  RAG_RPC_TIMEOUT_MS?: string;
  RAG_RPC_RETRY_TIMEOUT_MS?: string;
  RAG_RPC_MAX_RETRIES?: string;
  RAG_RPC_RETRY_BACKOFF_MS?: string;
};
export type KnowledgeEnvironment = SupabaseRuntimeEnv &
  HybridSettings & { DB?: Database; RAG_RESULTS?: number; RAG_MIN_ANCHORS?: number };
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable();
export const candidateSchema = z
  .object({
    organization_id: z.string().uuid(),
    document_id: z.string().uuid(),
    series_id: z.string().uuid(),
    revision: z.number().int().positive(),
    status: z.literal('published'),
    chunk_id: z.string().uuid(),
    title: z.string().min(1).max(240),
    category: z.string().min(1).max(120),
    version: z.string().min(1).max(80),
    locale: z.string().max(12),
    market: z.string().max(16),
    effective_from: date,
    effective_until: date,
    chunk_ordinal: z.number().int().nonnegative(),
    content: z.string().min(1).max(4000),
    content_hash: z.string().regex(/^[a-f0-9]{64}$/),
    channel: z.enum(['lexical', 'vector']),
    rank: z.number().finite().nonnegative(),
  })
  .strict();
type Candidate = z.infer<typeof candidateSchema>;
function numeric(value: string | undefined, fallback: number, min: number, max: number) {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new ProviderError('configuration');
  return n;
}
async function reserveEmbedding(env: KnowledgeEnvironment) {
  const limit = Math.floor(numeric(env.EMBEDDING_DAILY_LIMIT, 100, 0, 10000)),
    now = Date.now();
  if (!limit || !env.DB) return false;
  const row = await env.DB.prepare(
    `INSERT INTO rate_buckets(id,count,expires_at) VALUES ('embedding-global',1,?)
    ON CONFLICT(id) DO UPDATE SET count=CASE WHEN expires_at<=? THEN 1 ELSE count+1 END,
    expires_at=CASE WHEN expires_at<=? THEN ? ELSE expires_at END WHERE count<? OR expires_at<=? RETURNING count`,
  )
    .bind(now + 86400000, now, now, now + 86400000, limit, now)
    .first();
  return Boolean(row);
}
/** RRF compares ranks, never the incompatible lexical and cosine score scales. */
export function fuseCandidates(rows: Candidate[], minLexical: number, minSimilarity: number) {
  const documents = new Map<
    string,
    {
      row: Candidate;
      score: number;
      channels: Set<string>;
      lexicalScore: number | null;
      similarity: number | null;
      lexicalChunkId: string | null;
      vectorChunkId: string | null;
    }
  >();
  for (const channel of ['lexical', 'vector'] as const) {
    const seen = new Set<string>();
    const ranked = rows
      .filter(
        (r) =>
          r.channel === channel && r.rank >= (channel === 'lexical' ? minLexical : minSimilarity),
      )
      .sort((a, b) => b.rank - a.rank || a.chunk_id.localeCompare(b.chunk_id));
    let rank = 0;
    for (const row of ranked) {
      if (seen.has(row.document_id)) continue;
      seen.add(row.document_id);
      rank++;
      const found = documents.get(row.document_id) ?? {
        row,
        score: 0,
        channels: new Set<string>(),
        lexicalScore: null,
        similarity: null,
        lexicalChunkId: null,
        vectorChunkId: null,
      };
      found.score += 1 / (60 + rank);
      found.channels.add(channel);
      if (channel === 'lexical') {
        found.lexicalScore = row.rank;
        found.lexicalChunkId = row.chunk_id;
      } else {
        found.similarity = row.rank;
        found.vectorChunkId = row.chunk_id;
      }
      documents.set(row.document_id, found);
    }
  }
  // Agreement between independent channels is the primary deterministic reranker.
  return [...documents.values()].sort(
    (a, b) =>
      b.score - a.score ||
      b.channels.size - a.channels.size ||
      a.row.document_id.localeCompare(b.row.document_id),
  );
}
function hybridRpcPolicy(env: KnowledgeEnvironment) {
  const timeoutMs = numeric(env.RAG_RPC_TIMEOUT_MS, 5000, 2500, 10000);
  const retryTimeoutMs = numeric(
    env.RAG_RPC_RETRY_TIMEOUT_MS,
    Math.min(10000, timeoutMs * 2),
    timeoutMs,
    10000,
  );
  const maxRetries = numeric(env.RAG_RPC_MAX_RETRIES, 1, 0, 1);
  const retryBackoffMs = numeric(env.RAG_RPC_RETRY_BACKOFF_MS, 1000, 0, 5000);
  if (![timeoutMs, retryTimeoutMs, maxRetries, retryBackoffMs].every(Number.isInteger))
    throw new ProviderError('configuration');
  return { timeoutMs, retryTimeoutMs, maxRetries, retryBackoffMs };
}

function normalizedBackendFailure(error: unknown) {
  if (!(error instanceof SupabaseRequestError)) return 'request_failed' as const;
  if (
    error.code === 'invalid_upstream_response' ||
    error.code === 'upstream_redirect_blocked'
  )
    return 'request_failed' as const;
  if (error.code === 'upstream_timeout') return 'timeout' as const;
  if (error.code === 'upstream_unreachable') return 'network' as const;
  if (error.status === 429) return 'rate_limited' as const;
  if ([408, 502, 503, 504].includes(error.status)) return 'unavailable' as const;
  return 'request_failed' as const;
}

function retryableHybridRpcFailure(error: unknown) {
  if (!(error instanceof SupabaseRequestError)) return false;
  if (
    error.code === 'invalid_upstream_response' ||
    error.code === 'upstream_redirect_blocked'
  )
    return false;
  return (
    error.code === 'upstream_timeout' ||
    error.code === 'upstream_unreachable' ||
    [408, 429, 502, 503, 504].includes(error.status)
  );
}

async function hybridCandidatesRequest(
  env: KnowledgeEnvironment,
  body: Record<string, unknown>,
  backend: NonNullable<KnowledgeSearchResult['retrieval']>['backend'],
  policy: ReturnType<typeof hybridRpcPolicy>,
) {
  for (let attempt = 0; ; attempt++) {
    const attemptTimeoutMs = attempt === 0 ? policy.timeoutMs : policy.retryTimeoutMs;
    backend.calls++;
    backend.attemptTimeoutMs.push(attemptTimeoutMs);
    try {
      const result = await supabaseRequest<unknown>(
        env,
        '/rest/v1/rpc/knowledge_hybrid_candidates',
        {
          mode: { kind: 'privileged' },
          method: 'POST',
          timeoutMs: attemptTimeoutMs,
          body,
        },
      );
      backend.error = null;
      return result;
    } catch (error) {
      backend.error = normalizedBackendFailure(error);
      if (!retryableHybridRpcFailure(error) || attempt >= policy.maxRetries) throw error;
      backend.retries++;
      const delay = Math.min(5000, policy.retryBackoffMs * 2 ** attempt);
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

export async function searchHybridKnowledge(
  env: KnowledgeEnvironment,
  query: string,
  limit: number,
): Promise<KnowledgeSearchResult> {
  const started = performance.now(),
    embedding = embeddingTrace(),
    rpcPolicy = hybridRpcPolicy(env);
  const telemetry: NonNullable<KnowledgeSearchResult['retrieval']> = {
    mode: 'hybrid',
    outcome: 'unavailable',
    fallbackReason: null,
    candidateCount: 0,
    latencyMs: 0,
    embedding,
    backend: {
      calls: 0,
      retries: 0,
      timeoutMs: rpcPolicy.timeoutMs,
      retryTimeoutMs: rpcPolicy.retryTimeoutMs,
      attemptTimeoutMs: [],
      error: null,
    },
  };
  const result: KnowledgeSearchResult = {
    articles: [],
    evidence: [],
    scope: 'supabase_unavailable',
    retrieval: telemetry,
  };
  try {
    supabaseSettings(env);
    query = query.trim().slice(0, 500);
    if (query.length < 2) {
      result.scope = 'supabase_published';
      telemetry.outcome = 'abstain';
      result.provenance = {
        organizationId: env.SUPABASE_ORGANIZATION_ID!,
        retrievedAt: new Date().toISOString(),
        locale: env.RAG_CORPUS_LOCALE ?? 'fr-FR',
        market: env.RAG_MARKET ?? 'GLOBAL',
      };
      return result;
    }
    const locale = env.RAG_CORPUS_LOCALE ?? 'fr-FR',
      market = env.RAG_MARKET ?? 'GLOBAL';
    if (!/^[a-z]{2}(?:-[A-Z]{2})?$/.test(locale) || !/^[A-Z0-9][A-Z0-9_-]{1,15}$/.test(market))
      throw new ProviderError('configuration');
    const minSimilarity = numeric(env.RAG_MIN_SIMILARITY, 0.7, 0, 1),
      minLexical = numeric(env.RAG_MIN_LEXICAL_SCORE, 3, 0, 100),
      evaluationProbe = env.RAG_EVAL_VECTOR_PROBE === 'true',
      candidateFloor = evaluationProbe
        ? numeric(env.RAG_EVAL_VECTOR_CANDIDATE_FLOOR, minSimilarity, 0, minSimilarity)
        : minSimilarity;
    let vector: number[] | null = null,
      space: string | null = null;
    try {
      const settings = embeddingSettings(env);
      embedding.provider = settings.provider;
      embedding.model = settings.model;
      space = await embeddingSpace(env);
      if (await reserveEmbedding(env))
        vector = (await embedTexts(env, [query.slice(0, 500)], 'query', embedding))[0];
      else embedding.error = 'budget_exhausted';
    } catch (error) {
      embedding.error = error instanceof ProviderError ? error.reason : 'configuration';
    }
    telemetry.fallbackReason = embedding.error;
    // Qualification can require a real vector result. In that mode there is no value in
    // spending backend time on lexical degradation after a transient embedding failure;
    // the evaluator will retry the embedding within an explicit global budget.
    if (env.RAG_EVAL_REQUIRE_EMBEDDING === 'true' && !vector) return result;
    const raw = await hybridCandidatesRequest(
      env,
      {
        p_organization_id: env.SUPABASE_ORGANIZATION_ID,
        p_query: query.slice(0, 500),
        p_locale: locale,
        p_market: market,
        p_embedding_space: space,
        p_embedding: vector ? JSON.stringify(vector) : null,
        p_min_similarity: candidateFloor,
      },
      telemetry.backend,
      rpcPolicy,
    );
    const parsed = z.array(candidateSchema).max(16).safeParse(raw);
    if (!parsed.success) throw new ProviderError('invalid_upstream_response');
    const today = new Date().toISOString().slice(0, 10),
      rows = parsed.data;
    telemetry.candidateCount = rows.length;
    const revisions = new Map<string, string>();
    for (const row of rows) {
      if (
        row.organization_id !== env.SUPABASE_ORGANIZATION_ID ||
        row.locale !== locale ||
        ![market, 'GLOBAL'].includes(row.market) ||
        (row.effective_from && row.effective_from > today) ||
        (row.effective_until && row.effective_until < today) ||
        row.content_hash !== (await digest(row.content)) ||
        (row.channel === 'vector' && (!vector || row.rank > 1.000001))
      )
        throw new ProviderError('invalid_upstream_response');
      const prior = revisions.get(row.series_id),
        current = `${row.document_id}:${row.version}:${row.revision}`;
      if (prior && prior !== current) {
        telemetry.outcome = 'conflicting_versions';
        result.scope = 'supabase_published';
        result.provenance = {
          organizationId: env.SUPABASE_ORGANIZATION_ID!,
          retrievedAt: new Date().toISOString(),
          locale,
          market,
        };
        return result;
      }
      revisions.set(row.series_id, current);
    }
    const safeRows = rows.filter(
      (row) =>
        !/(?:ignore|disregard|ignorez|ignoriere|ignora|تجاهل).{0,80}(?:instructions?|rules?|règles?|regles?|anweisungen|regeln|instrucciones|تعليمات|قواعد)|system\s*prompt|<\|(?:im_start|system)|\[INST\]|(?:reveal|divulgue|expose).{0,60}(?:api.?key|clé.?api|secret)/iu.test(
          row.content,
        ),
    );
    if (safeRows.length !== rows.length)
      telemetry.fallbackReason = 'document_instruction_quarantined';
    if (evaluationProbe) {
      telemetry.evaluationProbe = {
        candidateFloor,
        vectorCandidates: safeRows
          .filter((row) => row.channel === 'vector')
          .sort((a, b) => b.rank - a.rank || a.document_id.localeCompare(b.document_id))
          .slice(0, 8)
          .map((row) => ({
            documentId: row.document_id,
            title: row.title,
            similarity: row.rank,
          })),
      };
    }
    const selected = fuseCandidates(safeRows, minLexical, minSimilarity).slice(0, limit);
    result.scope = 'supabase_published';
    result.provenance = {
      organizationId: env.SUPABASE_ORGANIZATION_ID!,
      retrievedAt: new Date().toISOString(),
      locale,
      market,
    };
    telemetry.outcome = selected.length ? (vector ? 'hybrid_hit' : 'lexical_hit') : 'abstain';
    result.articles = selected.map(({ row }) => ({
      id: row.document_id,
      title: row.title,
      category: row.category,
      version: row.version,
      effective: row.effective_from ?? '',
      tags: '',
      body: row.content,
    }));
    result.evidence = selected.map(
      ({ row, score, channels, lexicalScore, similarity, lexicalChunkId, vectorChunkId }) => ({
        documentId: row.document_id,
        chunkId: row.chunk_id,
        version: row.version,
        score,
        locale: row.locale,
        market: row.market,
        contentHash: row.content_hash,
        effectiveFrom: row.effective_from,
        effectiveUntil: row.effective_until,
        channels: [...channels],
        lexicalScore,
        similarity,
        lexicalChunkId,
        vectorChunkId,
        embeddingSpace: vector ? space : null,
      }),
    );
    return result;
  } catch (error) {
    telemetry.fallbackReason =
      error instanceof ProviderError
        ? error.reason
        : error instanceof SupabaseRequestError
          ? telemetry.backend.error ?? 'request_failed'
          : 'retrieval_unavailable';
    return result;
  } finally {
    telemetry.latencyMs = Math.round(performance.now() - started);
  }
}
