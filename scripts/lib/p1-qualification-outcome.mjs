const externalProviderFailureCodes = new Set([
  'provider_daily_quota_exhausted',
  'provider_rate_limit_retry_window_exceeded',
  'provider_rate_limited',
]);

function reportSystemicFailure(report) {
  return (
    report?.operational?.systemicTransportFailure ??
    report?.systemicTransportFailure ??
    null
  );
}

function blockerForReport(stage, report) {
  const code = reportSystemicFailure(report);
  if (!externalProviderFailureCodes.has(code)) return null;

  const provider = typeof report?.provider === 'string' ? report.provider : null;
  const model = typeof report?.model === 'string' ? report.model : null;

  return {
    category: 'external_dependency',
    dependency: 'llm_provider',
    stage,
    code,
    provider,
    model,
    releaseBlocked: true,
    retryRecommended:
      code === 'provider_rate_limited',
  };
}

export function classifyExternalQualificationBlocker({
  structured = null,
  generation = null,
  groundingReports = [],
} = {}) {
  const candidates = [
    blockerForReport('structured', structured),
    blockerForReport('generation', generation),
    ...groundingReports.map((report) => blockerForReport('grounding', report)),
  ].filter(Boolean);

  return candidates[0] ?? null;
}

export function qualificationOutcome({ releaseAllowed, automatedPassed, blocker } = {}) {
  if (releaseAllowed === true) return 'release_qualified';
  if (automatedPassed === true) return 'human_review_required';
  if (blocker?.category === 'external_dependency')
    return 'external_dependency_blocked';
  return 'qualification_failed';
}
