import { z } from 'zod';
import { redacted } from './domain';
import type { KnowledgeSearchResult } from './knowledge-runtime';
import { boundedJson } from './bounded-json';
import { enabledProviders, modelSettings, type ModelEnvironment } from './model-policy';
import { structuredSchemaForProvider } from './structured-output';

export type ProviderFailureReason =
  | 'network_or_timeout'
  | 'upstream_auth'
  | 'upstream_rate_limited'
  | 'upstream_request_rejected'
  | 'upstream_unavailable'
  | 'upstream_rejected'
  | 'invalid_upstream_response'
  | 'missing_verifiable_sources'
  | 'invalid_tool_arguments'
  | 'tool_loop'
  | 'configuration'
  | 'unknown';
export type ProviderRateLimitScope = 'minute' | 'token_minute' | 'day' | 'spend' | 'unknown';
export type ProviderDiagnostic = {
  reason: ProviderFailureReason;
  httpStatus: number | null;
  code: string | null;
  parameter: string | null;
  retryAfterMs: number | null;
  rateLimitScope: ProviderRateLimitScope | null;
  // A fixed label derived from known Groq errors. Never retain the provider message:
  // it can include a generated answer, prompt, or customer data.
  groqFailureKind?: 'schema_generation' | 'tool_generation' | 'context_length';
};
export class ProviderError extends Error {
  readonly status = 503;
  constructor(
    public reason: ProviderFailureReason,
    public diagnostic: ProviderDiagnostic = {
      reason,
      httpStatus: null,
      code: null,
      parameter: null,
      retryAfterMs: null,
      rateLimitScope: null,
    },
  ) {
    super('Le service IA est temporairement indisponible.');
  }
}
export const completionSchema = z.object({
  choices: z
    .array(
      z.object({
        finish_reason: z.enum(['stop', 'tool_calls']).nullish(),
        message: z.object({
          role: z.literal('assistant'),
          content: z.string().max(6000).nullable().optional(),
          tool_calls: z
            .array(
              z.object({
                id: z.string().min(1).max(200),
                type: z.literal('function').default('function'),
                function: z.object({
                  name: z.enum(['get_case', 'search_knowledge']),
                  arguments: z.string().max(2000),
                }),
              }),
            )
            .max(4)
            .optional(),
        }),
      }),
    )
    .length(1),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative().optional(),
      completion_tokens: z.number().int().nonnegative().optional(),
    })
    .optional(),
});
const usageSchema = z.object({ usage: completionSchema.shape.usage });
export type ProviderTrace = {
  calls: number;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  usageComplete: boolean;
  tools: string[];
  retrievals: {
    durationMs: number;
    scope: string;
    evidence: KnowledgeSearchResult['evidence'];
    diagnostics?: KnowledgeSearchResult['retrieval'];
  }[];
  attempts: {
    round: number;
    provider: ReturnType<typeof modelSettings>['provider'];
    model: string | null;
    diagnostic: ProviderDiagnostic | null;
    latencyMs: number;
    httpStatus: number | null;
    inputTokens: number | null;
    outputTokens: number | null;
    error: ProviderFailureReason | null;
  }[];
  activeProvider: ReturnType<typeof modelSettings>['provider'] | null;
  failoverUsed: boolean;
  failoverFrom: ReturnType<typeof modelSettings>['provider'] | null;
  failoverTo: ReturnType<typeof modelSettings>['provider'] | null;
};
export function providerTrace(): ProviderTrace {
  return {
    calls: 0,
    latencyMs: 0,
    inputTokens: 0,
    outputTokens: 0,
    usageComplete: true,
    tools: [],
    retrievals: [],
    attempts: [],
    activeProvider: null,
    failoverUsed: false,
    failoverFrom: null,
    failoverTo: null,
  };
}
// Explicit allowlists: arbitrary provider error text can contain prompts or secrets.
const errorCodes = new Set([
  'invalid_api_key',
  'insufficient_quota',
  'rate_limit_exceeded',
  'quota_exceeded',
  'too_many_requests',
  'model_not_found',
  'unsupported_parameter',
  'unsupported_value',
  'invalid_request_error',
  'context_length_exceeded',
  'invalid_value',
  'server_error',
  'credit_balance_exhausted',
  'organization_spend_limit_exceeded',
  'project_spend_limit_exceeded',
  'organization_usage_limit_exceeded',
  'slow_down',
  'json_validate_failed',
  'tool_use_failed',
  // Google RPC status names. Never retain arbitrary error messages or details.
  'INVALID_ARGUMENT',
  'UNAUTHENTICATED',
  'PERMISSION_DENIED',
  'NOT_FOUND',
  'RESOURCE_EXHAUSTED',
  'FAILED_PRECONDITION',
  'UNAVAILABLE',
  'INTERNAL',
  'DEADLINE_EXCEEDED',
]);
const errorParameters = new Set([
  'model',
  'messages',
  'tools',
  'tool_choice',
  'parallel_tool_calls',
  'reasoning_effort',
  'temperature',
  'max_tokens',
  'max_completion_tokens',
  'response_format',
]);

