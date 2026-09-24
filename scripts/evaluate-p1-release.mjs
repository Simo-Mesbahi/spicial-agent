#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';

import { generationScenarios } from '../evals/generation.mjs';
import { groundingDecisionPasses, groundingScenarios } from '../evals/grounding.mjs';
import {
  groundingReportPath,
  p1GroundingMaximumRetryCalls,
  p1GroundingPlan,
} from '../evals/p1-grounding-plan.mjs';
import { p1ReleaseQualificationContract as contract } from '../evals/p1-release-contract.mjs';

const args = process.argv.slice(2);
const value = (flag, fallback = null) =>
  args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback;

const live = args.includes('--live');
const finalizeExisting = args.includes('--finalize-existing');
const reuseRetrieval = args.includes('--reuse-retrieval');
if (live && finalizeExisting)
  throw new Error('Choose either --live or --finalize-existing, never both.');
if (reuseRetrieval && !live)
  throw new Error('--reuse-retrieval is valid only with --live.');

const structuredTurns = Number(value('--structured-turns', String(contract.structured.minimumTurns)));
const qualificationReportPath = resolve(
  value('--qualification-report', 'outputs/p1-live/release-qualification.json'),
);
const output = resolve(
  value(
    '--output',
    finalizeExisting
      ? 'outputs/p1-live/release-final.json'
      : 'outputs/p1-live/release-qualification.json',
  ),
);
const humanReviewPath = value('--human-review', null);
const confirmation = value('--confirm', '');

if (
  !Number.isInteger(structuredTurns) ||
  structuredTurns < contract.structured.minimumTurns ||
  structuredTurns > contract.structured.maximumTurns
)
  throw new Error(
    `--structured-turns must be an integer between ${contract.structured.minimumTurns} and ${contract.structured.maximumTurns}`,
  );

const groundingPlan = p1GroundingPlan.map((entry) => ({
  ...entry,
  path: resolve(groundingReportPath(entry)),
}));

const paths = {
  structured: resolve('outputs/p1-live/structured.json'),
  retrieval: resolve('outputs/p1-live/retrieval.json'),
  generation: resolve('outputs/p1-live/generation.json'),
  grounding: groundingPlan.map((entry) => entry.path),
};

const plannedCalls = {
  structuredCompletionCalls: structuredTurns,
  structuredRetryCompletionCalls: contract.structured.maximumRetryCompletionCalls,
  generationCalls: contract.generation.requiredScenarios,
  generationRetryCompletionCalls: contract.generation.maximumGenerationRetryCalls,
  generationLanguageCorrectionCalls:
    contract.generation.maximumLanguageCorrectionCalls,
  generationValidationCalls: contract.generation.requiredValidationCalls,
  generationValidationRetryCompletionCalls:
    contract.generation.maximumValidationRetryCalls,
  generationLanguageCorrectionValidationCalls:
    contract.generation.maximumLanguageCorrectionCalls,
  groundingCalls: contract.grounding.requiredScenarios,
  groundingRetryCompletionCalls: contract.grounding.maximumRetryCalls,
  embeddingCalls: contract.retrieval.requiredQueries,
  completionCalls:
    structuredTurns +
    contract.structured.maximumRetryCompletionCalls +
    contract.generation.requiredScenarios +
    contract.generation.maximumGenerationRetryCalls +
    contract.generation.maximumLanguageCorrectionCalls +
    contract.generation.requiredValidationCalls +
    contract.generation.maximumValidationRetryCalls +
    contract.generation.maximumLanguageCorrectionCalls +
    contract.grounding.requiredScenarios +
    contract.grounding.maximumRetryCalls,
};

