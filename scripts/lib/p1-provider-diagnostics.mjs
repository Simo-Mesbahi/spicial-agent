const providerFailureReasons = new Set([
  'network_or_timeout',
  'upstream_auth',
  'upstream_rate_limited',
  'upstream_request_rejected',
  'upstream_unavailable',
  'upstream_rejected',
  'invalid_upstream_response',
  'missing_verifiable_sources',
  'invalid_tool_arguments',
  'tool_loop',
  'configuration',
  'unknown',
]);

const providerCodes = new Set([
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

const providerParameters = new Set([
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

const rateLimitScopes = new Set(['minute', 'token_minute', 'day', 'spend', 'unknown']);
const groqFailureKinds = new Set(['schema_generation', 'tool_generation', 'context_length']);

function safeMember(value, allowed) {
  return typeof value === 'string' && allowed.has(value) ? value : null;
}

function safeInteger(value, minimum, maximum) {
  return Number.isInteger(value) && value >= minimum && value <= maximum ? value : null;
}

function safeScenarioId(value) {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,119}\/\d{1,3}$/i.test(value)
    ? value
    : null;
}

/**
 * Reduce structured-evaluation provider failures to fixed, non-sensitive diagnostics that
 * are safe to surface in release-gate logs. Semantic mismatches without a provider failure
 * remain owned by the normal structured metrics and are intentionally not relabeled here.
 * Provider messages, prompts, generated text, credentials and arbitrary future diagnostic
 * fields are deliberately discarded.
 */
export function structuredProviderFailureSummary(report) {
  const rows = Array.isArray(report?.rows) ? report.rows : [];
  return rows
    .filter(
      (row) =>
        Boolean(row?.fallback) || row?.status !== 200 || row?.providerDiagnostic != null,
    )
    .map((row) => {
      const diagnostic = row?.providerDiagnostic ?? {};
      return {
        scenario: safeScenarioId(row?.id),
        fallbackReason: safeMember(row?.fallbackReason, providerFailureReasons),
        providerReason: safeMember(diagnostic?.reason, providerFailureReasons),
        httpStatus: safeInteger(diagnostic?.httpStatus, 100, 599),
        code: safeMember(diagnostic?.code, providerCodes),
        parameter: safeMember(diagnostic?.parameter, providerParameters),
        retryAfterMs: safeInteger(diagnostic?.retryAfterMs, 0, 24 * 60 * 60 * 1000),
        rateLimitScope: safeMember(diagnostic?.rateLimitScope, rateLimitScopes),
        groqFailureKind: safeMember(diagnostic?.groqFailureKind, groqFailureKinds),
      };
    });
}
