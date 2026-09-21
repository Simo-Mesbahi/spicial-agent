import { z } from 'zod';
import { boundedJson } from './bounded-json';
import { classifyHttp, ProviderError, type ProviderFailureReason } from './provider-runtime';
import { localBase } from './model-policy';

export type EmbeddingEnv = {
  EMBEDDING_PROVIDER?: string;
  EMBEDDING_MODEL?: string;
  EMBEDDING_BASE_URL?: string;
  EMBEDDING_API_KEY?: string;
  EMBEDDING_REVISION?: string;
  EMBEDDING_DAILY_LIMIT?: string;
  EMBEDDING_SEND_DIMENSIONS?: string;
  LLM_BUDGET_MODE?: string;
};
export type EmbeddingTrace = {
  provider: string;
  model: string;
  calls: number;
  latencyMs: number;
  inputTokens: number | null;
  error: ProviderFailureReason | 'budget_exhausted' | null;
};
export const embeddingTrace = (): EmbeddingTrace => ({
  provider: 'disabled',
  model: '',
  calls: 0,
  latencyMs: 0,
  inputTokens: null,
  error: null,
});
export async function digest(value: string) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))),
    (v) => v.toString(16).padStart(2, '0'),
  ).join('');
}
export function embeddingSettings(env: EmbeddingEnv) {
  const provider = env.EMBEDDING_PROVIDER?.trim(),
    model = env.EMBEDDING_MODEL?.trim();
  if (
    !provider ||
    !['openai', 'gemini', 'compatible', 'ollama'].includes(provider) ||
    !model ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119}$/.test(model)
  )
    throw new ProviderError('configuration');
  const budget = env.LLM_BUDGET_MODE ?? 'zero';
  if (
    provider !== 'ollama' &&
    budget !== 'approved' &&
    !(provider === 'gemini' && budget === 'free')
  )
    throw new ProviderError('configuration');
  const base =
    provider === 'openai'
      ? 'https://api.openai.com/v1'
      : provider === 'gemini'
        ? 'https://generativelanguage.googleapis.com/v1beta'
        : provider === 'ollama'
          ? localBase(env.EMBEDDING_BASE_URL)
          : env.EMBEDDING_BASE_URL?.replace(/\/$/, '');
  if (!base) throw new ProviderError('configuration');
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new ProviderError('configuration');
  }
  if (
    (provider !== 'ollama' && url.protocol !== 'https:') ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new ProviderError('configuration');
  const key = env.EMBEDDING_API_KEY?.trim() ?? '';
  if (provider !== 'ollama' && !key) throw new ProviderError('configuration');
  if (provider === 'gemini' && /[:/]/.test(model)) throw new ProviderError('configuration');
  const sendDimensions = provider === 'openai' || env.EMBEDDING_SEND_DIMENSIONS === 'true';
  const revision = env.EMBEDDING_REVISION?.trim() || '1';
  if (!/^[a-zA-Z0-9._-]{1,80}$/.test(revision)) throw new ProviderError('configuration');
  return { provider, model, base, key, sendDimensions, revision };
}
export async function embeddingSpace(env: EmbeddingEnv) {
  const s = embeddingSettings(env);
  return digest(
    JSON.stringify({
      provider: s.provider,
      model: s.model,
      base: s.base,
      revision: s.revision,
      dimensions: 768,
      dimensionsParameter: s.sendDimensions,
      protocol: 1,
    }),
  );
}
const vectorSchema = z
  .array(z.number().finite().min(-3.4028234e38).max(3.4028234e38))
  .length(768)
  .refine((v) => v.some((x) => x !== 0));
/** One bounded request; no retries, no completion, no query text in diagnostics. */
export async function embedTexts(
  env: EmbeddingEnv,
  inputs: string[],
  task: 'query' | 'document',
  trace: EmbeddingTrace,
  signal = AbortSignal.timeout(3500),
) {
  const s = embeddingSettings(env);
  trace.provider = s.provider;
  trace.model = s.model;
  if (
    !inputs.length ||
    inputs.length > 32 ||
    inputs.some((x) => !x.trim() || x.length > 4000) ||
    inputs.join('').length > 64000
  )
    throw new ProviderError('invalid_tool_arguments');
  const endpoint =
    s.provider === 'gemini'
      ? `${s.base}/models/${s.model}:batchEmbedContents`
      : `${s.base}/embeddings`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (s.key)
    headers[s.provider === 'gemini' ? 'x-goog-api-key' : 'Authorization'] =
      s.provider === 'gemini' ? s.key : `Bearer ${s.key}`;
  const body =
    s.provider === 'gemini'
      ? {
          requests: inputs.map((text) => ({
            model: `models/${s.model}`,
            content: { parts: [{ text }] },
            embedContentConfig: {
              outputDimensionality: 768,
              taskType: task === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT',
            },
          })),
        }
      : {
          model: s.model,
          input: inputs,
          encoding_format: 'float',
          ...(s.sendDimensions ? { dimensions: 768 } : {}),
        };
  const started = performance.now();
  trace.calls++;
  try {
    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal,
        // workerd supports manual; reject 3xx below without forwarding credentials.
        redirect: 'manual',
      });
    } catch {
      throw new ProviderError('network_or_timeout');
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new ProviderError(classifyHttp(res.status));
    }
    const raw = await boundedJson(res, 1024 * 1024, signal);
    if (s.provider === 'gemini') {
      const parsed = z
        .object({
          embeddings: z.array(z.object({ values: vectorSchema })).length(inputs.length),
          usageMetadata: z.object({ promptTokenCount: z.number().int().nonnegative() }).optional(),
        })
        .safeParse(raw);
      if (!parsed.success) throw new ProviderError('invalid_upstream_response');
      trace.inputTokens = parsed.data.usageMetadata?.promptTokenCount ?? null;
      return parsed.data.embeddings.map((x) => x.values);
    }
    const parsed = z
      .object({
        model: z.string().optional(),
        data: z
          .array(z.object({ index: z.number().int().nonnegative(), embedding: vectorSchema }))
          .length(inputs.length),
        usage: z.object({ prompt_tokens: z.number().int().nonnegative() }).optional(),
      })
      .safeParse(raw);
    if (
      !parsed.success ||
      (parsed.data.model !== undefined && parsed.data.model !== s.model) ||
      new Set(parsed.data.data.map((x) => x.index)).size !== inputs.length ||
      parsed.data.data.some((x) => x.index >= inputs.length)
    )
      throw new ProviderError('invalid_upstream_response');
    trace.inputTokens = parsed.data.usage?.prompt_tokens ?? null;
    return parsed.data.data.sort((a, b) => a.index - b.index).map((x) => x.embedding);
  } catch (error) {
    const failure =
      error instanceof ProviderError
        ? error
        : new ProviderError(signal.aborted ? 'network_or_timeout' : 'invalid_upstream_response');
    trace.error = failure.reason;
    throw failure;
  } finally {
    trace.latencyMs = Math.round(performance.now() - started);
  }
}
