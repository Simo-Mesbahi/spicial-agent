import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { groundingDecisionPasses } from '../evals/grounding.mjs';

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
  assert.match(source, /P1_LIVE_COMPLETION_MIN_INTERVAL_MS: '7500'/);
  assert.match(source, /P1_LIVE_EMBEDDING_MIN_INTERVAL_MS: '3000'/);
  assert.match(source, /P1_LIVE_TRANSIENT_RETRY_BACKOFF_MS: '15000'/);
  assert.match(source, /P1_STRUCTURED_MAX_SCENARIO_RETRIES: '6'/);
  assert.match(source, /P1_STRUCTURED_RETRY_BACKOFF_MS: '15000'/);
  assert.match(source, /default: gemini-3\.5-flash-lite/);
  assert.match(source, /RAG_MIN_SIMILARITY: '0.7'/);

  const retrievalPreflightIndex = source.indexOf(
    'Qualify live hybrid retrieval before completion spend',
  );
  assert.ok(retrievalPreflightIndex > verifyIndex);
  assert.ok(retrievalPreflightIndex < liveIndex);
  assert.match(source, /scripts\/evaluate-retrieval\.mjs/);
  assert.match(source, /scripts\/check-retrieval-qualification\.mjs/);
  assert.match(
    source,
    /npm run eval:p1:release -- --live --confirm P1_RELEASE --reuse-retrieval/,
  );
});

test('P1.7 live workflow paces calls and keeps retries scenario-level and explicit', async () => {
  const source = await readFile(workflowPath, 'utf8');
  const pacing = await readFile('scripts/lib/live-eval-pacing.mjs', 'utf8');
  const structured = await readFile('scripts/evaluate-structured-ai.mjs', 'utf8');
  const contract = await readFile('evals/p1-release-contract.mjs', 'utf8');

  assert.match(source, /P1_LIVE_COMPLETION_MIN_INTERVAL_MS: '7500'/);
  assert.match(source, /P1_STRUCTURED_MAX_SCENARIO_RETRIES: '6'/);
  assert.match(pacing, /start-to-start pacing/);
  assert.match(pacing, /never retries provider calls/);
  assert.doesNotMatch(pacing, /providerCompletion|fetch\s*\(/);
  assert.match(structured, /maximumScenarioRetries: retryLimit/);
  assert.match(structured, /retryBackoffMs/);
  assert.match(structured, /setTimeout\(resolve, retryBackoffMs\)/);
  assert.match(structured, /discardedProviderCalls/);
  assert.match(structured, /transientFallbackReasons/);
  assert.match(structured, /provider_rate_limited/);
  assert.match(structured, /if \(m\.fallback\) break/);
  assert.match(structured, /while \(true\)/);
  assert.doesNotMatch(structured, /'upstream_rate_limited',\s*\n\s*'upstream_unavailable'/);
  assert.match(contract, /maximumScenarioRetries: 6/);
  assert.match(contract, /maximumRetryCompletionCalls: 30/);
  assert.match(contract, /maximumGenerationRetryCalls: 2/);
  assert.match(contract, /maximumValidationRetryCalls: 2/);
  assert.match(contract, /maximumGenerationValidationCalls: 10/);
  assert.match(contract, /maximumGroundingRetryCalls: 8/);
  assert.match(contract, /maximumTotalCompletionCalls: 232/);
});

test('P1.7 live resilience is paced and retries only transport failures within explicit budgets', async () => {
  const pacing = await readFile('scripts/lib/live-eval-pacing.mjs', 'utf8');
  const retrieval = await readFile('scripts/evaluate-retrieval.mjs', 'utf8');
  const generation = await readFile('scripts/evaluate-generation.mjs', 'utf8');
  const grounding = await readFile('scripts/evaluate-grounding.mjs', 'utf8');
  const release = await readFile('scripts/evaluate-p1-release.mjs', 'utf8');

  assert.match(pacing, /P1_LIVE_EMBEDDING_MIN_INTERVAL_MS/);
  assert.match(pacing, /P1_LIVE_TRANSIENT_RETRY_BACKOFF_MS/);
  assert.match(retrieval, /liveEmbeddingPacer/);
  assert.match(generation, /new Set\(\['network_or_timeout', 'upstream_unavailable'\]\)/);
  assert.match(grounding, /new Set\(\['network_or_timeout', 'upstream_unavailable'\]\)/);
  assert.doesNotMatch(generation, /retryableTransportReasons.*upstream_rate_limited/s);
  assert.doesNotMatch(grounding, /retryableTransportReasons.*upstream_rate_limited/s);
  assert.match(release, /--max-generation-retries/);
  assert.match(release, /--max-validation-retries/);
  assert.match(release, /--max-retries/);
  assert.match(release, /groundingRetryCompletionCalls/);
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

  assert.match(source, /actions\/upload-artifact@v4/);
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