if (
  plannedCalls.structuredCompletionCalls > contract.liveBudget.maximumStructuredCompletionCalls ||
  plannedCalls.structuredRetryCompletionCalls > contract.structured.maximumRetryCompletionCalls ||
  plannedCalls.generationCalls > contract.liveBudget.maximumGenerationCalls ||
  plannedCalls.generationRetryCompletionCalls >
    contract.liveBudget.maximumGenerationRetryCalls ||
  plannedCalls.generationLanguageCorrectionCalls >
    contract.liveBudget.maximumLanguageCorrectionCalls ||
  plannedCalls.generationValidationCalls >
    contract.liveBudget.maximumGenerationValidationCalls ||
  plannedCalls.generationValidationRetryCompletionCalls >
    contract.liveBudget.maximumGenerationValidationRetryCalls ||
  plannedCalls.generationLanguageCorrectionValidationCalls >
    contract.liveBudget.maximumLanguageCorrectionValidationCalls ||
  plannedCalls.groundingCalls > contract.liveBudget.maximumGroundingCalls ||
  plannedCalls.groundingRetryCompletionCalls >
    contract.liveBudget.maximumGroundingRetryCalls ||
  p1GroundingMaximumRetryCalls !== contract.grounding.maximumRetryCalls ||
  plannedCalls.embeddingCalls > contract.liveBudget.maximumEmbeddingCalls ||
  plannedCalls.completionCalls > contract.liveBudget.maximumTotalCompletionCalls
)
  throw new Error('Qualification plan exceeds the governed live-call budget.');

