import test from 'node:test';
import assert from 'node:assert/strict';

import { structuredProviderFailureSummary } from '../scripts/lib/p1-provider-diagnostics.mjs';

test('P1 structured provider failures expose only fixed safe diagnostics', () => {
  const summary = structuredProviderFailureSummary({
    rows: [
      {
        id: 'pre-p1-correction-understanding-es/3',
        status: 200,
        fallback: 'provider_unavailable',
        fallbackReason: 'upstream_request_rejected',
        checks: {
          intent: null,
          guidance: null,
          requiresCase: null,
          conversationRepair: null,
          responseLanguage: null,
        },
        providerDiagnostic: {
          reason: 'upstream_request_rejected',
          httpStatus: 400,
          code: 'invalid_request_error',
          parameter: 'response_format',
          retryAfterMs: null,
          rateLimitScope: null,
          groqFailureKind: 'schema_generation',
          message: 'PRIVATE-CUSTOMER generated content',
          details: { apiKey: 'secret-provider-key' },
        },
        response: 'PRIVATE-CUSTOMER assistant response',
      },
      {
        id: 'pre-p1-correction-understanding-es/4',
        status: 200,
        fallback: null,
        fallbackReason: null,
        checks: {
          intent: true,
          guidance: true,
          requiresCase: true,
          conversationRepair: true,
          responseLanguage: true,
        },
        providerDiagnostic: null,
        response: 'normal synthetic response',
      },
    ],
  });

  assert.deepEqual(summary, [
    {
      scenario: 'pre-p1-correction-understanding-es/3',
      fallbackReason: 'upstream_request_rejected',
      httpStatus: 400,
      code: 'invalid_request_error',
      parameter: 'response_format',
      retryAfterMs: null,
      rateLimitScope: null,
      groqFailureKind: 'schema_generation',
    },
  ]);
  const serialized = JSON.stringify(summary);
  assert.doesNotMatch(serialized, /PRIVATE-CUSTOMER|secret-provider-key|generated content|assistant response/);
});

test('P1 structured provider failure summary fails closed on arbitrary diagnostic values', () => {
  const summary = structuredProviderFailureSummary({
    rows: [
      {
        id: 'unsafe customer identifier / 1',
        status: 503,
        fallback: 'provider_unavailable',
        fallbackReason: 'PRIVATE-REASON',
        checks: {},
        providerDiagnostic: {
          httpStatus: 999,
          code: 'PRIVATE-CODE',
          parameter: 'PRIVATE-PARAMETER',
          retryAfterMs: 999999999999,
          rateLimitScope: 'PRIVATE-SCOPE',
          groqFailureKind: 'PRIVATE-KIND',
          message: 'PRIVATE-MESSAGE',
        },
      },
    ],
  });

  assert.deepEqual(summary, [
    {
      scenario: null,
      fallbackReason: null,
      httpStatus: null,
      code: null,
      parameter: null,
      retryAfterMs: null,
      rateLimitScope: null,
      groqFailureKind: null,
    },
  ]);
  assert.doesNotMatch(JSON.stringify(summary), /PRIVATE/);
});

test('P1 structured provider failure summary preserves bounded rate-limit evidence', () => {
  const summary = structuredProviderFailureSummary({
    rows: [
      {
        id: 'pre-p1-information-only-action-safety-fr/2',
        status: 200,
        fallback: 'provider_unavailable',
        fallbackReason: 'upstream_rate_limited',
        checks: { intent: null },
        providerDiagnostic: {
          httpStatus: 429,
          code: 'rate_limit_exceeded',
          parameter: null,
          retryAfterMs: 4000,
          rateLimitScope: 'minute',
        },
      },
    ],
  });

  assert.equal(summary.length, 1);
  assert.deepEqual(summary[0], {
    scenario: 'pre-p1-information-only-action-safety-fr/2',
    fallbackReason: 'upstream_rate_limited',
    httpStatus: 429,
    code: 'rate_limit_exceeded',
    parameter: null,
    retryAfterMs: 4000,
    rateLimitScope: 'minute',
    groqFailureKind: null,
  });
});
