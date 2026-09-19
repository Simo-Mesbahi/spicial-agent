import { z } from 'zod';
import { boundedJson } from './bounded-json';
import { modelSettings, type ModelEnvironment } from './model-policy';
import {
  providerFailureReason,
  providerRequestId,
  sanitizeDiagnosticToken,
  type ProviderErrorDetails,
  type ProviderFailureReason,
} from './llm-diagnostics';

const probeSchema = z.object({
  choices: z.array(z.object({
    message: z.object({ content: z.string().nullable().optional() }),
  })).min(1),
  usage: z.object({
    prompt_tokens: z.number().int().nonnegative().optional(),
    completion_tokens: z.number().int().nonnegative().optional(),
  }).optional(),
});

export type SyntheticModelHealth = {
  status: 'healthy' | 'degraded' | 'disabled' | 'unavailable';
  provider: string;
  model: string | null;
  checkedAt: number;
  cached: boolean;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  failureReason: ProviderFailureReason | 'configuration' | null;
  upstreamStatus: number | null;
  upstreamCode: string | null;
  upstreamRequestId: string | null;
};

const HEALTH_TTL_MS = 60_000;
const cache = new Map<string, { expiresAt: number; value: SyntheticModelHealth }>();

function keyFor(provider: string, model: string | null, base: string | null) {
  return [provider, model ?? '', base ?? ''].join('|');
}

function remember(key: string, value: SyntheticModelHealth, now: number) {
  cache.set(key, { expiresAt: now + HEALTH_TTL_MS, value });
  return value;
}

async function upstreamDetails(res: Response, signal: AbortSignal): Promise<ProviderErrorDetails> {
  let upstreamCode: string | null = null;
  try {
    const payload = await boundedJson(res, 8192, signal);
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      const error = (payload as Record<string, unknown>).error;
      if (error && typeof error === 'object' && !Array.isArray(error)) {
        const record = error as Record<string, unknown>;
        upstreamCode =
          sanitizeDiagnosticToken(record.code) ??
          sanitizeDiagnosticToken(record.type) ??
          sanitizeDiagnosticToken(record.param);
      }
    }
  } catch {
    // Never surface or log raw upstream error bodies from a health probe.
  }
  return {
    stage: 'http',
    upstreamStatus: res.status,
    upstreamCode,
    upstreamRequestId: providerRequestId(res.headers),
  };
}