if (!live && !finalizeExisting) {
  console.log(
    JSON.stringify(
      {
        status: 'dry_run',
        releaseAllowed: false,
        contract,
        plannedCalls,
        outputs: paths,
        requirements: {
          provider: 'configured hosted provider; demo is rejected by child evaluators',
          embeddings: 'configured 768-dimensional multilingual provider',
          confirmation: '--live --confirm P1_RELEASE',
          humanReview:
            'A reviewed JSON file is required before releaseAllowed can become true.',
        },
        note: 'No provider, embedding or Supabase evaluation request was sent.',
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

if (live && confirmation !== 'P1_RELEASE')
  throw new Error(
    'Live qualification is cost-bearing. Re-run with --live --confirm P1_RELEASE after reviewing the planned call budget.',
  );

const source = sourceTreeState();
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let qualificationScope = { organizationId: null };
let priorQualification = null;
let priorQualificationError = null;

if (live) {
  const organizationId = process.env.SUPABASE_ORGANIZATION_ID?.trim() ?? '';
  if (!UUID.test(organizationId))
    throw new Error(
      'SUPABASE_ORGANIZATION_ID must be a valid UUID before live qualification.',
    );
  qualificationScope = { organizationId };
}

if (finalizeExisting) {
  try {
    priorQualification = await readJson(qualificationReportPath);
    const organizationId = priorQualification?.scope?.organizationId ?? '';
    if (!UUID.test(organizationId))
      throw new Error('Source qualification has no valid organization scope.');
    const configuredOrganizationId = process.env.SUPABASE_ORGANIZATION_ID?.trim();
    if (configuredOrganizationId && configuredOrganizationId !== organizationId)
      throw new Error('Configured organization does not match the source qualification.');
    qualificationScope = { organizationId };
  } catch (error) {
    priorQualificationError =
      error instanceof Error ? error.message : String(error);
  }
}

if (finalizeExisting && !humanReviewPath)
  throw new Error(
    '--finalize-existing requires --human-review and reuses existing qualification reports without provider calls.',
  );
if (finalizeExisting && output === qualificationReportPath)
  throw new Error(
    'Finalization output must not overwrite the original live qualification report.',
  );

await mkdir(dirname(output), { recursive: true });

function runNode(script, scriptArgs) {
  const result = spawnSync(process.execPath, [script, ...scriptArgs], {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return {
    command: [process.execPath, script, ...scriptArgs].join(' '),
    status: result.status,
    signal: result.signal,
    stderr: (result.stderr ?? '').slice(-4000),
    stdoutTail: (result.stdout ?? '').slice(-4000),
  };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function fileSha256(path) {
  const raw = await readFile(path, 'utf8');
  return createHash('sha256').update(raw).digest('hex');
}

function valueSha256(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function textSha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function git(args) {
  const result = spawnSync('git', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0)
    throw new Error(
      `git ${args.join(' ')} failed: ${(result.stderr ?? '').trim() || 'unknown error'}`,
    );
  return (result.stdout ?? '').trim();
}

function retrievalRowPasses(row) {
  const hybrid = row?.hybrid ?? {};
  const lexical = row?.lexical ?? {};
  const embedding = hybrid.retrieval?.embedding;
  return (
    hybrid.scope === 'supabase_published' &&
    lexical.scope === 'supabase_published' &&
    hybrid.recallAtK >= contract.retrieval.minimumHybridRecallAtK &&
    hybrid.precisionAtK >= contract.retrieval.minimumHybridPrecisionAtK &&
    (contract.retrieval.allowRecallRegressionVsLexical ||
      hybrid.recallAtK >= lexical.recallAtK) &&
    (!contract.retrieval.requireEmbeddingSuccess ||
      (embedding?.calls === 1 && embedding?.error === null))
  );
}

function retrievalReportPasses(report) {
  const rows = Array.isArray(report?.results) ? report.results : [];
  return Boolean(
    report &&
      report.status === 'completed' &&
      report.completionCalls === contract.retrieval.completionCalls &&
      rows.length === contract.retrieval.requiredQueries &&
      rows.every(retrievalRowPasses),
  );
}

function reusedRetrievalMatchesEnvironment(report) {
  const configuration = report?.configuration ?? {};
  const createdAt = Date.parse(report?.createdAt ?? '');
  const fresh =
    Number.isFinite(createdAt) &&
    createdAt <= Date.now() + 5 * 60_000 &&
    createdAt >= Date.now() - 30 * 60_000;
  return (
    fresh &&
    configuration.queryContract === contract.retrieval.queryContract &&
    configuration.embeddingProvider === process.env.EMBEDDING_PROVIDER &&
    configuration.embeddingModel === process.env.EMBEDDING_MODEL &&
    configuration.embeddingRevision === (process.env.EMBEDDING_REVISION ?? '1') &&
    configuration.corpusLocale === (process.env.RAG_CORPUS_LOCALE ?? contract.retrieval.corpusLocale) &&
    configuration.market === (process.env.RAG_MARKET ?? 'GLOBAL') &&
    configuration.minSimilarity === Number(process.env.RAG_MIN_SIMILARITY ?? '0.7') &&
    configuration.minLexicalScore === Number(process.env.RAG_MIN_LEXICAL_SCORE ?? '3')
  );
}

function sourceTreeState() {
  const treeSha = git(['rev-parse', 'HEAD^{tree}']);
  const trackedChanges = git(['status', '--porcelain', '--untracked-files=no']);
  if (!/^[a-f0-9]{40,64}$/.test(treeSha))
    throw new Error('Unable to resolve a valid Git source tree SHA.');
  if (trackedChanges)
    throw new Error(
      'Tracked working-tree changes detected. Commit or revert them before live qualification/finalization.',
    );
  return { treeSha };
}

const executions = [];

if (live) {
  if (reuseRetrieval) {
    const preflight = await readJson(paths.retrieval);
    if (!retrievalReportPasses(preflight) || !reusedRetrievalMatchesEnvironment(preflight))
      throw new Error(
        'Reused retrieval preflight is stale, misconfigured, or below the P1.7 release contract.',
      );
  } else {
    executions.push(
      runNode('scripts/evaluate-retrieval.mjs', [
        '--live',
        '--max-queries',
        String(contract.retrieval.requiredQueries),
        '--output',
        paths.retrieval,
      ]),
    );
  }

  const smoke = groundingPlan[0];
  const smokeRun = runNode('scripts/evaluate-grounding.mjs', [
    '--live',
    '--offset',
    String(smoke.offset),
    '--max-cases',
    String(smoke.maxCases),
    '--max-retries',
    String(smoke.maxRetries),
    '--output',
    smoke.path,
  ]);
  executions.push(smokeRun);

  let continueQualification = smokeRun.status === 0;

  if (continueQualification) {
    const structuredRun = runNode('scripts/evaluate-structured-ai.mjs', [
      '--live',
      '--mode',
      'structured',
      '--max-turns',
      String(structuredTurns),
      '--languages',
      contract.supportedLanguages.join(','),
      '--families',
      contract.structured.requiredFamilies.join(','),
      '--output',
      paths.structured,
    ]);
    executions.push(structuredRun);
    continueQualification = structuredRun.status === 0;
  }

  if (continueQualification) {
    const generationRun = runNode('scripts/evaluate-generation.mjs', [
      '--live',
      '--max-cases',
      String(contract.generation.requiredScenarios),
      '--max-generation-retries',
      String(contract.generation.maximumGenerationRetryCalls),
      '--max-validation-retries',
      String(contract.generation.maximumValidationRetryCalls),
      '--max-language-corrections',
      String(contract.generation.maximumLanguageCorrectionCalls),
      '--output',
      paths.generation,
    ]);
    executions.push(generationRun);
    continueQualification = generationRun.status === 0;
  }

  if (continueQualification) {
    for (const entry of groundingPlan.slice(1)) {
      const groundingRun = runNode('scripts/evaluate-grounding.mjs', [
        '--live',
        '--offset',
        String(entry.offset),
        '--max-cases',
        String(entry.maxCases),
        '--max-retries',
        String(entry.maxRetries),
        '--output',
        entry.path,
      ]);
      executions.push(groundingRun);
      if (groundingRun.status !== 0) {
        try {
          const partial = await readJson(entry.path);
          if (partial?.systemicTransportFailure) break;
        } catch {
          // The normal report-read gate below records unreadable artifacts fail-closed.
        }
      }
    }
  }
}
const subprocessFailures = executions
  .filter((run) => run.status !== 0)
  .map((run) => ({
    command: run.command,
    status: run.status,
    signal: run.signal,
    stderr: run.stderr,
    stdoutTail: run.stdoutTail,
  }));

let structured = null;
let retrieval = null;
let generation = null;
const groundingReports = [];
const readFailures = [];

for (const [name, path] of [
  ['structured', paths.structured],
  ['retrieval', paths.retrieval],
  ['generation', paths.generation],
]) {
  try {
    const parsed = await readJson(path);
    if (name === 'structured') structured = parsed;
    if (name === 'retrieval') retrieval = parsed;
    if (name === 'generation') generation = parsed;
  } catch (error) {
    readFailures.push({ name, path, error: error instanceof Error ? error.message : String(error) });
  }
}

for (const path of paths.grounding) {
  try {
    groundingReports.push(await readJson(path));
  } catch (error) {
    readFailures.push({
      name: 'grounding',
      path,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

let artifacts = null;
let qualificationId = null;
if (readFailures.length === 0) {
  try {
    artifacts = {
      sourceTreeSha: source.treeSha,
      contractSha256: valueSha256(contract),
      structuredSha256: await fileSha256(paths.structured),
      retrievalSha256: await fileSha256(paths.retrieval),
      generationSha256: await fileSha256(paths.generation),
      groundingSha256: await Promise.all(paths.grounding.map((path) => fileSha256(path))),
    };
    qualificationId = valueSha256({ scope: qualificationScope, artifacts });
  } catch (error) {
    readFailures.push({
      name: 'artifact_hashing',
      path: null,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

let qualificationAnchor = {
  required: finalizeExisting,
  valid: !finalizeExisting,
  path: finalizeExisting ? qualificationReportPath : null,
  reason: finalizeExisting ? 'not_checked' : null,
  sourceQualificationId: null,
};

if (finalizeExisting) {
  const prior = priorQualification;
  const valid =
    !priorQualificationError &&
    prior?.schema === 1 &&
    prior?.kind === 'p1-live-release-qualification' &&
    prior?.runMode === 'live' &&
    prior?.automatedPassed === true &&
    prior?.scope?.organizationId === qualificationScope.organizationId &&
    prior?.artifacts &&
    artifacts &&
    JSON.stringify(prior.artifacts) === JSON.stringify(artifacts) &&
    prior?.qualificationId === qualificationId &&
    prior?.artifacts?.contractSha256 === valueSha256(contract) &&
    prior?.artifacts?.sourceTreeSha === source.treeSha;

  qualificationAnchor = {
    required: true,
    valid: Boolean(valid),
    path: qualificationReportPath,
    reason: valid
      ? null
      : priorQualificationError || 'artifact_contract_or_scope_mismatch',
    sourceQualificationId:
      typeof prior?.qualificationId === 'string' ? prior.qualificationId : null,
  };
}

const structuredMetrics = structured?.metrics ?? {};
const expectedStructuredScenarios = contract.structured.requiredFamilies.flatMap((family) =>
  contract.supportedLanguages.map((language) => `pre-p1-${family}-${language}`),
);
const structuredScenarios = Array.isArray(structured?.scenarios) ? structured.scenarios : [];
const structuredScenarioSet = new Set(structuredScenarios);
const structuredLanguageCoverage = Object.fromEntries(
  contract.supportedLanguages.map((language) => [
    language,
    structuredScenarios.filter((id) => id.endsWith(`-${language}`)).length *
      contract.structured.turnsPerScenario,
  ]),
);
const structuredCoverageGate =
  structuredScenarios.length === expectedStructuredScenarios.length &&
  new Set(structuredScenarios).size === structuredScenarios.length &&
  expectedStructuredScenarios.every((id) => structuredScenarioSet.has(id)) &&
  contract.supportedLanguages.every(
    (language) =>
      structuredLanguageCoverage[language] >= contract.structured.minimumTurnsPerLanguage,
  );

const structuredGate = Boolean(
  structured &&
    structured.mode === 'structured' &&
    structured.turns === structuredTurns &&
    structured.turns >= contract.structured.minimumTurns &&
    structuredCoverageGate &&
    structured.operational?.apiFailures === contract.structured.apiFailures &&
    structured.operational?.fallbackCount === contract.structured.fallbackCount &&
    structured.operational?.retriedScenarios <= contract.structured.maximumScenarioRetries &&
    structured.operational?.discardedProviderCalls <=
      contract.structured.maximumRetryCompletionCalls &&
    structured.operational?.finalProviderCalls === structuredTurns &&
    structured.operational?.providerCalls ===
      structured.operational?.finalProviderCalls +
        structured.operational?.discardedProviderCalls &&
    structured.operational?.providerCalls <=
      structuredTurns + contract.structured.maximumRetryCompletionCalls &&
    structured.operational?.groundingRejections === contract.structured.groundingRejections &&
    (!contract.structured.requireCompleteUsage ||
      (structured.operational?.usageComplete === true &&
        structured.operational?.retryUsageComplete === true)) &&
    Object.values(structuredMetrics).every(
      (metric) =>
        metric &&
        metric.observed > 0 &&
        metric.missing === 0 &&
        metric.accuracy === contract.structured.requiredMetricAccuracy,
    ),
);

const retrievalRows = retrieval?.results ?? [];
const retrievalGate = retrievalReportPasses(retrieval);

const generationRows = generation?.results ?? [];
const expectedGenerationScenarios = generationScenarios.slice(
  0,
  contract.generation.requiredScenarios,
);
const expectedGenerationById = new Map(
  expectedGenerationScenarios.map((scenario) => [scenario.id, scenario]),
);
const generationIds = generationRows.map((row) => row.id);
const generationCoverageGate =
  expectedGenerationScenarios.length === contract.generation.requiredScenarios &&
  generationRows.length === contract.generation.requiredScenarios &&
  new Set(generationIds).size === generationIds.length &&
  generationIds.every((id) => expectedGenerationById.has(id)) &&
  expectedGenerationScenarios.every((scenario) =>
    generationIds.includes(scenario.id),
  ) &&
  generationRows.every(
    (row) => expectedGenerationById.get(row.id)?.language === row.language,
  );
const generationRetryRows = generationRows.reduce(
  (total, row) => total + (row.generationRetries ?? 0),
  0,
);
const validationRetryRows = generationRows.reduce(
  (total, row) => total + (row.validationRetries ?? 0),
  0,
);
const languageCorrectionRows = generationRows.reduce(
  (total, row) => total + (row.languageCorrections ?? 0),
  0,
);
const generationProviderAttemptRows = generationRows.reduce(
  (total, row) =>
    total +
    (Array.isArray(row.providerAttempts) ? row.providerAttempts.length : 0) +
    (Array.isArray(row.factualValidationAttempts)
      ? row.factualValidationAttempts.length
      : 0),
  0,
);
const generationGate = Boolean(
  generation &&
    generationCoverageGate &&
    generation.operational?.generationRetriesUsed === generationRetryRows &&
    generation.operational?.validationRetriesUsed === validationRetryRows &&
    generation.operational?.languageCorrectionsUsed === languageCorrectionRows &&
    generation.operational?.providerCalls === generationProviderAttemptRows &&
    generation.operational?.generationRetriesUsed <=
      contract.generation.maximumGenerationRetryCalls &&
    generation.operational?.validationRetriesUsed <=
      contract.generation.maximumValidationRetryCalls &&
    generation.operational?.languageCorrectionsUsed <=
      contract.generation.maximumLanguageCorrectionCalls &&
    generation.operational?.providerCalls <=
      contract.generation.requiredScenarios +
        contract.generation.maximumGenerationRetryCalls +
        contract.generation.maximumLanguageCorrectionCalls +
        contract.generation.requiredValidationCalls +
        contract.generation.maximumValidationRetryCalls +
        contract.generation.maximumLanguageCorrectionCalls &&
    generationRows.every(
      (row) =>
        row.draft &&
        row.diagnostics?.outcome === 'candidate_generated' &&
        row.diagnostics?.reason === null &&
        row.diagnostics?.calls === 1 &&
        Number.isInteger(row.generationRetries) &&
        row.generationRetries >= 0 &&
        Number.isInteger(row.languageCorrections) &&
        row.languageCorrections >= 0 &&
        row.languageCorrections <= 1 &&
        row.factualValidation?.outcome === 'supported_candidate' &&
        row.factualValidation?.reason === null &&
        row.factualValidation?.issues?.length === 0 &&
        row.factualValidation?.calls === 1 &&
        Number.isInteger(row.validationRetries) &&
        row.validationRetries >= 0 &&
        row.groundedness === true,
    ),
);

const groundingRows = groundingReports.flatMap((report) => report.results ?? []);
const groundingIds = new Set(groundingRows.map((row) => row.id));
const expectedGroundingIds = new Set(groundingScenarios.map((scenario) => scenario.id));
const groundingCoverageGate =
  groundingScenarios.length === contract.grounding.requiredScenarios &&
  groundingRows.length === contract.grounding.requiredScenarios &&
  groundingIds.size === contract.grounding.requiredScenarios &&
  expectedGroundingIds.size === contract.grounding.requiredScenarios &&
  groundingScenarios.every((scenario) => groundingIds.has(scenario.id));
const groundingNegatives = groundingRows.filter((row) => !row.expectedSupported);
const groundingPositives = groundingRows.filter((row) => row.expectedSupported);
const falseSupports = groundingNegatives.filter(
  (row) => row.diagnostics?.outcome === 'supported_candidate',
).length;
const abstentions = groundingRows.filter((row) =>
  ['abstained', 'skipped'].includes(row.diagnostics?.outcome),
).length;
const supported = groundingPositives.filter(
  (row) => row.diagnostics?.outcome === 'supported_candidate',
).length;
const groundingDecisionFailures = groundingRows.filter(
  (row) => !groundingDecisionPasses(row),
);
const groundingIssueMatches = groundingNegatives.filter(
  (row) =>
    row.diagnostics?.outcome === 'blocked' &&
    row.diagnostics?.reason === 'unsupported_claim' &&
    row.diagnostics?.issues?.includes(row.expectedIssue),
).length;
const groundingMetrics = {
  measuredScenarios: groundingRows.length,
  uniqueScenarios: groundingIds.size,
  falseSupportRate: groundingNegatives.length
    ? falseSupports / groundingNegatives.length
    : null,
  abstentionRate: groundingRows.length ? abstentions / groundingRows.length : null,
  supportedRecall: groundingPositives.length ? supported / groundingPositives.length : null,
  decisionAccuracy: groundingRows.length
    ? (groundingRows.length - groundingDecisionFailures.length) / groundingRows.length
    : null,
  issueAccuracy: groundingNegatives.length
    ? groundingIssueMatches / groundingNegatives.length
    : null,
};
const groundingRetryCalls = groundingReports.reduce(
  (total, report) => total + (report.operational?.retriesUsed ?? 0),
  0,
);
const groundingProviderCalls = groundingReports.reduce(
  (total, report) => total + (report.operational?.providerCalls ?? 0),
  0,
);
const groundingGate = Boolean(
  groundingCoverageGate &&
    groundingRetryCalls <= contract.grounding.maximumRetryCalls &&
    groundingProviderCalls <=
      contract.grounding.requiredScenarios + contract.grounding.maximumRetryCalls &&
    groundingIds.size === contract.grounding.requiredScenarios &&
    groundingMetrics.falseSupportRate !== null &&
    groundingMetrics.falseSupportRate <= contract.grounding.maximumFalseSupportRate &&
    groundingMetrics.abstentionRate !== null &&
    groundingMetrics.abstentionRate <= contract.grounding.maximumAbstentionRate &&
    groundingMetrics.supportedRecall !== null &&
    groundingMetrics.supportedRecall >= contract.grounding.minimumSupportedRecall &&
    groundingMetrics.decisionAccuracy !== null &&
    groundingMetrics.decisionAccuracy >= contract.grounding.minimumDecisionAccuracy &&
    groundingMetrics.issueAccuracy !== null &&
    groundingMetrics.issueAccuracy >= contract.grounding.minimumIssueAccuracy &&
    groundingDecisionFailures.length === 0,
);

let humanReview = {
  provided: false,
  valid: false,
  approved: false,
  path: humanReviewPath ? resolve(humanReviewPath) : null,
  reason: 'missing',
};

if (humanReviewPath) {
  try {
    const review = await readJson(resolve(humanReviewPath));
    const expectedReviewItems = new Map(
      generationRows.map((row) => {
        const candidate = Array.isArray(row.draft?.sentences)
          ? row.draft.sentences
              .map((sentence) => sentence?.text)
              .filter(Boolean)
              .join(' ')
          : '';
        return [
          row.id,
          {
            candidate,
            candidateSha256: textSha256(candidate),
            expectedLanguage: row.language ?? row.draft?.language ?? null,
            rubric: Array.isArray(row.rubric) ? row.rubric : [],
          },
        ];
      }),
    );
    const expectedIds = new Set(expectedReviewItems.keys());
    const items = Array.isArray(review.items) ? review.items : [];
    const reviewedAt = Date.parse(review.reviewedAt);
    const generationCreatedAt = Date.parse(generation?.createdAt ?? '');
    const validReviewTime =
      Number.isFinite(reviewedAt) &&
      reviewedAt <= Date.now() + 5 * 60_000 &&
      (!Number.isFinite(generationCreatedAt) || reviewedAt >= generationCreatedAt);

    const validItems =
      review.schema === 1 &&
      typeof review.reviewer === 'string' &&
      review.reviewer.trim().length >= 2 &&
      review.reviewer.trim().length <= 160 &&
      typeof review.reviewedAt === 'string' &&
      validReviewTime &&
      review.source?.qualificationId === qualificationId &&
      review.source?.generationSha256 === artifacts?.generationSha256 &&
      review.source?.scenarioCount === expectedIds.size &&
      items.length === expectedIds.size &&
      items.every((item) => {
        const expected = expectedReviewItems.get(item.id);
        return (
          expected &&
          item.approved === true &&
          item.candidate === expected.candidate &&
          item.candidateSha256 === expected.candidateSha256 &&
          item.expectedLanguage === expected.expectedLanguage &&
          JSON.stringify(item.rubric) === JSON.stringify(expected.rubric) &&
          (typeof item.notes === 'string' ? item.notes.length <= 2000 : item.notes === undefined) &&
          contract.generation.humanReviewDimensions.every(
            (dimension) => item[dimension] === 'pass',
          )
        );
      }) &&
      new Set(items.map((item) => item.id)).size === items.length;

    humanReview = {
      provided: true,
      valid: Boolean(validItems),
      approved: Boolean(validItems),
      path: resolve(humanReviewPath),
      reason: validItems ? null : 'invalid_or_incomplete',
      reviewer: typeof review.reviewer === 'string' ? review.reviewer : null,
      reviewedAt: typeof review.reviewedAt === 'string' ? review.reviewedAt : null,
      qualificationId:
        typeof review.source?.qualificationId === 'string'
          ? review.source.qualificationId
          : null,
    };
  } catch (error) {
    humanReview = {
      provided: true,
      valid: false,
      approved: false,
      path: resolve(humanReviewPath),
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

const automatedGates = {
  subprocesses: subprocessFailures.length === 0,
  reportsReadable: readFailures.length === 0,
  qualificationArtifactIntegrity: qualificationAnchor.valid,
  structured: structuredGate,
  retrieval: retrievalGate,
  generation: generationGate,
  grounding: groundingGate,
};
const automatedPassed = Object.values(automatedGates).every(Boolean);
const releaseAllowed =
  automatedPassed &&
  (!contract.generation.requireHumanReview || humanReview.approved === true);

const report = {
  schema: 1,
  kind: 'p1-live-release-qualification',
  runMode: live ? 'live' : 'finalize_existing',
  createdAt: new Date().toISOString(),
  qualificationId,
  parentQualificationId: finalizeExisting
    ? qualificationAnchor.sourceQualificationId
    : null,
  releaseAllowed,
  automatedPassed,
  contract,
  scope: qualificationScope,
  source,
  artifacts,
  qualificationAnchor,
  plannedCalls,
  executions,
  failures: {
    subprocesses: subprocessFailures,
    reportReads: readFailures,
  },
  gates: automatedGates,
  metrics: {
    structured: structured
      ? {
          provider: structured.provider,
          model: structured.model,
          turns: structured.turns,
          scenarios: structuredScenarios,
          languageCoverage: structuredLanguageCoverage,
          requiredFamilies: contract.structured.requiredFamilies,
          metrics: structured.metrics,
          operational: structured.operational,
        }
      : null,
    retrieval: retrieval
      ? {
          queries: retrievalRows.length,
          completed: retrieval.status === 'completed',
        }
      : null,
    generation: generation
      ? {
          scenarios: generationRows.length,
          candidates: generationRows.filter((row) => row.draft).length,
        }
      : null,
    grounding: {
      ...groundingMetrics,
      retryCalls: groundingRetryCalls,
      providerCalls: groundingProviderCalls,
    },
  },
  humanReview,
};

await writeFile(output, JSON.stringify(report, null, 2) + '\n');

console.log(
  JSON.stringify(
    {
      status: releaseAllowed
        ? 'release_qualified'
        : automatedPassed
          ? 'human_review_required'
          : 'qualification_failed',
      releaseAllowed,
      automatedPassed,
      gates: automatedGates,
      grounding: groundingMetrics,
      qualificationId,
      qualificationAnchor,
      humanReview,
      output,
    },
    null,
    2,
  ),
);

if (!releaseAllowed) process.exitCode = 1;
