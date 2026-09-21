import { z } from 'zod';
import type { KnowledgeSearchResult } from './knowledge-runtime';
import { boundedJson } from './bounded-json';
import { modelSettings, type ModelEnvironment } from './model-policy';

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
export type ProviderDiagnostic = {
  reason: ProviderFailureReason;
  httpStatus: number | null;
  code: string | null;
  parameter: string | null;
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
  retrievals: { durationMs: number; scope: string; evidence: KnowledgeSearchResult['evidence']; diagnostics?: KnowledgeSearchResult['retrieval'] }[];
  attempts: {
    round: number;
    latencyMs: number;
    httpStatus: number | null;
    inputTokens: number | null;
    outputTokens: number | null;
    error: ProviderFailureReason | null;
  }[];
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
  };
}
// Explicit allowlists: arbitrary provider error text can contain prompts or secrets.
const errorCodes = new Set([
  'invalid_api_key',
  'insufficient_quota',
  'rate_limit_exceeded',
  'model_not_found',
  'unsupported_parameter',
  'unsupported_value',
  'invalid_request_error',
  'context_length_exceeded',
  'invalid_value',
  'server_error',
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
export function classifyHttp(status: number): ProviderFailureReason {
  if (status === 401 || status === 403) return 'upstream_auth';
  if (status === 429) return 'upstream_rate_limited';
  if (status === 400 || status === 422) return 'upstream_request_rejected';
  if (status >= 500) return 'upstream_unavailable';
  return 'upstream_rejected';
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
    ...(mode === 'openai' || mode === 'gemini'
      ? { max_completion_tokens: maxTokens }
      : { max_tokens: maxTokens }),
    // A server opt-in avoids imposing an unsupported effort on arbitrary OpenAI models.
    ...(mode === 'openai' && reasoning ? { reasoning_effort: reasoning } : {}),
    ...(mode === 'ollama' || mode === 'gemini'
      ? { reasoning_effort: 'none', temperature: 0.2 }
      : {}),
  };
}
export async function providerCompletion(
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
      };
      if (response.status >= 300 && response.status < 400) {
        void response.body?.cancel().catch(() => {});
      } else {
        // Bound both error-body bytes and its deadline. Never persist raw bodies/messages.
        const raw = await boundedJson(response, 8192, signal).catch(() => null);
        const parsed = z
          .object({ error: z.object({ code: z.string().nullish(), param: z.string().nullish() }) })
          .safeParse(raw);
        if (parsed.success) {
          const { code, param } = parsed.data.error;
          diagnostic.code = code && errorCodes.has(code) ? code : null;
          diagnostic.parameter = param && errorParameters.has(param) ? param : null;
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
    throw error;
  } finally {
    attempt.latencyMs = Math.max(0.01, Math.round((performance.now() - started) * 100) / 100);
    trace.latencyMs += attempt.latencyMs;
    if (attempt.inputTokens === null || attempt.outputTokens === null) trace.usageComplete = false;
    trace.attempts.push(attempt);
  }
}