function safeGroqFailureKind(error: {
  code?: unknown;
  message?: unknown;
}): ProviderDiagnostic['groqFailureKind'] | null {
  if (error.code === 'json_validate_failed') return 'schema_generation';
  if (error.code === 'tool_use_failed') return 'tool_generation';
  if (error.code === 'context_length_exceeded') return 'context_length';
  if (typeof error.message !== 'string' || error.message.length > 4096) return null;
  // Only match fixed provider-owned prefixes. The matched text is never copied.
  if (/^(?:Failed to generate JSON\.|Generated JSON does not match the expected schema\.)/.test(error.message))
    return 'schema_generation';
  if (/^(?:Failed to call a function\.|Invalid tool call generated)/.test(error.message))
    return 'tool_generation';
  return null;
}
export function classifyHttp(status: number): ProviderFailureReason {
  if (status === 401 || status === 403) return 'upstream_auth';
  if (status === 429) return 'upstream_rate_limited';
  if (status === 400 || status === 422) return 'upstream_request_rejected';
  if (status >= 500) return 'upstream_unavailable';
  return 'upstream_rejected';
}

const maximumSafeRetryAfterMs = 24 * 60 * 60 * 1000;

function boundedRetryDelay(ms: number) {
  if (!Number.isFinite(ms) || ms < 0 || ms > maximumSafeRetryAfterMs) return null;
  return Math.ceil(ms);
}

export function parseRetryAfterMs(raw: string | null, now = Date.now()) {
  const value = raw?.trim();
  if (!value) return null;
  if (/^\d{1,8}$/.test(value)) return boundedRetryDelay(Number(value) * 1000);
  const at = Date.parse(value);
  return Number.isFinite(at) ? boundedRetryDelay(Math.max(0, at - now)) : null;
}

function parseGoogleRetryDelayMs(raw: unknown) {
  if (typeof raw !== 'string') return null;
  const match = /^(\d{1,6})(?:\.(\d{1,9}))?s$/.exec(raw.trim());
  if (!match) return null;
  const seconds = Number(match[1]);
  const fractional = match[2] ? Number('0.' + match[2]) : 0;
  return boundedRetryDelay((seconds + fractional) * 1000);
}

function quotaScopeFromText(value: unknown): ProviderRateLimitScope | null {
  if (typeof value !== 'string') return null;
  const normalized = value.toLowerCase();
  if (/perday|daily|requestsperday|tokensperday|rpd|tpd/.test(normalized)) return 'day';
  if (/input.?tokens?.*perminute|tokens?.*perminute|tpm/.test(normalized)) return 'token_minute';
  if (/perminute|requestsperminute|rpm/.test(normalized)) return 'minute';
  if (/spend|billing.*window|cost/.test(normalized)) return 'spend';
  return null;
}

