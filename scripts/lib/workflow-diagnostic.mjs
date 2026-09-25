import { basename } from 'node:path';

const SAFE_SIGNAL_RULES = [
  {
    needle: 'provider_daily_quota_exhausted',
    category: 'external_dependency',
    code: 'provider_daily_quota_exhausted',
    scope: 'external',
    retryable: false,
    confidence: 'high',
    action: 'wait_for_provider_quota',
  },
  {
    needle: 'provider_rate_limit_retry_window_exceeded',
    category: 'external_dependency',
    code: 'provider_rate_limit_retry_window_exceeded',
    scope: 'external',
    retryable: false,
    confidence: 'high',
    action: 'wait_for_provider_capacity',
  },
  {
    needle: 'provider_rate_limited',
    category: 'external_dependency',
    code: 'provider_rate_limited',
    scope: 'external',
    retryable: true,
    confidence: 'high',
    action: 'retry_after_provider_capacity_recovers',
  },
  {
    needle: 'upstream_rate_limited',
    category: 'external_dependency',
    code: 'upstream_rate_limited',
    scope: 'external',
    retryable: true,
    confidence: 'medium',
    action: 'inspect_provider_quota_and_retry_policy',
  },
  {
    needle: 'resource_exhausted',
    category: 'external_dependency',
    code: 'provider_resource_exhausted',
    scope: 'external',
    retryable: null,
    confidence: 'medium',
    action: 'inspect_provider_quota',
  },
  {
    needle: 'upstream_unavailable',
    category: 'external_dependency',
    code: 'upstream_unavailable',
    scope: 'external',
    retryable: true,
    confidence: 'high',
    action: 'retry_after_provider_recovers',
  },
  {
    needle: 'upstream_network',
    category: 'external_dependency',
    code: 'upstream_network',
    scope: 'external',
    retryable: true,
    confidence: 'high',
    action: 'inspect_provider_network_path',
  },
  {
    needle: 'unknown_evidence_reference',
    category: 'generation_grounding',
    code: 'unknown_evidence_reference',
    scope: 'quality',
    retryable: false,
    confidence: 'high',
    action: 'repair_generation_citation_contract',
  },
  {
    needle: 'missing_all_evidence_references',
    category: 'generation_grounding',
    code: 'missing_all_evidence_references',
    scope: 'quality',
    retryable: false,
    confidence: 'high',
    action: 'repair_generation_citation_contract',
  },
  {
    needle: 'duplicate_evidence_reference',
    category: 'generation_grounding',
    code: 'duplicate_evidence_reference',
    scope: 'quality',
    retryable: false,
    confidence: 'high',
    action: 'repair_generation_citation_contract',
  },
  {
    needle: 'uncited_factual_sentence',
    category: 'generation_grounding',
    code: 'uncited_factual_sentence',
    scope: 'quality',
    retryable: false,
    confidence: 'high',
    action: 'repair_generation_citation_contract',
  },
  {
    needle: 'unsafe_generated_text',
    category: 'generation_structure',
    code: 'unsafe_generated_text',
    scope: 'quality',
    retryable: false,
    confidence: 'high',
    action: 'inspect_generation_structure_policy',
  },
  {
    needle: 'schema_mismatch',
    category: 'generation_structure',
    code: 'schema_mismatch',
    scope: 'quality',
    retryable: false,
    confidence: 'high',
    action: 'inspect_generation_structure_policy',
  },
  {
    needle: 'invalid_json',
    category: 'generation_structure',
    code: 'invalid_json',
    scope: 'quality',
    retryable: false,
    confidence: 'high',
    action: 'inspect_generation_structure_policy',
  },
  {
    needle: 'unsupported_claim',
    category: 'grounding_quality',
    code: 'unsupported_claim',
    scope: 'quality',
    retryable: false,
    confidence: 'high',
    action: 'inspect_grounding_evidence',
  },
  {
    needle: 'semanticfailures',
    category: 'semantic_quality',
    code: 'structured_semantic_mismatch',
    scope: 'quality',
    retryable: false,
    confidence: 'medium',
    action: 'inspect_structured_semantic_regression',
  },
  {
    needle: 'data_unavailable',
    category: 'database_transport',
    code: 'data_unavailable',
    scope: 'external',
    retryable: true,
    confidence: 'medium',
    action: 'inspect_database_transport',
  },
  {
    needle: 'backend_timeout',
    category: 'database_transport',
    code: 'backend_timeout',
    scope: 'external',
    retryable: true,
    confidence: 'high',
    action: 'inspect_database_transport',
  },
  {
    needle: 'timed out',
    category: 'transport_timeout',
    code: 'operation_timeout',
    scope: 'unknown',
    retryable: null,
    confidence: 'low',
    action: 'inspect_failed_step_timeout',
  },
];

