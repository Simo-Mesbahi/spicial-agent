const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function boundedInterval(raw, fallback, maximum = 30000) {
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > maximum)
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

/**
 * Truncated exponential backoff for qualification-only transient retries.
 * Runs are serialized by the workflow concurrency group, so deterministic delays avoid
 * non-reproducible tests while still backing off more aggressively after repeated 429/5xx.
 */
export function boundedExponentialRetryDelay(baseMs, attempt, capMs = 30000) {
  if (
    !Number.isInteger(baseMs) ||
    baseMs < 0 ||
    baseMs > 30000 ||
    !Number.isInteger(attempt) ||
    attempt < 0 ||
    attempt > 16 ||
    !Number.isInteger(capMs) ||
    capMs < 0 ||
    capMs > 30000
  )
    throw new Error('Invalid live evaluation retry backoff');
  if (!baseMs || !capMs) return 0;
  return Math.min(capMs, baseMs * 2 ** attempt);
}

export function liveTransientRetryBackoff(env = process.env) {
  const intervalMs = boundedInterval(env.P1_LIVE_TRANSIENT_RETRY_BACKOFF_MS, 0);
  const rateLimitMinMs = boundedInterval(
    env.P1_LIVE_RATE_LIMIT_RETRY_MIN_MS,
    60000,
    60000,
  );
  const rateLimitMaxMs = boundedInterval(
    env.P1_LIVE_RATE_LIMIT_RETRY_MAX_MS,
    60000,
    60000,
  );
  if (rateLimitMaxMs < rateLimitMinMs)
    throw new Error('Invalid live evaluation rate-limit retry window');

  function plan(reason = null, attempt = 0, diagnostic = null) {
    const transientDelayMs = boundedExponentialRetryDelay(intervalMs, attempt, 30000);
    if (reason !== 'upstream_rate_limited')
      return {
        retryable: true,
        delayMs: transientDelayMs,
        source: 'transient_backoff',
      };

    if (diagnostic?.rateLimitScope === 'day')
      return { retryable: false, delayMs: 0, source: 'daily_quota' };

    const providerDelayMs =
      Number.isInteger(diagnostic?.retryAfterMs) && diagnostic.retryAfterMs >= 0
        ? diagnostic.retryAfterMs
        : 0;
    const desired = Math.max(rateLimitMinMs, transientDelayMs, providerDelayMs);
    if (desired > rateLimitMaxMs)
      return {
        retryable: false,
        delayMs: 0,
        source: 'provider_retry_after_exceeds_window',
      };
    return {
      retryable: true,
      delayMs: desired,
      source: providerDelayMs ? 'provider_advised_rate_limit' : 'rate_limit_floor',
    };
  }

  return {
    intervalMs,
    maxIntervalMs: 30000,
    rateLimitMinMs,
    rateLimitMaxMs,
    delayMs(attempt = 0) {
      return boundedExponentialRetryDelay(intervalMs, attempt, 30000);
    },
    plan,
    async wait(attempt = 0, reason = null, diagnostic = null) {
      const decision = plan(reason, attempt, diagnostic);
      if (decision.retryable && decision.delayMs) await sleep(decision.delayMs);
      return decision;
    },
  };
}