function safeRateLimitMetadata(
  body: unknown,
  safeCode: string | null,
): { retryAfterMs: number | null; rateLimitScope: ProviderRateLimitScope } {
  let retryAfterMs: number | null = null;
  let rateLimitScope: ProviderRateLimitScope | null =
    safeCode === 'quota_exceeded'
      ? 'day'
      : safeCode === 'rate_limit_exceeded' || safeCode === 'too_many_requests'
        ? 'minute'
        : null;

  const parsed = z
    .object({
      error: z.object({
        details: z.array(z.unknown()).max(32).optional(),
      }),
    })
    .safeParse(body);
  for (const detail of parsed.success ? (parsed.data.error.details ?? []) : []) {
    if (!detail || typeof detail !== 'object' || Array.isArray(detail)) continue;
    const row = detail as Record<string, unknown>;
    const type = typeof row['@type'] === 'string' ? row['@type'] : '';
    if (type === 'type.googleapis.com/google.rpc.RetryInfo') {
      const candidate = parseGoogleRetryDelayMs(row.retryDelay);
      if (candidate !== null)
        retryAfterMs = retryAfterMs === null ? candidate : Math.max(retryAfterMs, candidate);
    }
    if (type === 'type.googleapis.com/google.rpc.QuotaFailure') {
      const violations = Array.isArray(row.violations) ? row.violations.slice(0, 32) : [];
      for (const violation of violations) {
        if (!violation || typeof violation !== 'object' || Array.isArray(violation)) continue;
        const item = violation as Record<string, unknown>;
        rateLimitScope ??= quotaScopeFromText(item.quotaId) ?? quotaScopeFromText(item.quotaMetric);
      }
    }
  }
  return { retryAfterMs, rateLimitScope: rateLimitScope ?? 'unknown' };
}
export function completionPayload(
  env: ModelEnvironment,
  messages: Record<string, unknown>[],
  tools: unknown[] = [],
  finalRound = false,
  maxTokens = 1200,
) {
  const settings = modelSettings(env);
  const mode = settings.provider;
  const reasoning = env.OPENAI_REASONING_EFFORT?.trim();
  return {
    model: settings.model,
    messages,
    ...(tools.length
      ? {
          tools,
          tool_choice: finalRound ? 'none' : 'auto',
          ...(mode === 'openai' ? { parallel_tool_calls: false } : {}),
        }
      : {}),
    ...(mode === 'openai' || mode === 'gemini' || mode === 'groq'
      ? { max_completion_tokens: maxTokens }
      : { max_tokens: maxTokens }),
    // A server opt-in avoids imposing an unsupported effort on arbitrary OpenAI models.
    ...(mode === 'openai' && reasoning ? { reasoning_effort: reasoning } : {}),
    ...(mode === 'ollama'
      ? { reasoning_effort: 'none', temperature: 0.2 }
      : mode === 'gemini'
        ? {
            reasoning_effort: settings.model?.startsWith('gemini-3.') ? 'minimal' : 'none',
            temperature: 0.2,
          }
        : mode === 'groq'
          ? { reasoning_effort: 'low', include_reasoning: false }
          : {}),
  };
}
async function providerCompletionOnce(
  env: ModelEnvironment,
  payload: ReturnType<typeof completionPayload>,
  signal: AbortSignal,
  trace: ProviderTrace,
) {
  const settings = modelSettings(env);
  if (!settings.base) throw new ProviderError('configuration');
  const started = performance.now();
  const attempt: ProviderTrace['attempts'][number] = {
    round: trace.calls++,
    provider: settings.provider,
    model: settings.model
      ? redacted(
          settings.key
            ? settings.model.split(settings.key).join('[secret masked]')
            : settings.model,
        ).slice(0, 128)
      : null,
    diagnostic: null,
    latencyMs: 0,
    httpStatus: null,
    inputTokens: null,
    outputTokens: null,
    error: null,
  };
  try {
    let response: Response;
    try {
      signal.throwIfAborted();
      response = await fetch(settings.base.replace(/\/$/, '') + '/chat/completions', {
        method: 'POST',
        redirect: 'manual',
        signal,
        headers: {
          'Content-Type': 'application/json',
          ...(settings.key ? { Authorization: `Bearer ${settings.key}` } : {}),
        },
        body: JSON.stringify(payload),
      });
    } catch {
      throw new ProviderError('network_or_timeout');
    }
    attempt.httpStatus = response.status;
    if (!response.ok) {
      const reason = classifyHttp(response.status);
      const diagnostic: ProviderDiagnostic = {
        reason,
        httpStatus: response.status,
        code: null,
        parameter: null,
        retryAfterMs: parseRetryAfterMs(response.headers.get('retry-after')),
        rateLimitScope: response.status === 429 ? 'unknown' : null,
      };
      if (response.status >= 300 && response.status < 400) {
        void response.body?.cancel().catch(() => {});
      } else {
        // Bound both error-body bytes and its deadline. Never persist raw bodies/messages.
        const raw = await boundedJson(response, 8192, signal).catch(() => null);
        // Google's compatibility endpoint can return one error in an array and a numeric code.
        const body = Array.isArray(raw) && raw.length === 1 ? raw[0] : raw;
        const parsed = z
          .object({
            error: z.object({
              code: z.unknown().optional(),
              status: z.unknown().optional(),
              type: z.unknown().optional(),
              param: z.unknown().optional(),
              message: z.unknown().optional(),
              details: z.array(z.unknown()).max(32).optional(),
            }),
          })
          .safeParse(body);
        if (parsed.success) {
          const { code, status, type, param } = parsed.data.error;
          diagnostic.code =
            [code, status, type].find(
              (value): value is string => typeof value === 'string' && errorCodes.has(value),
            ) ?? null;
          diagnostic.parameter =
            typeof param === 'string' && errorParameters.has(param) ? param : null;
          if (settings.provider === 'groq' && response.status === 400) {
            const kind = safeGroqFailureKind(parsed.data.error);
            if (kind) diagnostic.groqFailureKind = kind;
          }
          if (response.status === 429) {
            const metadata = safeRateLimitMetadata(body, diagnostic.code);
            diagnostic.rateLimitScope = metadata.rateLimitScope;
            if (metadata.retryAfterMs !== null)
              diagnostic.retryAfterMs =
                diagnostic.retryAfterMs === null
                  ? metadata.retryAfterMs
                  : Math.max(diagnostic.retryAfterMs, metadata.retryAfterMs);
          }
        }
      }
      throw new ProviderError(reason, diagnostic);
    }
    const raw = await boundedJson(response, 65536, signal).catch(() => {
      throw new ProviderError(signal.aborted ? 'network_or_timeout' : 'invalid_upstream_response');
    });
    const usage = usageSchema.safeParse(raw);
    if (usage.success) {
      attempt.inputTokens = usage.data.usage?.prompt_tokens ?? null;
      attempt.outputTokens = usage.data.usage?.completion_tokens ?? null;
      trace.inputTokens += attempt.inputTokens ?? 0;
      trace.outputTokens += attempt.outputTokens ?? 0;
    }
    const parsed = completionSchema.safeParse(raw);
    if (!parsed.success) throw new ProviderError('invalid_upstream_response');
    const choice = parsed.data.choices[0];
    if (
      (!choice.message.tool_calls?.length && !choice.message.content?.trim()) ||
      (choice.finish_reason === 'tool_calls' && !choice.message.tool_calls?.length) ||
      (choice.finish_reason === 'stop' && choice.message.tool_calls?.length)
    )
      throw new ProviderError('invalid_upstream_response');
    return parsed.data;
  } catch (error) {
    attempt.error = error instanceof ProviderError ? error.reason : 'unknown';
    attempt.diagnostic = error instanceof ProviderError ? error.diagnostic : null;
    throw error;
  } finally {
    attempt.latencyMs = Math.max(0.01, Math.round((performance.now() - started) * 100) / 100);
    trace.latencyMs += attempt.latencyMs;
    if (attempt.inputTokens === null || attempt.outputTokens === null) trace.usageComplete = false;
    trace.attempts.push(attempt);
  }
}

