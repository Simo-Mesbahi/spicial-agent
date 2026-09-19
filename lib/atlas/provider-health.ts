import type { AtlasEnv, Database } from './api';
import { modelSettings, publicModelConfig } from './model-policy';
import {
  completionPayload,
  providerCompletion,
  providerTrace,
  ProviderError,
} from './provider-runtime';

const TTL = 300_000;
async function digest(value: string) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))]
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
}
async function quota(db: Database, id: string, limit: number, windowMs: number) {
  if (limit <= 0) return false;
  const now = Date.now();
  return Boolean(
    await db
      .prepare(
        'INSERT INTO rate_buckets (id,count,expires_at) VALUES (?,1,?) ON CONFLICT(id) DO UPDATE SET count=CASE WHEN expires_at<=? THEN 1 ELSE count+1 END,expires_at=CASE WHEN expires_at<=? THEN ? ELSE expires_at END WHERE count<? OR expires_at<=? RETURNING count',
      )
      .bind(id, now + windowMs, now, now, now + windowMs, limit, now)
      .first(),
  );
}
/** Only callable after admin AAL2, organization, role and CSRF checks at the gateway. */
export async function syntheticProviderHealth(env: AtlasEnv, scope: string) {
  const readiness = publicModelConfig(env);
  if (!readiness.ready || readiness.provider === 'demo')
    return {
      status: 'degraded',
      primary: 'unavailable',
      cached: false,
      reason: readiness.ready ? 'provider_disabled' : 'configuration',
      readiness: readiness.ready,
    };
  const settings = modelSettings(env);
  const payload = completionPayload(
    env,
    [{ role: 'user', content: 'Reply only with OK.' }],
    [],
    false,
    128,
  );
  const fingerprint = await digest(
    JSON.stringify({
      provider: settings.provider,
      model: settings.model,
      base: settings.base,
      key: settings.key,
      payload,
    }),
  );
  const now = Date.now();
  const cached = await env.DB.prepare(
    'SELECT fingerprint,payload,expires_at FROM provider_health WHERE scope=?',
  )
    .bind(scope)
    .first<{ fingerprint: string; payload: string | null; expires_at: number }>();
  if (cached?.fingerprint === fingerprint && cached.payload && cached.expires_at > now)
    return { ...JSON.parse(cached.payload), cached: true };
  const lockId = crypto.randomUUID();
  const claimed = await env.DB.prepare(
    `INSERT INTO provider_health (scope,fingerprint,payload,expires_at,lock_id,lock_until)
    VALUES (?,?,NULL,0,?,?) ON CONFLICT(scope) DO UPDATE SET
    fingerprint=excluded.fingerprint,payload=NULL,expires_at=0,lock_id=excluded.lock_id,lock_until=excluded.lock_until
    WHERE provider_health.lock_until<=? AND (provider_health.expires_at<=? OR provider_health.fingerprint<>?)`,
  )
    .bind(scope, fingerprint, lockId, now + settings.timeoutMs + 5000, now, now, fingerprint)
    .run();
  if (!claimed.meta.changes)
    return { status: 'degraded', primary: 'unknown', cached: false, reason: 'probe_in_progress' };
  try {
    const limit = Number(env.LLM_DAILY_LIMIT ?? 100);
    const dailyLimit = Number.isFinite(limit)
      ? Math.max(0, Math.min(10000, Math.floor(limit)))
      : 100;
    // Persistent deployment-wide caps also survive worker restarts and key/model rotation.
    const allowed =
      (await quota(env.DB, `llm-health-minute:${scope}`, 1, 60_000)) &&
      (await quota(env.DB, `llm-health-day:${scope}`, 12, 86_400_000)) &&
      (await quota(env.DB, 'llm-global', dailyLimit, 86_400_000));
    if (!allowed)
      return {
        status: 'degraded',
        primary: 'unknown',
        cached: false,
        reason: 'probe_rate_limited',
      };
    const trace = providerTrace();
    const requestId = crypto.randomUUID();
    let diagnostic = null;
    let healthy = false;
    try {
      const result = await providerCompletion(
        env,
        payload,
        AbortSignal.timeout(settings.timeoutMs),
        trace,
      );
      healthy =
        result.choices[0].message.content?.trim() === 'OK' &&
        !result.choices[0].message.tool_calls?.length &&
        trace.usageComplete &&
        trace.inputTokens > 0 &&
        trace.outputTokens > 0;
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      diagnostic = error.diagnostic;
    }
    const checkedAt = Date.now();
    const result = {
      status: healthy ? 'healthy' : 'degraded',
      primary: healthy ? 'healthy' : 'unavailable',
      reason: healthy ? null : (diagnostic?.reason ?? 'invalid_upstream_response'),
      readiness: true,
      provider: settings.provider,
      model: settings.model,
      requestId,
      checkedAt,
      expiresAt: checkedAt + TTL,
      diagnostic,
      trace,
    };
    await env.DB.prepare(
      'UPDATE provider_health SET payload=?,expires_at=?,lock_until=0 WHERE scope=? AND lock_id=?',
    )
      .bind(JSON.stringify(result), result.expiresAt, scope, lockId)
      .run();
    console.info('atlas.ai.synthetic_health', { schema: 1, ...result });
    return { ...result, cached: false };
  } finally {
    await env.DB.prepare('UPDATE provider_health SET lock_until=0 WHERE scope=? AND lock_id=?')
      .bind(scope, lockId)
      .run();
  }
}
