import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { groundingDecisionPasses } from '../evals/grounding.mjs';
import {
  liveTransientRetryBackoff,
  rateLimitSystemicFailure,
} from '../scripts/lib/live-eval-pacing.mjs';
import {
  classifyExternalQualificationBlocker,
  qualificationOutcome,
} from '../scripts/lib/p1-qualification-outcome.mjs';

const workflowPath = '.github/workflows/p1-live-qualification.yml';

test('P1.7 live qualification workflow is manual-only and explicitly acknowledged', async () => {
  const source = await readFile(workflowPath, 'utf8');

  assert.match(source, /workflow_dispatch:/);
  assert.doesNotMatch(source, /^\s*push:/m);
  assert.doesNotMatch(source, /^\s*pull_request:/m);
  assert.match(source, /Type P1_RELEASE/);
  assert.match(source, /inputs\.confirm/);
  assert.match(source, /"P1_RELEASE"/);
  assert.match(source, /refs\/heads\/main/);
  assert.match(source, /qualification_environment:/);
  assert.match(source, /type: environment/);
  assert.match(source, /environment: \$\{\{ inputs\.qualification_environment \}\}/);
  assert.match(source, /cancel-in-progress: false/);
});

test('dependency install policy is version-pinned and enforced in every CI path', async () => {
  const [workflow, ci, installScript, pkgSource] = await Promise.all([
    readFile(workflowPath, 'utf8'),
    readFile('.github/workflows/ci.yml', 'utf8'),
    readFile('scripts/install-ci.sh', 'utf8'),
    readFile('package.json', 'utf8'),
  ]);
  const pkg = JSON.parse(pkgSource);
  assert.deepEqual(pkg.allowScripts, {
    'esbuild@0.28.2': true,
    'unrs-resolver@1.11.1': true,
    'workerd@1.20260828.1': true,
  });
  assert.match(workflow, /npm ci --no-audit --no-fund --strict-allow-scripts/);
  assert.match(ci, /npm ci --no-audit --no-fund --strict-allow-scripts/);
  assert.match(installScript, /npm_ci_args=\(ci --cache "\$\{expected_cache\}" --strict-allow-scripts\)/);
});

test('P1.7 live qualification verifies the complete no-spend gate before provider calls', async () => {
  const source = await readFile(workflowPath, 'utf8');
  const verifyIndex = source.indexOf('Verify source before spending provider budget');
  const liveIndex = source.indexOf('Run bounded live qualification');

  assert.ok(verifyIndex >= 0);
  assert.ok(liveIndex > verifyIndex);

  const verification = source.slice(verifyIndex, liveIndex);
  for (const command of [
    'npm run typecheck',
    'npm run lint:app',
    'npm test',
    'npm run test:origin-runtime',
    'npm run eval:ai',
    'npm run eval:rag',
    'npm run eval:generation',
    'npm run eval:grounding',
    'npm run eval:p1:release',
    'npm run build',
    'npm run test:starter',
  ]) {
    assert.ok(verification.includes(command), `missing pre-spend gate: ${command}`);
  }

  assert.match(source, /LLM_STRUCTURED_OUTPUT: json_schema/);
  assert.match(source, /LLM_REQUEST_TIMEOUT_MS: '60000'/);
  assert.match(source, /LLM_GENERATION_TIMEOUT_MS: '20000'/);
  assert.match(source, /LLM_VALIDATION_TIMEOUT_MS: '20000'/);
  assert.match(source, /P1_LIVE_COMPLETION_MIN_INTERVAL_MS: '10000'/);
  assert.match(source, /P1_LIVE_EMBEDDING_MIN_INTERVAL_MS: '4000'/);
  assert.match(source, /P1_LIVE_TRANSIENT_RETRY_BACKOFF_MS: '15000'/);
  assert.match(source, /P1_LIVE_RATE_LIMIT_RETRY_MIN_MS: '60000'/);
  assert.match(source, /P1_LIVE_RATE_LIMIT_RETRY_MAX_MS: '60000'/);
  assert.match(source, /P1_STRUCTURED_MAX_SCENARIO_RETRIES: '6'/);
  assert.match(source, /P1_STRUCTURED_RETRY_BACKOFF_MS: '15000'/);
  assert.match(source, /default: gemini-3\.5-flash-lite/);
  assert.match(source, /RAG_MIN_SIMILARITY: '0.7'/);
  assert.match(source, /RAG_RPC_TIMEOUT_MS: '5000'/);
  assert.match(source, /RAG_RPC_RETRY_TIMEOUT_MS: '10000'/);
  assert.match(source, /RAG_RPC_MAX_RETRIES: '1'/);
  assert.match(source, /RAG_RPC_RETRY_BACKOFF_MS: '1000'/);

  const retrievalPreflightIndex = source.indexOf(
    'Qualify live hybrid retrieval before completion spend',
  );
  assert.ok(retrievalPreflightIndex > verifyIndex);
  assert.ok(retrievalPreflightIndex < liveIndex);
  assert.match(source, /scripts\/evaluate-retrieval\.mjs/);
  assert.match(source, /--max-transient-retries 2/);
  assert.match(source, /--max-embedding-retries 4/);
  assert.match(source, /scripts\/check-retrieval-qualification\.mjs/);
  assert.match(
    source,
    /npm run eval:p1:release -- --live --confirm P1_RELEASE --reuse-retrieval/,
  );
});