/** One bounded, request-local failover. Never retries quota, auth, request, or output failures. */
export async function providerCompletion(
  env: ModelEnvironment,
  payload: ReturnType<typeof completionPayload>,
  signal: AbortSignal,
  trace: ProviderTrace,
  options: { allowFailover?: boolean } = {},
) {
  const allowFailover =
    options.allowFailover !== false && (!env.P1_RELEASE_MODE || env.P1_RELEASE_MODE === 'off');
  const requestEnv =
    allowFailover && trace.activeProvider
      ? { ...env, LLM_PROVIDER: trace.activeProvider, LLM_MODEL: undefined }
      : env;
  const settings = modelSettings(requestEnv);
  const fallback = env.LLM_FALLBACK_PROVIDER;
  const requestedFailover =
    allowFailover &&
    !trace.failoverUsed &&
    env.LLM_AUTO_FAILOVER === 'true' &&
    ['gemini', 'groq', 'openai'].includes(settings.provider) &&
    !!fallback &&
    ['gemini', 'groq', 'openai'].includes(fallback) &&
    fallback !== settings.provider;
  let fallbackEnv: ModelEnvironment | null = null;
  if (requestedFailover) {
    try {
      if (enabledProviders(env).some((provider) => provider === fallback)) {
        const candidate = { ...env, LLM_PROVIDER: fallback, LLM_MODEL: undefined };
        modelSettings(candidate);
        fallbackEnv = candidate;
      }
    } catch {
      /* A revoked secondary must not disable the primary. */
    }
  }
  // Keep the caller's total deadline. Reserve half of the configured time for
  // the fallback so a stalled primary cannot consume the entire request window.
  const firstSignal = fallbackEnv
    ? AbortSignal.any([signal, AbortSignal.timeout(Math.floor(settings.timeoutMs / 2))])
    : signal;
  try {
    return await providerCompletionOnce(
      requestEnv,
      adaptedPayload(requestEnv, payload),
      firstSignal,
      trace,
    );
  } catch (error) {
    if (
      !fallbackEnv ||
      signal.aborted ||
      !(error instanceof ProviderError) ||
      !['network_or_timeout', 'upstream_unavailable'].includes(error.reason)
    )
      throw error;
    // A fallback must independently satisfy server-side key and budget policy.
    const fallbackSettings = modelSettings(fallbackEnv);
    trace.failoverUsed = true;
    trace.failoverFrom = settings.provider;
    trace.failoverTo = fallbackSettings.provider;
    trace.activeProvider = fallbackSettings.provider;
    return providerCompletionOnce(fallbackEnv, adaptedPayload(fallbackEnv, payload), signal, trace);
  }
}