const STEP_RULES = [
  [/install locked dependencies|npm ci/i, 'dependency_install', 'dependency_install_failed'],
  [/typecheck/i, 'code_quality', 'typecheck_failed'],
  [/lint/i, 'code_quality', 'lint_failed'],
  [/check:regressions|historical regression/i, 'regression_governance', 'historical_regression_gate_failed'],
  [/test:origin-runtime/i, 'runtime_integration', 'origin_runtime_failed'],
  [/eval:ai/i, 'semantic_quality', 'ai_evaluation_failed'],
  [/eval:rag|hybrid retrieval|retrieval/i, 'retrieval_quality', 'retrieval_qualification_failed'],
  [/eval:generation|generation/i, 'generation_quality', 'generation_evaluation_failed'],
  [/eval:grounding|grounding/i, 'grounding_quality', 'grounding_evaluation_failed'],
  [/eval:p1:release|automated qualification gate|release/i, 'release_gate', 'release_gate_failed'],
  [/build/i, 'build', 'build_failed'],
  [/starter/i, 'runtime_integration', 'starter_failed'],
  [/security|auth|csrf|mfa|rls/i, 'security', 'security_gate_failed'],
];

function cleanString(value, maximum = 160) {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[\r\n\t]+/g, ' ').trim();
  if (!cleaned) return null;
  return cleaned.slice(0, maximum);
}

function safeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function safeSha(value) {
  return typeof value === 'string' && /^[a-f0-9]{40,64}$/i.test(value)
    ? value.toLowerCase()
    : null;
}

function safeProvider(value) {
  return ['gemini', 'ollama', 'openai', 'compatible', 'demo'].includes(value)
    ? value
    : null;
}

function safeModel(value) {
  if (typeof value !== 'string') return null;
  const model = value.trim().toLowerCase();
  if (
    /^(?:gemini|gpt|llama|qwen|mistral|deepseek|claude|configured-model)[a-z0-9._:/-]{0,96}$/.test(
      model,
    )
  ) {
    return model;
  }
  return null;
}

function firstFailedStep(jobs) {
  const candidates = [];
  for (const job of jobs) {
    const steps = Array.isArray(job?.steps) ? job.steps : [];
    for (const [index, step] of steps.entries()) {
      if (step?.conclusion !== 'failure') continue;
      candidates.push({
        job: cleanString(job?.name, 120) ?? 'unknown',
        jobId: safeInteger(job?.id),
        step: cleanString(step?.name, 160) ?? 'unknown',
        stepNumber: safeInteger(step?.number) ?? index + 1,
        startedAt: cleanString(step?.started_at, 64),
        completedAt: cleanString(step?.completed_at, 64),
      });
    }
  }
  candidates.sort((a, b) => {
    const at = Date.parse(a.startedAt ?? '') || Number.MAX_SAFE_INTEGER;
    const bt = Date.parse(b.startedAt ?? '') || Number.MAX_SAFE_INTEGER;
    return at - bt || (a.stepNumber ?? 0) - (b.stepNumber ?? 0);
  });
  return { first: candidates[0] ?? null, all: candidates };
}

function safeArtifactSignal(artifactDocuments) {
  for (const document of artifactDocuments) {
    const report = document?.json;
    if (!report || typeof report !== 'object') continue;

    const blocker = report.blocker;
    const blockerRule =
      typeof blocker?.code === 'string'
        ? SAFE_SIGNAL_RULES.find(
            (entry) => entry.code === blocker.code || entry.needle === blocker.code,
          )
        : null;
    if (
      report.outcome === 'external_dependency_blocked' &&
      blocker?.category === 'external_dependency' &&
      blockerRule
    ) {
      return {
        ...blockerRule,
        retryable:
          typeof blocker.retryRecommended === 'boolean'
            ? blocker.retryRecommended
            : blockerRule.retryable,
        action:
          blocker.retryRecommended === true
            ? 'retry_after_provider_capacity_recovers'
            : blockerRule.action,
        stage: cleanString(blocker.stage, 64),
        provider: safeProvider(blocker.provider),
        model: safeModel(blocker.model),
        source: 'normalized_release_artifact',
      };
    }

    const systemic =
      report?.operational?.systemicTransportFailure ??
      report?.systemicTransportFailure ??
      null;
    if (typeof systemic === 'string') {
      const rule = SAFE_SIGNAL_RULES.find(
        (entry) => entry.needle === systemic.toLowerCase(),
      );
      if (rule) {
        return {
          ...rule,
          stage: cleanString(report?.mode ?? report?.kind, 64),
          provider: safeProvider(report?.provider),
          model: safeModel(report?.model),
          source: 'normalized_evaluation_artifact',
        };
      }
    }
  }
  return null;
}

function safeLogSignal(logs) {
  const combined = Object.values(logs ?? {})
    .filter((value) => typeof value === 'string')
    .join('\n')
    .toLowerCase();

  for (const rule of SAFE_SIGNAL_RULES) {
    if (combined.includes(rule.needle)) {
      return { ...rule, source: 'allowlisted_log_signal' };
    }
  }
  return null;
}

