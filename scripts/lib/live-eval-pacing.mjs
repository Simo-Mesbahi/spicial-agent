const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function boundedInterval(raw, fallback) {
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 30000)
    throw new Error('Invalid live evaluation pacing interval');
  return value;
}

/**
 * Qualification-only start-to-start pacing. This never retries provider calls,
 * so the governed provider-call budget remains unchanged.
 */
export function liveCompletionPacer(env = process.env) {
  const intervalMs = boundedInterval(env.P1_LIVE_COMPLETION_MIN_INTERVAL_MS, 0);
  let lastStartedAt = 0;
  return {
    intervalMs,
    async beforeCall() {
      if (!intervalMs) return;
      const now = Date.now();
      const waitMs = lastStartedAt
        ? Math.max(0, intervalMs - (now - lastStartedAt))
        : intervalMs;
      if (waitMs) await sleep(waitMs);
      lastStartedAt = Date.now();
    },
  };
}
