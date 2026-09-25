// Independent authored targets are read ONLY after each API response, never sent to a model.
// Uses synthetic D1 fixtures, deliberately excluding production Supabase configuration.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { database, client } from '../tests/helpers/atlas-fixture.mjs';
import { preP1Scenarios } from '../evals/pre-p1-conversations.mjs';
import {
  liveCompletionPacer,
  liveTransientRetryBackoff,
  rateLimitSystemicFailure,
} from './lib/live-eval-pacing.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
if (args.includes('--help')) {
  console.log(
    'eval:ai:structured [--live] [--mode structured|legacy] [--max-turns 5..100] [--languages fr,en,de,es,ar] [--families family-id,...] [--output outputs/p1-evaluation.json] [--compare previous.json]',
  );
  console.log(
    'Dry run by default. Default maximum: 10 turns, complete scenarios only. No automatic whole-corpus spending.',
  );
  process.exit(0);
}
const maxTurns = Number(option('--max-turns', '10'));
const mode = option('--mode', 'structured');
if (
  !Number.isInteger(maxTurns) ||
  maxTurns < 5 ||
  maxTurns > 100 ||
  !['structured', 'legacy'].includes(mode)
)
  throw new Error('Invalid mode or max-turns (integer 5..100).');
const languages = option('--languages', 'fr,en,de,es,ar').split(',');
if (languages.some((lang) => !['fr', 'en', 'de', 'es', 'ar'].includes(lang)))
  throw new Error('Invalid language filter');
const families = option('--families', '').split(',').filter(Boolean);
if (families.some((id) => !preP1Scenarios.some((s) => s.matrixFamily === id)))
  throw new Error('Unknown family');
const selected = [];
let turns = 0;
for (const scenario of preP1Scenarios) {
  if (
    !languages.includes(scenario.matrixLanguage) ||
    (families.length && !families.includes(scenario.matrixFamily))
  )
    continue;
  if (turns + scenario.turns.length > maxTurns) break;
  selected.push(scenario);
  turns += scenario.turns.length;
}
if (!selected.length) throw new Error('No complete scenario selected');
const corpusHash = createHash('sha256').update(JSON.stringify(selected)).digest('hex');
const comparisonFile = option('--compare', null);
const previous = comparisonFile ? JSON.parse(await readFile(comparisonFile, 'utf8')) : null;
if (previous && (previous.schema !== 1 || previous.corpusHash !== corpusHash))
  throw new Error('Comparison requires identical scenarios, messages, order and targets');
