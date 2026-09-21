import { z } from 'zod';
import { supabaseRequest, supabaseSettings } from './supabase';
import { embedTexts, embeddingSpace, embeddingTrace, digest } from './embedding-runtime';
import type { KnowledgeEnvironment } from './knowledge-hybrid';
/** Operator-only batch, at most 16 chunks / one embedding request. No publication changes. */
export async function indexKnowledgeBatch(env: KnowledgeEnvironment, maxChunks: number) {
  if (!Number.isInteger(maxChunks) || maxChunks < 1 || maxChunks > 16)
    throw new Error('invalid_index_limit');
  const organizationId = supabaseSettings(env).organizationId,
    space = await embeddingSpace(env),
    trace = embeddingTrace();
  const pending = await supabaseRequest(env, '/rest/v1/rpc/knowledge_embedding_batch', {
    mode: { kind: 'privileged' },
    method: 'POST',
    body: { p_organization_id: organizationId, p_embedding_space: space, p_limit: maxChunks },
  });
  const parsed = z
    .array(
      z
        .object({
          chunk_id: z.string().uuid(),
          content: z.string().min(1).max(4000),
          checksum: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .strict(),
    )
    .max(maxChunks)
    .parse(pending);
  if (new Set(parsed.map((r) => r.chunk_id)).size !== parsed.length)
    throw new Error('invalid_index_batch');
  for (const row of parsed)
    if (row.checksum !== (await digest(row.content))) throw new Error('invalid_index_checksum');
  if (!parsed.length) return { indexed: 0, embeddingSpace: space, trace };
  const vectors = await embedTexts(
    env,
    parsed.map((r) => r.content),
    'document',
    trace,
    AbortSignal.timeout(10000),
  );
  const written = await supabaseRequest(env, '/rest/v1/rpc/knowledge_store_embeddings', {
    mode: { kind: 'privileged' },
    method: 'POST',
    body: {
      p_organization_id: organizationId,
      p_embedding_space: space,
      p_rows: parsed.map((row, i) => ({
        chunk_id: row.chunk_id,
        checksum: row.checksum,
        embedding: vectors[i],
      })),
    },
  });
  if (written !== parsed.length) throw new Error('invalid_index_count');
  return { indexed: written, embeddingSpace: space, trace };
}
