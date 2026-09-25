/**
 * Qualification-only retry wrapper for the lexical retrieval leg.
 * It retries only an explicit Supabase-unavailable result and never spends embedding budget.
 */
export async function searchLexicalWithTransientRetries(
  search,
  maxRetries,
  backoff,
) {
  if (typeof search !== 'function') throw new Error('Invalid lexical retrieval search');
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 4)
    throw new Error('Invalid lexical retrieval retry budget');
  if (!backoff || typeof backoff.wait !== 'function')
    throw new Error('Invalid lexical retrieval backoff');

  let retries = 0;
  let result;
  const attempts = [];
  while (true) {
    result = await search();
    const backend = result?.retrieval?.backend ?? null;
    attempts.push({
      scope: result?.scope ?? null,
      backendCalls: backend?.calls ?? 0,
      backendRetries: backend?.retries ?? 0,
      backendError: backend?.error ?? null,
    });
    if (result?.scope !== 'supabase_unavailable' || retries >= maxRetries) break;
    await backoff.wait(retries);
    retries++;
  }
  return { result, retries, attempts };
}

const retryableEmbeddingReasons = new Set([
  'network_or_timeout',
  'upstream_rate_limited',
  'upstream_unavailable',
]);

/**
 * Qualification-only retry wrapper for the hybrid retrieval leg.
 * Retries only transient embedding transport/provider failures, never semantic retrieval misses.
 * Every attempt is explicitly paced and telemetry is returned for exact provider-call accounting.
 */
export async function searchHybridWithEmbeddingRetries(
  search,
  maxRetries,
  backoff,
  pacer,
) {
  if (typeof search !== 'function') throw new Error('Invalid hybrid retrieval search');
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 4)
    throw new Error('Invalid embedding retry budget');
  if (!backoff || typeof backoff.wait !== 'function')
    throw new Error('Invalid embedding retry backoff');
  if (!pacer || typeof pacer.beforeCall !== 'function')
    throw new Error('Invalid embedding pacer');

  let retries = 0;
  let result;
  const attempts = [];
  while (true) {
    await pacer.beforeCall();
    result = await search();
    const embedding = result?.retrieval?.embedding ?? null;
    const backend = result?.retrieval?.backend ?? null;
    attempts.push({
      scope: result?.scope ?? null,
      embeddingCalls: embedding?.calls ?? 0,
      embeddingError: embedding?.error ?? null,
      backendCalls: backend?.calls ?? 0,
      backendRetries: backend?.retries ?? 0,
      backendError: backend?.error ?? null,
    });
    if (
      !retryableEmbeddingReasons.has(embedding?.error) ||
      retries >= maxRetries
    )
      break;
    await backoff.wait(retries);
    retries++;
  }
  return { result, retries, attempts };
}