export async function syntheticModelHealth(
  env: ModelEnvironment,
  now = Date.now(),
): Promise<SyntheticModelHealth> {
  let settings: ReturnType<typeof modelSettings>;
  try {
    settings = modelSettings(env);
  } catch {
    return {
      status: 'unavailable',
      provider: env.LLM_PROVIDER ?? 'demo',
      model: null,
      checkedAt: now,
      cached: false,
      latencyMs: null,
      inputTokens: null,
      outputTokens: null,
      failureReason: 'configuration',
      upstreamStatus: null,
      upstreamCode: null,
      upstreamRequestId: null,
    };
  }

  if (settings.provider === 'demo') {
    return {
      status: 'disabled',
      provider: 'demo',
      model: null,
      checkedAt: now,
      cached: false,
      latencyMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      failureReason: null,
      upstreamStatus: null,
      upstreamCode: null,
      upstreamRequestId: null,
    };
  }

  const key = keyFor(settings.provider, settings.model, settings.base);
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return { ...hit.value, cached: true };

  if (!settings.base) {
    return remember(key, {
      status: 'unavailable',
      provider: settings.provider,
      model: settings.model,
      checkedAt: now,
      cached: false,
      latencyMs: null,
      inputTokens: null,
      outputTokens: null,
      failureReason: 'configuration',
      upstreamStatus: null,
      upstreamCode: null,
      upstreamRequestId: null,
    }, now);
  }

  const startedAt = Date.now();
  const deadline = AbortSignal.timeout(Math.min(settings.timeoutMs, 7000));
  let res: Response;
  try {
    res = await fetch(settings.base.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(settings.key ? { Authorization: 'Bearer ' + settings.key } : {}),
      },
      body: JSON.stringify({
        model: settings.model,
        messages: [
          { role: 'system', content: 'Health probe. Reply with the single word OK.' },
          { role: 'user', content: 'OK' },
        ],
        ...(settings.provider === 'openai' || settings.provider === 'gemini'
          ? { max_completion_tokens: 8 }
          : { max_tokens: 8 }),
        ...(settings.provider === 'openai' ||
        settings.provider === 'ollama' ||
        settings.provider === 'gemini'
          ? { reasoning_effort: 'none' }
          : {}),
        ...(settings.provider === 'openai' ? { store: false } : {}),
      }),
      signal: deadline,
      redirect: 'manual',
    });
  } catch {
    const latencyMs = Date.now() - startedAt;
    const details: ProviderErrorDetails = { stage: 'network', providerLatencyMs: latencyMs };
    return remember(key, {
      status: 'degraded',
      provider: settings.provider,
      model: settings.model,
      checkedAt: now,
      cached: false,
      latencyMs,
      inputTokens: null,
      outputTokens: null,
      failureReason: providerFailureReason('network', details),
      upstreamStatus: null,
      upstreamCode: null,
      upstreamRequestId: null,
    }, now);
  }

  if (res.status >= 300 && res.status < 400) {
    const latencyMs = Date.now() - startedAt;
    const requestId = providerRequestId(res.headers);
    void res.body?.cancel().catch(() => {});
    const details: ProviderErrorDetails = {
      stage: 'http',
      upstreamStatus: res.status,
      upstreamRequestId: requestId,
      providerLatencyMs: latencyMs,
    };
    return remember(key, {
      status: 'degraded',
      provider: settings.provider,
      model: settings.model,
      checkedAt: now,
      cached: false,
      latencyMs,
      inputTokens: null,
      outputTokens: null,
      failureReason: providerFailureReason('redirect', details),
      upstreamStatus: res.status,
      upstreamCode: null,
      upstreamRequestId: requestId,
    }, now);
  }

  if (!res.ok) {
    const details = await upstreamDetails(res, deadline);
    const latencyMs = Date.now() - startedAt;
    return remember(key, {
      status: 'degraded',
      provider: settings.provider,
      model: settings.model,
      checkedAt: now,
      cached: false,
      latencyMs,
      inputTokens: null,
      outputTokens: null,
      failureReason: providerFailureReason('upstream failure', details),
      upstreamStatus: details.upstreamStatus ?? null,
      upstreamCode: details.upstreamCode ?? null,
      upstreamRequestId: details.upstreamRequestId ?? null,
    }, now);
  }

  const requestId = providerRequestId(res.headers);
  const parsed = probeSchema.safeParse(await boundedJson(res, 32768, deadline).catch(() => null));
  const latencyMs = Date.now() - startedAt;
  const content = parsed.success ? parsed.data.choices[0]?.message.content?.trim() : '';
  if (!parsed.success || !content) {
    const details: ProviderErrorDetails = {
      stage: 'response_validation',
      upstreamStatus: res.status,
      upstreamRequestId: requestId,
      providerLatencyMs: latencyMs,
    };
    return remember(key, {
      status: 'degraded',
      provider: settings.provider,
      model: settings.model,
      checkedAt: now,
      cached: false,
      latencyMs,
      inputTokens: null,
      outputTokens: null,
      failureReason: providerFailureReason('invalid response', details),
      upstreamStatus: res.status,
      upstreamCode: null,
      upstreamRequestId: requestId,
    }, now);
  }

  return remember(key, {
    status: 'healthy',
    provider: settings.provider,
    model: settings.model,
    checkedAt: now,
    cached: false,
    latencyMs,
    inputTokens: parsed.data.usage?.prompt_tokens ?? null,
    outputTokens: parsed.data.usage?.completion_tokens ?? null,
    failureReason: null,
    upstreamStatus: res.status,
    upstreamCode: null,
    upstreamRequestId: requestId,
  }, now);
}

export function clearSyntheticHealthCacheForTests() {
  cache.clear();
}
