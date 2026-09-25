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
  while (true) {
    result = await search();
    if (result?.scope !== 'supabase_unavailable' || retries >= maxRetries) break;
    await backoff.wait(retries);
    retries++;
  }
  return { result, retries };
}
