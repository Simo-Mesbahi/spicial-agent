#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';

import { p1ReleaseQualificationContract as contract } from '../evals/p1-release-contract.mjs';

const args = process.argv.slice(2);
const value = (flag, fallback = null) =>
  args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback;

const live = args.includes('--live');
const finalizeExisting = args.includes('--finalize-existing');
if (live && finalizeExisting)
  throw new Error('Choose either --live or --finalize-existing, never both.');

const structuredTurns = Number(value('--structured-turns', String(contract.structured.minimumTurns)));
const output = resolve(value('--output', 'outputs/p1-live/release-qualification.json'));
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

const paths = {
  structured: resolve('outputs/p1-live/structured.json'),
  retrieval: resolve('outputs/p1-live/retrieval.json'),
  generation: resolve('outputs/p1-live/generation.json'),
  grounding: [0, 20, 40, 60].map((offset) =>
    resolve(`outputs/p1-live/grounding-${String(offset).padStart(2, '0')}.json`),
  ),
};

const plannedCalls = {
  structuredCompletionCalls: structuredTurns,
  generationCalls: contract.generation.requiredScenarios,
  groundingCalls: contract.grounding.requiredScenarios,
  embeddingCalls: contract.retrieval.requiredQueries,
  completionCalls:
    structuredTurns +
    contract.generation.requiredScenarios +
    contract.grounding.requiredScenarios,
};

if (
  plannedCalls.structuredCompletionCalls > contract.liveBudget.maximumStructuredCompletionCalls ||
  plannedCalls.generationCalls > contract.liveBudget.maximumGenerationCalls ||
  plannedCalls.groundingCalls > contract.liveBudget.maximumGroundingCalls ||
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

if (finalizeExisting && !humanReviewPath)
  throw new Error(
    '--finalize-existing requires --human-review and reuses existing qualification reports without provider calls.',
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

const executions = [];

if (live) {
  executions.push(
    runNode('scripts/evaluate-structured-ai.mjs', [
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
    ]),
  );

  executions.push(
    runNode('scripts/evaluate-retrieval.mjs', [
      '--live',
      '--max-queries',
      String(contract.retrieval.requiredQueries),
      '--output',
      paths.retrieval,
    ]),
  );

  executions.push(
    runNode('scripts/evaluate-generation.mjs', [
      '--live',
      '--max-cases',
      String(contract.generation.requiredScenarios),
      '--output',
      paths.generation,
    ]),
  );

  for (const [index, offset] of [0, 20, 40, 60].entries()) {
    const remaining = contract.grounding.requiredScenarios - offset;
    const maxCases = Math.min(20, remaining);
    if (maxCases <= 0) continue;
    executions.push(
      runNode('scripts/evaluate-grounding.mjs', [
        '--live',
        '--offset',
        String(offset),
        '--max-cases',
        String(maxCases),
        '--output',
        paths.grounding[index],
      ]),
    );
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
    structured.operational?.groundingRejections === contract.structured.groundingRejections &&
    (!contract.structured.requireCompleteUsage || structured.operational?.usageComplete === true) &&
    Object.values(structuredMetrics).every(
      (metric) =>
        metric &&
        metric.observed > 0 &&
        metric.missing === 0 &&
        metric.accuracy === contract.structured.requiredMetricAccuracy,
    ),
);

const retrievalRows = retrieval?.results ?? [];
const retrievalGate = Boolean(
  retrieval &&
    retrieval.status === 'completed' &&
    retrieval.completionCalls === contract.retrieval.completionCalls &&
    retrievalRows.length === contract.retrieval.requiredQueries &&
    retrievalRows.every((row) => {
      const hybrid = row.hybrid ?? {};
      const lexical = row.lexical ?? {};
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
    }),
);

const generationRows = generation?.results ?? [];
const generationGate = Boolean(
  generation &&
    generationRows.length === contract.generation.requiredScenarios &&
    generationRows.every(
      (row) =>
        row.draft &&
        row.diagnostics?.outcome === 'candidate_generated' &&
        row.diagnostics?.reason === null &&
        row.diagnostics?.calls === 1,
    ),
);

const groundingRows = groundingReports.flatMap((report) => report.results ?? []);
const groundingIds = new Set(groundingRows.map((row) => row.id));
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
const groundingMetrics = {
  measuredScenarios: groundingRows.length,
  uniqueScenarios: groundingIds.size,
  falseSupportRate: groundingNegatives.length
    ? falseSupports / groundingNegatives.length
    : null,
  abstentionRate: groundingRows.length ? abstentions / groundingRows.length : null,
  supportedRecall: groundingPositives.length ? supported / groundingPositives.length : null,
};
const groundingGate = Boolean(
  groundingRows.length === contract.grounding.requiredScenarios &&
    groundingIds.size === contract.grounding.requiredScenarios &&
    groundingMetrics.falseSupportRate !== null &&
    groundingMetrics.falseSupportRate <= contract.grounding.maximumFalseSupportRate &&
    groundingMetrics.abstentionRate !== null &&
    groundingMetrics.abstentionRate <= contract.grounding.maximumAbstentionRate &&
    groundingMetrics.supportedRecall !== null &&
    groundingMetrics.supportedRecall >= contract.grounding.minimumSupportedRecall,
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
    const expectedIds = new Set(generationRows.map((row) => row.id));
    const items = Array.isArray(review.items) ? review.items : [];
    const validItems =
      review.schema === 1 &&
      typeof review.reviewer === 'string' &&
      review.reviewer.trim().length >= 2 &&
      typeof review.reviewedAt === 'string' &&
      !Number.isNaN(Date.parse(review.reviewedAt)) &&
      review.source?.generationSha256 === (await fileSha256(paths.generation)) &&
      items.length === expectedIds.size &&
      items.every(
        (item) =>
          expectedIds.has(item.id) &&
          item.approved === true &&
          contract.generation.humanReviewDimensions.every(
            (dimension) => item[dimension] === 'pass',
          ),
      ) &&
      new Set(items.map((item) => item.id)).size === items.length;

    humanReview = {
      provided: true,
      valid: validItems,
      approved: validItems,
      path: resolve(humanReviewPath),
      reason: validItems ? null : 'invalid_or_incomplete',
      reviewer: typeof review.reviewer === 'string' ? review.reviewer : null,
      reviewedAt: typeof review.reviewedAt === 'string' ? review.reviewedAt : null,
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
  releaseAllowed,
  automatedPassed,
  contract,
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
    grounding: groundingMetrics,
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
      humanReview,
      output,
    },
    null,
    2,
  ),
);

if (!releaseAllowed) process.exitCode = 1;