/** Rebuild transport options for the actual destination; never forward another
 * provider's reasoning settings. Local validation remains authoritative. */
function adaptedPayload(env: ModelEnvironment, payload: ReturnType<typeof completionPayload>) {
  const rebuilt: Record<string, unknown> = { ...payload };
  for (const key of [
    'model',
    'max_tokens',
    'max_completion_tokens',
    'reasoning_effort',
    'include_reasoning',
    'temperature',
    'parallel_tool_calls',
  ])
    delete rebuilt[key];
  const tokens =
    'max_completion_tokens' in payload ? payload.max_completion_tokens : payload.max_tokens;
  Object.assign(
    rebuilt,
    completionPayload(
      env,
      payload.messages,
      payload.tools ?? [],
      payload.tool_choice === 'none',
      tokens,
    ),
  );
  const format = rebuilt.response_format as
    { type?: string; json_schema?: { schema?: Record<string, unknown> } } | undefined;
  if (format?.type === 'json_schema' && format.json_schema?.schema) {
    rebuilt.response_format = {
      ...format,
      json_schema: {
        ...format.json_schema,
        schema: structuredSchemaForProvider(modelSettings(env).provider, format.json_schema.schema),
      },
    };
  }
  return rebuilt as ReturnType<typeof completionPayload>;
}

export function routingMetadata(
  trace: ProviderTrace,
  configured: { provider: string; model: string | null },
) {
  const last = trace.attempts.at(-1);
  return {
    configuredProvider: configured.provider,
    provider: last?.provider ?? configured.provider,
    model: last?.model ?? configured.model,
    providerFailover: trace.failoverUsed
      ? { from: trace.failoverFrom, to: trace.failoverTo, recovered: last?.error === null }
      : null,
  };
}
