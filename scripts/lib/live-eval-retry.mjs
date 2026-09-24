const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const recoverableTransportReasons = new Set([
  'network_or_timeout',
  'upstream_unavailable',
]);

export function isRecoverableTransport(reason) {
  return recoverableTransportReasons.has(reason);
}

export function boundedRetryValue(raw, fallback, { name, max }) {
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > max)
    throw new Error(`Invalid ${name}`);
  return value;
}

export function retryPolicy(
  env,
  {
    limitKey,
    backoffKey,
    fallbackLimit = 0,
    fallbackBackoffMs = 0,
    maximumLimit,
    maximumBackoffMs = 30000,
  },
) {
  return {
    limit: boundedRetryValue(env[limitKey], fallbackLimit, {
      name: limitKey,
      max: maximumLimit,
    }),
    backoffMs: boundedRetryValue(env[backoffKey], fallbackBackoffMs, {
      name: backoffKey,
      max: maximumBackoffMs,
    }),
  };
}

export async function waitForRetry(backoffMs) {
  if (backoffMs) await sleep(backoffMs);
}
