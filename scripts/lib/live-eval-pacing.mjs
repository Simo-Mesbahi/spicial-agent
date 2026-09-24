const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function boundedInterval(raw, fallback) {
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 30000)
    throw new Error('Invalid live evaluation pacing interval');
  return value;
}

function pacer(intervalMs) {
  let lastStartedAt = 0;
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
 * Qualification-only start-to-start pacing. These helpers never issue or retry
 * provider calls; runners remain responsible for the governed call budget.
 */
export function liveCompletionPacer(env = process.env) {
  return pacer(boundedInterval(env.P1_LIVE_COMPLETION_MIN_INTERVAL_MS, 0));
}

export function liveEmbeddingPacer(env = process.env) {
  return pacer(boundedInterval(env.P1_LIVE_EMBEDDING_MIN_INTERVAL_MS, 0));
}
