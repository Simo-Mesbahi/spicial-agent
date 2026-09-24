const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function boundedInterval(raw, fallback) {
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 30000)
    throw new Error('Invalid live evaluation pacing interval');
  return value;
}

function pacer(intervalMs, waitBeforeFirst = false) {
  let lastStartedAt = waitBeforeFirst && intervalMs ? Date.now() : 0;
  return {
    intervalMs,
    async beforeCall() {
      if (!intervalMs) return;
      const now = Date.now();
      const waitMs = lastStartedAt
        ? Math.max(0, intervalMs - (now - lastStartedAt))
        : 0;
      if (waitMs) await sleep(waitMs);
      lastStartedAt = Date.now();
    },
  };
}

/**
 * Qualification-only completion start-to-start pacing. This never retries provider calls,
 * so the governed provider-call budget remains unchanged.
 */
export function liveCompletionPacer(env = process.env) {
  return pacer(boundedInterval(env.P1_LIVE_COMPLETION_MIN_INTERVAL_MS, 0));
}

/**
 * Embedding pacing is independent from completion pacing. The first evaluation embedding
 * is delayed as well because corpus indexing may have used the same provider immediately
 * before retrieval qualification.
 */
export function liveEmbeddingPacer(env = process.env) {
  return pacer(
    boundedInterval(env.P1_LIVE_EMBEDDING_MIN_INTERVAL_MS, 0),
    true,
  );
}

export function liveTransientRetryBackoff(env = process.env) {
  const intervalMs = boundedInterval(env.P1_LIVE_TRANSIENT_RETRY_BACKOFF_MS, 0);
  return {
    intervalMs,
    async wait() {
      if (intervalMs) await sleep(intervalMs);
    },
  };
}