test('P1.7 structured quota diagnostics are synthetic-only and blocked from client production', async () => {
  const structured = await readFile('scripts/evaluate-structured-ai.mjs', 'utf8');
  const api = await readFile('lib/atlas/api.ts', 'utf8');

  assert.match(structured, /P1_EVAL_EXPOSE_PROVIDER_DIAGNOSTIC: 'true'/);
  assert.match(structured, /providerDiagnostic: m\.providerDiagnostic \?\? null/);
  assert.doesNotMatch(structured, /m\.providerTrace\?\.attempts/);

  assert.match(api, /P1_EVAL_EXPOSE_PROVIDER_DIAGNOSTIC\?: string/);
  assert.match(api, /env\.APP_ENVIRONMENT !== 'PRODUCTION'/);
  assert.match(api, /env\.APP_EDITION !== 'client'/);
  assert.match(api, /telemetry\.attempts\.at\(-1\)\?\.diagnostic/);
});

test('P1.7 live workflow paces calls and keeps retries scenario-level and explicit', async () => {
  const source = await readFile(workflowPath, 'utf8');
  const pacing = await readFile('scripts/lib/live-eval-pacing.mjs', 'utf8');
  const structured = await readFile('scripts/evaluate-structured-ai.mjs', 'utf8');
  const contract = await readFile('evals/p1-release-contract.mjs', 'utf8');

  assert.match(source, /P1_LIVE_COMPLETION_MIN_INTERVAL_MS: '10000'/);
  assert.match(source, /P1_STRUCTURED_MAX_SCENARIO_RETRIES: '6'/);
  assert.match(pacing, /start-to-start pacing/);
  assert.match(pacing, /never retries provider calls/);
  assert.doesNotMatch(pacing, /providerCompletion|fetch\s*\(/);
  assert.match(structured, /maximumScenarioRetries: retryLimit/);
  assert.match(structured, /retryBackoffMs/);
  assert.match(structured, /retryPolicy\.plan/);
  assert.match(structured, /retryPolicy\.wait/);
  assert.match(structured, /providerDiagnostic/);
  assert.match(structured, /discardedProviderCalls/);
  assert.match(structured, /finalProviderCalls/);
  assert.match(structured, /retryUsageComplete/);
  assert.match(structured, /transientFallbackReasons/);
  assert.match(structured, /provider_rate_limited/);
  assert.match(structured, /response\.status !== 200 \|\| m\.fallback/);
  assert.match(structured, /while \(true\)/);
  assert.match(structured, /'upstream_rate_limited'/);
  assert.match(contract, /minimumCompletionPacingIntervalMs: 10000/);
  assert.match(contract, /transientRetryBackoffMs: 15000/);
  assert.match(contract, /rateLimitRetryMinMs: 60000/);
  assert.match(contract, /rateLimitRetryMaxMs: 60000/);
  assert.match(contract, /maximumScenarioRetries: 6/);
  assert.match(contract, /maximumRetryCompletionCalls: 30/);
  assert.match(contract, /maximumGenerationRetryCalls: 2/);
  assert.match(contract, /maximumValidationRetryCalls: 2/);
  assert.match(contract, /maximumLanguageCorrectionCalls: 2/);
  assert.match(contract, /maximumCitationCorrectionCalls: 2/);
  assert.match(contract, /maximumStructureCorrectionCalls: 2/);
  assert.match(contract, /maximumGenerationValidationCalls: 10/);
  assert.match(contract, /maximumLanguageCorrectionValidationCalls: 2/);
  assert.match(contract, /maximumCitationCorrectionCalls: 2/);
  assert.match(contract, /maximumStructureCorrectionCalls: 2/);
  assert.match(contract, /maximumGroundingRetryCalls: 8/);
  assert.match(contract, /minimumEmbeddingPacingIntervalMs: 4000/);
  assert.match(contract, /maximumEmbeddingRetries: 4/);
  assert.match(contract, /maximumEmbeddingRetriesPerSearch: 1/);
  assert.match(contract, /maximumTransientRetries: 2/);
  assert.match(contract, /backendTimeoutMs: 5000/);
  assert.match(contract, /backendRetryTimeoutMs: 10000/);
  assert.match(contract, /maximumBackendRetriesPerSearch: 1/);
  assert.match(contract, /maximumBackendRetryCalls: 4/);
  assert.match(contract, /maximumEmbeddingCalls: 24/);
  assert.match(contract, /maximumTotalCompletionCalls: 240/);
});

test('P1.7 classifies external provider blockers without weakening release gating', () => {
  const daily = classifyExternalQualificationBlocker({
    structured: {
      provider: 'gemini',
      model: 'gemini-3.5-flash-lite',
      operational: { systemicTransportFailure: 'provider_daily_quota_exhausted' },
    },
  });
  assert.deepEqual(daily, {
    category: 'external_dependency',
    dependency: 'llm_provider',
    stage: 'structured',
    code: 'provider_daily_quota_exhausted',
    provider: 'gemini',
    model: 'gemini-3.5-flash-lite',
    releaseBlocked: true,
    retryRecommended: false,
  });
  assert.equal(
    qualificationOutcome({
      releaseAllowed: false,
      automatedPassed: false,
      blocker: daily,
    }),
    'external_dependency_blocked',
  );

  const transient = classifyExternalQualificationBlocker({
    groundingReports: [
      {
        provider: 'gemini',
        model: 'gemini-3.5-flash-lite',
        systemicTransportFailure: 'provider_rate_limited',
      },
    ],
  });
  assert.equal(transient.stage, 'grounding');
  assert.equal(transient.retryRecommended, true);

  assert.equal(
    classifyExternalQualificationBlocker({
      generation: {
        provider: 'gemini',
        model: 'gemini-3.5-flash-lite',
        operational: { systemicTransportFailure: 'unsupported_claim' },
      },
    }),
    null,
  );
  assert.equal(
    qualificationOutcome({
      releaseAllowed: false,
      automatedPassed: false,
      blocker: null,
    }),
    'qualification_failed',
  );
  assert.equal(
    qualificationOutcome({
      releaseAllowed: false,
      automatedPassed: true,
      blocker: null,
    }),
    'human_review_required',
  );
  assert.equal(
    qualificationOutcome({
      releaseAllowed: true,
      automatedPassed: true,
      blocker: null,
    }),
    'release_qualified',
  );
});

test('P1.7 workflow surfaces external blockers explicitly but remains fail-closed', async () => {
  const source = await readFile(workflowPath, 'utf8');
  const release = await readFile('scripts/evaluate-p1-release.mjs', 'utf8');

  assert.match(release, /classifyExternalQualificationBlocker/);
  assert.match(release, /qualificationOutcome/);
  assert.match(release, /outcome,/);
  assert.match(release, /blocker,/);
  assert.match(source, /external_dependency_blocked/);
  assert.match(source, /P1\.7 blocked by external provider/);
  assert.match(source, /Release remains blocked/);
  assert.match(source, /process\.exit\(1\)/);
  assert.match(
    source,
    /Automated P1\.7 qualification failed due to an internal or quality gate/,
  );
});

test('P1.7 rate-limit retry policy waits a full quota window and refuses long/daily quota retries', () => {
  const backoff = liveTransientRetryBackoff({
    P1_LIVE_TRANSIENT_RETRY_BACKOFF_MS: '15000',
    P1_LIVE_RATE_LIMIT_RETRY_MIN_MS: '60000',
    P1_LIVE_RATE_LIMIT_RETRY_MAX_MS: '60000',
  });

  assert.deepEqual(
    backoff.plan('upstream_unavailable', 0, null),
    { retryable: true, delayMs: 15000, source: 'transient_backoff' },
  );
  assert.deepEqual(
    backoff.plan('upstream_rate_limited', 0, {
      retryAfterMs: 39000,
      rateLimitScope: 'minute',
    }),
    { retryable: true, delayMs: 60000, source: 'provider_advised_rate_limit' },
  );
  assert.deepEqual(
    backoff.plan('upstream_rate_limited', 0, {
      retryAfterMs: null,
      rateLimitScope: 'unknown',
    }),
    { retryable: true, delayMs: 60000, source: 'rate_limit_floor' },
  );
  assert.deepEqual(
    backoff.plan('upstream_rate_limited', 0, {
      retryAfterMs: null,
      rateLimitScope: 'day',
    }),
    { retryable: false, delayMs: 0, source: 'daily_quota' },
  );
  assert.deepEqual(
    backoff.plan('upstream_rate_limited', 0, {
      retryAfterMs: 61000,
      rateLimitScope: 'minute',
    }),
    {
      retryable: false,
      delayMs: 0,
      source: 'provider_retry_after_exceeds_window',
    },
  );
  assert.equal(rateLimitSystemicFailure('daily_quota'), 'provider_daily_quota_exhausted');
  assert.equal(
    rateLimitSystemicFailure('provider_retry_after_exceeds_window'),
    'provider_rate_limit_retry_window_exceeded',
  );
});

test('P1.7 release gate requires complete structured retry telemetry and exact final call accounting', async () => {
  const release = await readFile('scripts/evaluate-p1-release.mjs', 'utf8');

  assert.match(release, /finalProviderCalls === structuredTurns/);
  assert.match(
    release,
    /providerCalls ===\s*structured\.operational\?\.finalProviderCalls \+\s*structured\.operational\?\.discardedProviderCalls/s,
  );
  assert.match(release, /retryUsageComplete === true/);
  assert.match(release, /usageComplete === true/);
});

test('P1.7 structured evaluator never continues a scenario after a non-200 API response', async () => {
  const structured = await readFile('scripts/evaluate-structured-ai.mjs', 'utf8');

  assert.match(structured, /response\.status !== 200 \|\| m\.fallback/);
  assert.match(structured, /semantically unsafe to score/);
});

test('P1.7 live resilience is paced and retries only transport failures within explicit budgets', async () => {
  const pacing = await readFile('scripts/lib/live-eval-pacing.mjs', 'utf8');
  const retrieval = await readFile('scripts/evaluate-retrieval.mjs', 'utf8');
  const generation = await readFile('scripts/evaluate-generation.mjs', 'utf8');
  const grounding = await readFile('scripts/evaluate-grounding.mjs', 'utf8');
  const release = await readFile('scripts/evaluate-p1-release.mjs', 'utf8');

  assert.match(pacing, /P1_LIVE_EMBEDDING_MIN_INTERVAL_MS/);
  assert.match(pacing, /P1_LIVE_TRANSIENT_RETRY_BACKOFF_MS/);
  assert.match(pacing, /P1_LIVE_RATE_LIMIT_RETRY_MIN_MS/);
  assert.match(pacing, /P1_LIVE_RATE_LIMIT_RETRY_MAX_MS/);
  assert.match(pacing, /daily_quota/);
  assert.match(pacing, /provider_retry_after_exceeds_window/);
  assert.match(retrieval, /liveEmbeddingPacer/);
  assert.match(retrieval, /searchLexicalWithTransientRetries/);
  assert.match(retrieval, /options\.maxTransientRetries - transientRetriesUsed/);
  assert.match(retrieval, /maxTransientRetries/);
  assert.match(generation, /new Set\(\['network_or_timeout', 'upstream_unavailable', 'upstream_rate_limited'\]\)/);
  assert.match(grounding, /new Set\(\['network_or_timeout', 'upstream_unavailable', 'upstream_rate_limited'\]\)/);
  assert.match(generation, /systemicTransportFailure = 'provider_rate_limited'/);
  assert.match(grounding, /systemicTransportFailure = 'provider_rate_limited'/);
  assert.match(release, /--max-generation-retries/);
  assert.match(release, /--max-validation-retries/);
  assert.match(release, /--max-language-corrections/);
  assert.match(release, /--max-citation-corrections/);
  assert.match(release, /--max-structure-corrections/);
  assert.match(release, /--max-retries/);
  assert.match(release, /groundingRetryCompletionCalls/);
});

test('P1.7 release gate verifies exact generation/grounding corpus identity and retry accounting', async () => {
  const release = await readFile('scripts/evaluate-p1-release.mjs', 'utf8');

  assert.match(release, /generationScenarios\.slice/);
  assert.match(release, /generationCoverageGate/);
  assert.match(release, /expectedGenerationById/);
  assert.match(release, /generationRetriesUsed === generationRetryRows/);
  assert.match(release, /validationRetriesUsed === validationRetryRows/);
  assert.match(release, /languageCorrectionsUsed === languageCorrectionRows/);
  assert.match(release, /citationCorrectionsUsed === citationCorrectionRows/);
  assert.match(release, /structureCorrectionsUsed === structureCorrectionRows/);
  assert.match(release, /providerCalls === generationProviderAttemptRows/);

  assert.match(release, /expectedGroundingIds/);
  assert.match(release, /groundingCoverageGate/);
  assert.match(release, /groundingScenarios\.every\(\(scenario\) => groundingIds\.has\(scenario\.id\)\)/);
});

test('P1.7 generation structure correction is local-failure-only, bounded and fully accounted', async () => {
  const generation = await readFile('scripts/evaluate-generation.mjs', 'utf8');
  const natural = await readFile('lib/atlas/natural-generation.ts', 'utf8');
  const release = await readFile('scripts/evaluate-p1-release.mjs', 'utf8');
  const contract = await readFile('evals/p1-release-contract.mjs', 'utf8');

  assert.match(natural, /structure_mismatch/);
  assert.match(natural, /parseNaturalDraftContent/);
  assert.match(natural, /unsafe_generated_text/);
  assert.match(generation, /maxStructureCorrections/);
  assert.match(generation, /diagnostics\.reason === 'invalid_upstream_response'/);
  assert.match(generation, /diagnostics\.structureFailure/);
  assert.match(generation, /counters\.structureCorrections === 0/);
  assert.match(generation, /structureCorrectionsUsed < options\.maxStructureCorrections/);
  assert.match(release, /generationStructureCorrectionCalls/);
  assert.match(release, /structureCorrectionsUsed === structureCorrectionRows/);
  assert.match(release, /row\.structureFailures\.length === row\.structureCorrections/);
  assert.match(contract, /maximumStructureCorrectionCalls: 2/);
  assert.match(release, /generation\.status === 'requires_human_review'/);
});

test('P1.7 generation citation correction is separately governed and never replaces factual validation', async () => {
  const generation = await readFile('scripts/evaluate-generation.mjs', 'utf8');
  const natural = await readFile('lib/atlas/natural-generation.ts', 'utf8');
  const release = await readFile('scripts/evaluate-p1-release.mjs', 'utf8');
  const contract = await readFile('evals/p1-release-contract.mjs', 'utf8');

  assert.match(natural, /citation_mismatch/);
  assert.match(natural, /draftCitationFailure/);
  assert.match(natural, /failed evidence-reference validation/);
  assert.match(generation, /maxCitationCorrections/);
  assert.match(generation, /diagnostics\.reason === 'unknown_evidence_reference'/);
  assert.match(generation, /counters\.citationCorrections === 0/);
  assert.match(generation, /citationCorrectionsUsed < options\.maxCitationCorrections/);
  assert.doesNotMatch(
    generation,
    /factualValidation\?\.reason === 'unsupported_claim'.*citationCorrections/s,
  );
  assert.match(release, /generationCitationCorrectionCalls/);
  assert.match(release, /citationCorrectionsUsed === citationCorrectionRows/);
  assert.match(contract, /maximumCitationCorrectionCalls: 2/);
});

test('P1.7 generation language correction is bounded and does not retry factual semantic failures', async () => {
  const generation = await readFile('scripts/evaluate-generation.mjs', 'utf8');
  const natural = await readFile('lib/atlas/natural-generation.ts', 'utf8');
  const release = await readFile('scripts/evaluate-p1-release.mjs', 'utf8');

  assert.match(natural, /enum: \[expectedLanguage\]/);
  assert.match(natural, /detectConversationLanguageHint/);
  assert.match(natural, /previous candidate failed language validation/);
  assert.match(generation, /maxLanguageCorrections/);
  assert.match(generation, /factualValidation\?\.reason === 'output_language_mismatch'/);
  assert.doesNotMatch(
    generation,
    /factualValidation\?\.reason === 'unsupported_claim'.*languageCorrections/s,
  );
  assert.match(release, /generationLanguageCorrectionCalls/);
  assert.match(release, /generationLanguageCorrectionValidationCalls/);
});

test('P1.7 structured evaluator forwards the governed provider timeout into runtime env', async () => {
  const structured = await readFile('scripts/evaluate-structured-ai.mjs', 'utf8');

  assert.match(structured, /'LLM_REQUEST_TIMEOUT_MS'/);
  assert.match(structured, /Object\.assign\(c\.env, config\)/);
  assert.match(structured, /P1_STRUCTURED_MAX_SCENARIO_RETRIES/);
  assert.match(structured, /P1_STRUCTURED_RETRY_BACKOFF_MS/);
  assert.match(structured, /runScenario\(scenario\)/);
});

test('P1.7 grounding qualification fails fast on systemic request rejection', async () => {
  const grounding = await readFile('scripts/evaluate-grounding.mjs', 'utf8');
  const release = await readFile('scripts/evaluate-p1-release.mjs', 'utf8');

  assert.match(grounding, /rejectedStreak >= 3/);
  assert.match(grounding, /repeated_upstream_request_rejected/);
  assert.match(grounding, /systemicTransportFailure/);
  assert.match(release, /partial\?\.systemicTransportFailure/);
  assert.match(release, /if \(partial\?\.systemicTransportFailure\) break/);
});

test('P1.7 release runner uses one of the 70 grounding calls as an early factual smoke', async () => {
  const release = await readFile('scripts/evaluate-p1-release.mjs', 'utf8');
  const plan = await readFile('evals/p1-grounding-plan.mjs', 'utf8');

  assert.match(plan, /\{ offset: 0, maxCases: 1, maxRetries: 1 \}/);
  assert.match(plan, /\{ offset: 1, maxCases: 19, maxRetries: 2 \}/);
  assert.match(plan, /\{ offset: 20, maxCases: 20, maxRetries: 2 \}/);
  assert.match(plan, /\{ offset: 40, maxCases: 20, maxRetries: 2 \}/);
  assert.match(plan, /\{ offset: 60, maxCases: 10, maxRetries: 1 \}/);
  assert.match(release, /p1GroundingPlan\.map/);
  assert.match(release, /let continueQualification = smokeRun\.status === 0/);
  assert.match(release, /continueQualification = structuredRun\.status === 0/);
  assert.match(release, /continueQualification = generationRun\.status === 0/);
  assert.doesNotMatch(release, /groundingCalls:\s*contract\.grounding\.requiredScenarios\s*\+\s*1/);
});

test('P1.7 generation qualification factually validates every generated candidate', async () => {
  const generation = await readFile('scripts/evaluate-generation.mjs', 'utf8');
  const release = await readFile('scripts/evaluate-p1-release.mjs', 'utf8');

  assert.match(generation, /validateNaturalDraft/);
  assert.match(generation, /LLM_VALIDATION_MODE: 'shadow'/);
  assert.match(generation, /factualValidation/);
  assert.match(generation, /groundedness/);
  assert.match(release, /row\.factualValidation\?\.outcome === 'supported_candidate'/);
  assert.match(release, /row\.groundedness === true/);
});

test('P1.7 grounding uses server-owned semantic status evidence instead of raw status codes', async () => {
  const grounding = await readFile('evals/grounding.mjs', 'utf8');

  for (const family of ['waiting-status', 'wrong-status', 'partial-truth', 'judge-injection']) {
    const at = grounding.indexOf(`'${family}'`);
    assert.ok(at >= 0, `missing grounding family ${family}`);
    assert.match(grounding.slice(at, at + 260), /'case\.statusLabel'/);
  }
});

test('P1.7 grounding requires the expected semantic rejection, not any block', () => {
  const supported = {
    expectedSupported: true,
    expectedIssue: null,
    diagnostics: { outcome: 'supported_candidate', reason: null, issues: [] },
  };
  const correctNegative = {
    expectedSupported: false,
    expectedIssue: 'date',
    diagnostics: { outcome: 'blocked', reason: 'unsupported_claim', issues: ['date'] },
  };
  const wrongReason = {
    expectedSupported: false,
    expectedIssue: 'date',
    diagnostics: { outcome: 'blocked', reason: 'output_language_mismatch', issues: ['language'] },
  };
  const wrongIssue = {
    expectedSupported: false,
    expectedIssue: 'date',
    diagnostics: { outcome: 'blocked', reason: 'unsupported_claim', issues: ['status'] },
  };

  assert.equal(groundingDecisionPasses(supported), true);
  assert.equal(groundingDecisionPasses(correctNegative), true);
  assert.equal(groundingDecisionPasses(wrongReason), false);
  assert.equal(groundingDecisionPasses(wrongIssue), false);
});

test('P1.7 release diagnostics distinguish fail-fast skips from missing artifacts', async () => {
  const release = await readFile('scripts/evaluate-p1-release.mjs', 'utf8');
  const structured = await readFile('scripts/evaluate-structured-ai.mjs', 'utf8');

  assert.match(structured, /semanticFailures/);
  assert.match(structured, /failedChecks/);
  assert.match(release, /attemptedReports/);
  assert.match(release, /skippedReports/);
  assert.match(release, /skipped_due_to_prior_gate/);
  assert.match(release, /readFailures\.length === 0 && skippedReports\.length === 0/);
  assert.match(release, /semanticFailures: structured\.semanticFailures \?\? \[\]/);
  assert.doesNotMatch(
    release,
    /if \(!attemptedReports\[name\]\)\s*\{\s*readFailures\.push/s,
  );
});

test('P1.7 live workflow remains fail-closed until human review', async () => {
  const source = await readFile(workflowPath, 'utf8');

  assert.match(source, /P1_RELEASE_MODE: off/);
  assert.doesNotMatch(source, /P1_RELEASE_MODE:\s*(?:canary|on)/);
  assert.match(source, /continue-on-error: true/);
  assert.match(source, /report\.automatedPassed !== true/);
  assert.match(source, /report\.releaseAllowed !== false/);
  assert.match(source, /human_review_required/);
  assert.match(source, /eval:p1:review-template/);
  assert.match(source, /human-review\.json/);
});

test('P1.7 workflow exports only bounded qualification artifacts and no automatic rollout', async () => {
  const source = await readFile(workflowPath, 'utf8');

  assert.match(
    source,
    /actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a\s+# v7\.0\.1/,
  );
  assert.match(source, /path: outputs\/p1-live\//);
  assert.match(source, /retention-days: 7/);
  assert.doesNotMatch(source, /P1_CANARY_PERCENT/);
  assert.doesNotMatch(source, /eval:p1:finalize/);
  assert.doesNotMatch(source, /workflow_run:/);
});

test('P1.7 workflow supports separate embedding credentials with same-provider fallback', async () => {
  const source = await readFile(workflowPath, 'utf8');

  assert.match(source, /EMBEDDING_API_KEY: \$\{\{ secrets\.EMBEDDING_API_KEY \}\}/);
  assert.match(source, /EMBEDDING_PROVIDER/);
  assert.match(source, /GEMINI_API_KEY/);
  assert.match(source, /OPENAI_API_KEY/);
  assert.match(source, /GITHUB_ENV/);
  assert.match(source, /gemini-embedding-2/);
  assert.match(source, /Gemini P1\.7 qualification requires EMBEDDING_MODEL=gemini-embedding-2/);
  assert.match(source, /OpenAI embeddings require budget_mode=approved/);
});