function stepFallback(step) {
  const name = step?.step ?? '';
  for (const [pattern, category, code] of STEP_RULES) {
    if (pattern.test(name)) {
      return {
        category,
        code,
        scope:
          category === 'semantic_quality' ||
          category.endsWith('_quality') ||
          category === 'regression_governance'
            ? 'quality'
            : 'internal',
        retryable: false,
        confidence: 'medium',
        action: 'inspect_failed_step',
        source: 'failed_step',
      };
    }
  }
  return {
    category: 'unknown',
    code: 'unclassified_workflow_failure',
    scope: 'unknown',
    retryable: null,
    confidence: 'low',
    action: 'inspect_failed_step',
    source: 'failed_step',
  };
}

function safeFailedStep(step) {
  if (!step) return null;
  return {
    job: step.job,
    jobId: step.jobId,
    step: step.step,
    stepNumber: step.stepNumber,
  };
}

function safeArtifactNames(artifactDocuments) {
  return [
    ...new Set(
      artifactDocuments
        .map((document) => basename(document?.path ?? ''))
        .filter((name) => /^[a-zA-Z0-9._-]{1,160}$/.test(name)),
    ),
  ].sort();
}

export function buildWorkflowDiagnostic({
  run,
  jobsResponse,
  logs = {},
  artifactDocuments = [],
  generatedAt = new Date().toISOString(),
} = {}) {
  const jobs = Array.isArray(jobsResponse?.jobs)
    ? jobsResponse.jobs
    : Array.isArray(jobsResponse)
      ? jobsResponse
      : [];
  const failures = firstFailedStep(jobs);

  const artifactSignal = safeArtifactSignal(artifactDocuments);
  const logSignal = artifactSignal ? null : safeLogSignal(logs);
  const rootCause = {
    ...(artifactSignal ?? logSignal ?? stepFallback(failures.first)),
  };

  if (!rootCause.stage && failures.first?.step) rootCause.stage = failures.first.step;
  if (!('provider' in rootCause)) rootCause.provider = null;
  if (!('model' in rootCause)) rootCause.model = null;

  const secondaryFailures = failures.all
    .slice(1, 12)
    .map(safeFailedStep)
    .filter(Boolean);

  return {
    schemaVersion: 1,
    kind: 'workflow-diagnostic',
    generatedAt,
    source: {
      repository: cleanString(run?.repository?.full_name ?? run?.repository, 180),
      workflow: cleanString(run?.name, 120),
      runId: safeInteger(run?.id),
      runNumber: safeInteger(run?.run_number),
      event: cleanString(run?.event, 64),
      conclusion: cleanString(run?.conclusion, 32),
      headSha: safeSha(run?.head_sha),
      createdAt: cleanString(run?.created_at, 64),
      updatedAt: cleanString(run?.updated_at, 64),
    },
    failure: {
      rootCause,
      firstFailure: safeFailedStep(failures.first),
      secondaryFailures,
    },
    evidence: {
      matchedSignal: rootCause.code,
      signalSource: rootCause.source,
      artifactReports: safeArtifactNames(artifactDocuments),
      rawLogsIncluded: false,
      rawArtifactPayloadsIncluded: false,
    },
    releaseImpact: {
      blocked: true,
      failClosed: true,
      code:
        rootCause.scope === 'external'
          ? 'external_dependency_blocks_release'
          : 'workflow_failure_blocks_release',
    },
    recommendedAction: {
      code: rootCause.action,
      automaticCodeChangeAllowed: false,
      automaticMergeAllowed: false,
      humanControlledRemediationRequired: true,
    },
    privacy: {
      allowlistOnly: true,
      rawLogsIncluded: false,
      rawProviderTextIncluded: false,
      promptsIncluded: false,
      credentialsIncluded: false,
    },
  };
}

export function diagnosticSummaryMarkdown(diagnostic) {
  const root = diagnostic?.failure?.rootCause ?? {};
  const first = diagnostic?.failure?.firstFailure;
  const source = diagnostic?.source ?? {};
  const lines = [
    '# Workflow diagnostic',
    '',
    '- Workflow: ' + (source.workflow ?? 'unknown'),
    '- Run: ' + (source.runNumber ?? 'unknown') + ' (' + (source.runId ?? 'unknown') + ')',
    '- SHA: ' + (source.headSha ?? 'unknown'),
    '- Category: ' + (root.category ?? 'unknown'),
    '- Code: ' + (root.code ?? 'unknown'),
    '- Scope: ' + (root.scope ?? 'unknown'),
    '- Retryable: ' +
      (root.retryable === null || root.retryable === undefined
        ? 'unknown'
        : String(root.retryable)),
    '- Confidence: ' + (root.confidence ?? 'unknown'),
    '- Failed step: ' + (first?.step ?? 'unknown'),
    '- Recommended action: ' +
      (diagnostic?.recommendedAction?.code ?? 'inspect_failed_step'),
    '- Release blocked: true',
    '- Raw logs included: false',
    '',
  ];
  return lines.join('\n');
}
