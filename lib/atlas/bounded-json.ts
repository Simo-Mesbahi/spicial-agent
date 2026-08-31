export class JsonLimitError extends Error {}

// Enforce the byte limit while reading, including chunked bodies without Content-Length.
export async function boundedJson(
  input: Request | Response,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<unknown> {
  const reader = input.body?.getReader();
  if (!reader) throw new SyntaxError('Empty JSON body');
  let rejectAbort: (reason?: unknown) => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  const onAbort = () => rejectAbort(signal?.reason ?? new Error('Read aborted'));
  signal?.addEventListener('abort', onAbort, { once: true });
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0;
  let raw = '';
  try {
    signal?.throwIfAborted();
    if (Number(input.headers.get('content-length')) > maxBytes)
      throw new JsonLimitError('JSON byte limit exceeded');
    while (true) {
      const { value, done } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new JsonLimitError('JSON byte limit exceeded');
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
    return JSON.parse(raw);
  } catch (error) {
    // Cancellation must not extend the deadline if the upstream stream is stalled.
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
}
