import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

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
  assert.match(source, /LLM_REQUEST_TIMEOUT_MS: '30000'/);
  assert.match(source, /LLM_GENERATION_TIMEOUT_MS: '12000'/);
  assert.match(source, /LLM_VALIDATION_TIMEOUT_MS: '12000'/);
  assert.match(source, /P1_LIVE_COMPLETION_MIN_INTERVAL_MS: '7500'/);
  assert.match(source, /P1_STRUCTURED_MAX_SCENARIO_RETRIES: '6'/);
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
  assert.match(structured, /discardedProviderCalls/);
  assert.match(structured, /transientFallbackReasons/);
  assert.match(contract, /maximumScenarioRetries: 6/);
  assert.match(contract, /maximumRetryCompletionCalls: 30/);
  assert.match(contract, /maximumTotalCompletionCalls: 210/);
});

test('P1.7 structured evaluator forwards the governed provider timeout into runtime env', async () => {
  const structured = await readFile('scripts/evaluate-structured-ai.mjs', 'utf8');

  assert.match(structured, /'LLM_REQUEST_TIMEOUT_MS'/);
  assert.match(structured, /Object\.assign\(c\.env, config\)/);
  assert.match(structured, /P1_STRUCTURED_MAX_SCENARIO_RETRIES/);
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

  assert.match(release, /\{ offset: 0, maxCases: 1 \}/);
  assert.match(release, /\{ offset: 1, maxCases: 19 \}/);
  assert.match(release, /\{ offset: 20, maxCases: 20 \}/);
  assert.match(release, /\{ offset: 40, maxCases: 20 \}/);
  assert.match(release, /\{ offset: 60, maxCases: 10 \}/);
  assert.match(release, /let continueQualification = smokeRun\.status === 0/);
  assert.match(release, /continueQualification = structuredRun\.status === 0/);
  assert.match(release, /continueQualification = generationRun\.status === 0/);
  assert.doesNotMatch(release, /groundingCalls:\s*contract\.grounding\.requiredScenarios\s*\+\s*1/);
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