if (!args.includes('--live')) {
  console.log(
    JSON.stringify(
      {
        status: 'dry_run',
        mode,
        scenarios: selected.map((s) => s.id),
        turns,
        maxProviderCalls: turns * (mode === 'structured' ? 1 : 3),
        corpusHash,
        note: 'No requests sent. Add --live with server-owned provider configuration to evaluate.',
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
const names = [
  'LLM_PROVIDER',
  'LLM_MODEL',
  'LLM_BASE_URL',
  'LLM_API_KEY',
  'LLM_BUDGET_MODE',
  'LLM_DAILY_LIMIT',
  'LLM_STRUCTURED_OUTPUT',
  'LLM_REQUEST_TIMEOUT_MS',
  'OPENAI_MODEL',
  'OPENAI_API_KEY',
  'OPENAI_REASONING_EFFORT',
  'GEMINI_MODEL',
  'GEMINI_API_KEY',
  'OLLAMA_MODEL',
  'OLLAMA_BASE_URL',
  'COMPATIBLE_MODEL',
  'COMPATIBLE_BASE_URL',
  'COMPATIBLE_API_KEY',
];
const config = {
  ...Object.fromEntries(names.filter((k) => process.env[k]).map((k) => [k, process.env[k]])),
  LLM_ORCHESTRATOR: mode,
};
const compiled = await build({
  stdin: {
    contents:
      "export {handleApi} from './lib/atlas/api'; export {publicModelConfig} from './lib/atlas/model-policy';",
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { handleApi, publicModelConfig } = await import(
  'data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64')
);
const ready = publicModelConfig(config);
if (!ready.ready || ready.provider === 'demo') {
  console.error(
    JSON.stringify({ status: 'not_run', reason: 'No configured live provider; no requests sent.' }),
  );
  process.exit(2);
}
const rate = (key) => (process.env[key] === undefined ? null : Number(process.env[key]));
const inputRate = rate('AI_EVAL_INPUT_USD_PER_MILLION'),
  outputRate = rate('AI_EVAL_OUTPUT_USD_PER_MILLION');
if ([inputRate, outputRate].some((n) => n !== null && (!Number.isFinite(n) || n < 0)))
  throw new Error('Invalid operator-supplied token pricing');
const retryLimit = Number(process.env.P1_STRUCTURED_MAX_SCENARIO_RETRIES ?? '0');
if (!Number.isInteger(retryLimit) || retryLimit < 0 || retryLimit > 6)
  throw new Error('Invalid P1 structured retry budget');
const retryBackoffMs = Number(process.env.P1_STRUCTURED_RETRY_BACKOFF_MS ?? '0');
if (!Number.isInteger(retryBackoffMs) || retryBackoffMs < 0 || retryBackoffMs > 30000)
  throw new Error('Invalid P1 structured retry backoff');

const transientFallbackReasons = new Set([
  'network_or_timeout',
  'upstream_unavailable',
  'upstream_rate_limited',
]);

const rows = [],
  pacing = liveCompletionPacer(),
  retryPolicy = liveTransientRetryBackoff({
    ...process.env,
    P1_LIVE_TRANSIENT_RETRY_BACKOFF_MS: String(retryBackoffMs),
  }),
  savedInfo = console.info;
let retriedScenarios = 0,
  discardedProviderCalls = 0,
  discardedInputTokens = 0,
  discardedOutputTokens = 0,
  discardedUsageComplete = true,
  rateLimitRetriesUsed = 0,
  rateLimitWaitMs = 0,
  systemicTransportFailure = null;

async function runScenario(scenario) {
  const attemptRows = [];
  const db = database();
  try {
    const c = await client(db, handleApi);
    Object.assign(c.env, config);
    let activeCaseId = null;
    if (scenario.case) {
      const row =
        c.snapshot.cases.find((r) => /télé|tele|tv/i.test(r.product)) ?? c.snapshot.cases[0];
      if (
        (await c.call('verify', { reference: row.reference, code: row.demoCode })).status !== 200
      )
        throw new Error('Synthetic case authorization failed');
      activeCaseId = row.id;
    }
    for (const [index, turn] of scenario.turns.entries()) {
      await pacing.beforeCall();
      const started = performance.now();
      const response = await c.call('chat', { message: turn.message, caseId: activeCaseId });
      const elapsed = Math.round((performance.now() - started) * 100) / 100;
      const m = response.body.metadata ?? {},
        actual = m.understanding;
      if (m.orchestrator === 'structured') activeCaseId = m.selectedCaseId;
      const checks = Object.fromEntries(
        Object.entries(turn.target).map(([key, expected]) => [
          key,
          actual ? actual[key] === expected : null,
        ]),
      );
      attemptRows.push({
        id: `${scenario.id}/${index + 1}`,
        expected: turn.target,
        actual: actual ?? null,
        checks,
        status: response.status,
        fallback: m.fallback ?? null,
        fallbackReason: m.fallbackReason ?? null,
        plan: m.plan ?? null,
        guardRejected: m.groundingFailure ?? null,
        tools: m.executedTools ?? [],
        providerCalls: m.providerCalls ?? 0,
        inputTokens: m.inputTokens ?? null,
        outputTokens: m.outputTokens ?? null,
        usageComplete: m.usageComplete ?? false,
        latencyMs: elapsed,
        serverResponseReadyMs: m.latencyMs ?? null,
        providerDiagnostic: m.providerTrace?.attempts?.at(-1)?.diagnostic ?? null,
        // Synthetic outputs make human review possible; neither prompts nor credentials are logged.
        response: response.body.content ?? null,
      });

      // A provider fallback OR any non-200 API response makes the remainder
      // of this multi-turn attempt semantically unsafe to score. Stop immediately:
      // a recoverable provider fallback may replay the whole scenario from a fresh DB;
      // opaque API failures remain fail-closed and are never followed by contaminated turns.
      if (response.status !== 200 || m.fallback) break;
    }
    return attemptRows;
  } finally {
    db.sql.close();
  }
}

console.info = () => {};
try {
  scenarioLoop: for (const scenario of selected) {
    let scenarioRows;
    while (true) {
      scenarioRows = await runScenario(scenario);

      const rateLimited = scenarioRows.some(
        (row) => row.fallback && row.fallbackReason === 'upstream_rate_limited',
      );
      const transient = scenarioRows.some(
        (row) => row.fallback && transientFallbackReasons.has(row.fallbackReason),
      );
      if (!transient) break;

      const retryAttempt = retriedScenarios;
      const transientRow = scenarioRows.find(
        (row) => row.fallback && transientFallbackReasons.has(row.fallbackReason),
      );
      const retryReason = rateLimited
        ? 'upstream_rate_limited'
        : transientRow?.fallbackReason ?? 'upstream_unavailable';
      const retryPlan = retryPolicy.plan(
        retryReason,
        retryAttempt,
        transientRow?.providerDiagnostic ?? null,
      );
      if (!retryPlan.retryable) {
        systemicTransportFailure = rateLimitSystemicFailure(retryPlan.source);
        break;
      }
      if (retriedScenarios >= retryLimit) {
        if (rateLimited) systemicTransportFailure = 'provider_rate_limited';
        break;
      }

      retriedScenarios++;
      if (rateLimited) rateLimitRetriesUsed++;
      discardedProviderCalls += scenarioRows.reduce((n, row) => n + (row.providerCalls ?? 0), 0);
      discardedInputTokens += scenarioRows.reduce((n, row) => n + (row.inputTokens ?? 0), 0);
      discardedOutputTokens += scenarioRows.reduce((n, row) => n + (row.outputTokens ?? 0), 0);
      discardedUsageComplete &&= scenarioRows.every((row) => row.usageComplete);

      const waited = await retryPolicy.wait(
        retryAttempt,
        retryReason,
        transientRow?.providerDiagnostic ?? null,
      );
      if (rateLimited) rateLimitWaitMs += waited.delayMs;
    }
    rows.push(...scenarioRows);
    if (systemicTransportFailure) break scenarioLoop;
  }
} finally {
  console.info = savedInfo;
}
const keys = ['intent', 'guidance', 'requiresCase', 'conversationRepair', 'responseLanguage'];
const metrics = Object.fromEntries(
  keys.map((key) => {
    const observed = rows.filter((r) => typeof r.checks[key] === 'boolean');
    const passed = observed.filter((r) => r.checks[key]).length;
    return [
      key,
      {
        passed,
        observed: observed.length,
        missing: rows.length - observed.length,
        accuracy: observed.length ? passed / observed.length : null,
      },
    ];
  }),
);
const semanticFailures = rows
  .map((row) => {
    const failedChecks = Object.entries(row.checks ?? {})
      .filter(([, passed]) => passed === false)
      .map(([key]) => key);
    return failedChecks.length
      ? {
          id: row.id,
          failedChecks,
          expected: row.expected,
          actual: row.actual,
        }
      : null;
  })
  .filter(Boolean);

const latencies = rows
  .flatMap((r) => (r.latencyMs === null ? [] : [r.latencyMs]))
  .sort((a, b) => a - b);
const percentile = (q) =>
  latencies.length
    ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * q))]
    : null;
const sum = (key) => rows.reduce((total, r) => total + (r[key] ?? 0), 0);
const usageComplete = rows.every((r) => r.usageComplete);
const report = {
  schema: 1,
  kind: 'live-provider-synthetic-data',
  mode,
  provider: ready.provider,
  model: ready.model,
  createdAt: new Date().toISOString(),
  corpusHash,
  scenarios: selected.map((s) => s.id),
  turns: rows.length,
  limits: { maxTurns, maxProviderCalls: turns * (mode === 'structured' ? 1 : 3) },
  metrics,
  operational: {
    providerCalls: sum('providerCalls') + discardedProviderCalls,
    finalProviderCalls: sum('providerCalls'),
    discardedProviderCalls,
    retriedScenarios,
    maximumScenarioRetries: retryLimit,
    retryBackoffMs,
    rateLimitRetryMinMs: retryPolicy.rateLimitMinMs,
    rateLimitRetryMaxMs: retryPolicy.rateLimitMaxMs,
    rateLimitRetriesUsed,
    rateLimitWaitMs,
    retryUsageComplete: discardedUsageComplete,
    systemicTransportFailure,
    fallbackCount: rows.filter((r) => r.fallback).length,
    apiFailures: rows.filter((r) => r.status !== 200).length,
    groundingRejections: rows.filter((r) => r.guardRejected).length,
    usageComplete,
    inputTokens: sum('inputTokens') + discardedInputTokens,
    outputTokens: sum('outputTokens') + discardedOutputTokens,
    latencyMs: { p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99) },
    pacingIntervalMs: pacing.intervalMs,
    estimatedCostUsd:
      usageComplete && discardedUsageComplete && inputRate !== null && outputRate !== null
        ? (sum('inputTokens') * inputRate + sum('outputTokens') * outputRate) / 1e6
        : null,
  },
  // Classification/declared-language metrics do not prove factual grounding or response quality.
  humanReviewRequired: [
    'response_language',
    'naturalness',
    'groundedness',
    'case_selection',
    'retrieval_relevance',
  ],
  semanticFailures,
  comparison: previous
    ? {
        provider: previous.provider,
        model: previous.model,
        mode: previous.mode,
        deltas: Object.fromEntries(
          keys.map((key) => [
            key,
            metrics[key].accuracy === null || previous.metrics?.[key]?.accuracy == null
              ? null
              : metrics[key].accuracy - previous.metrics[key].accuracy,
          ]),
        ),
      }
    : null,
  rows,
};
const path = option('--output', 'outputs/p1-evaluation.json');
await mkdir(dirname(path), { recursive: true });
await writeFile(path, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, rows: undefined, output: path }, null, 2));
if (
  report.operational.apiFailures ||
  report.operational.fallbackCount ||
  report.operational.groundingRejections ||
  (mode === 'structured' &&
    Object.values(metrics).some((m) => m.missing || m.passed !== m.observed))
)
  process.exitCode = 1;
