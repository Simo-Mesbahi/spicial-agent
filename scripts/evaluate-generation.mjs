#!/usr/bin/env node
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { database } from '../tests/helpers/atlas-fixture.mjs';
import { generationScenarios, generationFixture } from '../evals/generation.mjs';
import { liveCompletionPacer } from './lib/live-eval-pacing.mjs';
import {
  isRecoverableTransport,
  retryPolicy,
  waitForRetry,
} from './lib/live-eval-retry.mjs';
const args = process.argv.slice(2);
const options = { live: false, maxCases: 5, output: 'outputs/generation-evaluation.json' };
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--live') options.live = true;
  else if (args[i] === '--max-cases') options.maxCases = Number(args[++i]);
  else if (args[i] === '--output') options.output = args[++i];
  else throw new Error('Unknown argument');
}
if (
  !Number.isInteger(options.maxCases) ||
  options.maxCases < 1 ||
  options.maxCases > 10 ||
  !options.output
)
  throw new Error('Invalid generation evaluation options');
const selected = generationScenarios.slice(0, options.maxCases);
const generationRetry = retryPolicy(process.env, {
  limitKey: 'P1_GENERATION_MAX_RETRIES',
  backoffKey: 'P1_GENERATION_RETRY_BACKOFF_MS',
  maximumLimit: 3,
  maximumBackoffMs: 30000,
});
const validationRetry = retryPolicy(process.env, {
  limitKey: 'P1_GENERATION_VALIDATION_MAX_RETRIES',
  backoffKey: 'P1_GENERATION_RETRY_BACKOFF_MS',
  maximumLimit: 3,
  maximumBackoffMs: 30000,
});
if (!options.live) {
  console.log(
    JSON.stringify(
      {
        status: 'dry_run',
        scenarios: selected.map((s) => s.id),
        maxGenerationCalls: selected.length + generationRetry.limit,
        maxValidationCalls: selected.length + validationRetry.limit,
        maxProviderCalls:
          selected.length * 2 + generationRetry.limit + validationRetry.limit,
        maxGenerationRetries: generationRetry.limit,
        maxValidationRetries: validationRetry.limit,
        note: 'Synthetic evidence only. No requests sent. Live qualification validates every generated candidate factually before human review.',
      },
      null,
      2,
    ),
  );
} else {
  const built = await build({
    stdin: {
      contents:
        "export {generateNaturalDraft} from './lib/atlas/natural-generation'; export {validateNaturalDraft} from './lib/atlas/factual-validation'; export {providerTrace} from './lib/atlas/provider-runtime';",
      resolveDir: process.cwd(),
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
  });
  const { generateNaturalDraft, validateNaturalDraft, providerTrace } = await import(
    'data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64')
  );
  const DB = database(),
    pacing = liveCompletionPacer();
  try {
    const results = [];
    let generationRetries = 0;
    let validationRetries = 0;
    let discardedGenerationCalls = 0;
    let discardedValidationCalls = 0;
    let systemicTransportFailure = null;

    scenarioLoop: for (const scenario of selected) {
      let fixture = null;
      let draft = null;
      let diagnostics = null;
      let providerAttempts = [];
      const generationRetryAttempts = [];

      while (true) {
        await pacing.beforeCall();
        const trace = providerTrace();
        fixture = generationFixture(scenario);
        const generated = await generateNaturalDraft(
          {
            ...process.env,
            DB,
            SUPABASE_ORGANIZATION_ID: fixture.context.organizationId,
            LLM_GENERATION_MODE: 'shadow',
            LLM_GENERATION_DAILY_LIMIT: String(options.maxCases + generationRetry.limit),
          },
          fixture,
          trace,
        );
        draft = generated.draft;
        diagnostics = generated.diagnostics;
        providerAttempts = trace.attempts;

        if (diagnostics.reason === 'upstream_rate_limited') {
          systemicTransportFailure = 'provider_rate_limited';
          break;
        }
        if (
          isRecoverableTransport(diagnostics.reason) &&
          generationRetries < generationRetry.limit
        ) {
          generationRetries++;
          discardedGenerationCalls += diagnostics.calls;
          generationRetryAttempts.push(...trace.attempts);
          await waitForRetry(generationRetry.backoffMs);
          continue;
        }
        if (
          isRecoverableTransport(diagnostics.reason) &&
          generationRetries >= generationRetry.limit
        )
          systemicTransportFailure = 'generation_retry_budget_exhausted';
        break;
      }

      let factualValidation = null;
      let factualValidationAttempts = [];
      const validationRetryAttempts = [];

      if (draft && !systemicTransportFailure) {
        while (true) {
          await pacing.beforeCall();
          const validationTrace = providerTrace();
          factualValidation = await validateNaturalDraft(
            {
              ...process.env,
              DB,
              SUPABASE_ORGANIZATION_ID: fixture.context.organizationId,
              LLM_VALIDATION_MODE: 'shadow',
              LLM_VALIDATION_DAILY_LIMIT: String(options.maxCases + validationRetry.limit),
            },
            {
              draft,
              pack: fixture.pack,
              currentPack: structuredClone(fixture.pack),
              context: fixture.context,
            },
            validationTrace,
          );
          factualValidationAttempts = validationTrace.attempts;

          if (factualValidation.reason === 'upstream_rate_limited') {
            systemicTransportFailure = 'provider_rate_limited';
            break;
          }
          if (
            isRecoverableTransport(factualValidation.reason) &&
            validationRetries < validationRetry.limit
          ) {
            validationRetries++;
            discardedValidationCalls += factualValidation.calls;
            validationRetryAttempts.push(...validationTrace.attempts);
            await waitForRetry(validationRetry.backoffMs);
            continue;
          }
          if (
            isRecoverableTransport(factualValidation.reason) &&
            validationRetries >= validationRetry.limit
          )
            systemicTransportFailure = 'validation_retry_budget_exhausted';
          break;
        }
      }

      results.push({
        id: scenario.id,
        language: scenario.language,
        rubric: scenario.rubric,
        draft,
        diagnostics,
        providerAttempts,
        generationRetryAttempts,
        groundedness:
          factualValidation?.outcome === 'supported_candidate' &&
          factualValidation?.reason === null,
        naturalness: null,
        factualValidation,
        factualValidationAttempts,
        validationRetryAttempts,
      });

      if (systemicTransportFailure) break scenarioLoop;
    }
    const status =
      results.length === selected.length &&
      !systemicTransportFailure &&
      results.every(
        (r) =>
          r.draft &&
          r.diagnostics.outcome === 'candidate_generated' &&
          r.diagnostics.reason === null &&
          r.factualValidation?.outcome === 'supported_candidate' &&
          r.factualValidation?.reason === null &&
          r.factualValidation?.issues?.length === 0,
      )
        ? 'requires_human_review'
        : 'incomplete';
    await mkdir(dirname(options.output), { recursive: true });
    await writeFile(
      options.output,
      JSON.stringify(
        {
          status,
          data: 'synthetic',
          releaseAllowed: false,
          pacingIntervalMs: pacing.intervalMs,
          operational: {
            generationRetries,
            validationRetries,
            discardedGenerationCalls,
            discardedValidationCalls,
            generationRetryLimit: generationRetry.limit,
            validationRetryLimit: validationRetry.limit,
            retryBackoffMs: generationRetry.backoffMs,
            systemicTransportFailure,
            generationCalls:
              results.reduce((n, r) => n + (r.diagnostics?.calls ?? 0), 0) +
              discardedGenerationCalls,
            validationCalls:
              results.reduce((n, r) => n + (r.factualValidation?.calls ?? 0), 0) +
              discardedValidationCalls,
          },
          results,
        },
        null,
        2,
      ) + '\n',
    );
    console.log(
      JSON.stringify({
        status,
        output: options.output,
        generationCalls:
          results.reduce((n, r) => n + (r.diagnostics?.calls ?? 0), 0) +
          discardedGenerationCalls,
        validationCalls:
          results.reduce((n, r) => n + (r.factualValidation?.calls ?? 0), 0) +
          discardedValidationCalls,
        generationRetries,
        validationRetries,
        systemicTransportFailure,
        failures: results
          .filter(
            (r) =>
              r.diagnostics.reason !== null ||
              !r.factualValidation ||
              r.factualValidation.reason !== null ||
              r.factualValidation.outcome !== 'supported_candidate',
          )
          .map((r) => ({
            id: r.id,
            generationReason: r.diagnostics.reason,
            validationOutcome: r.factualValidation?.outcome ?? null,
            validationReason: r.factualValidation?.reason ?? null,
            validationIssues: r.factualValidation?.issues ?? [],
            providerAttempts: r.providerAttempts,
            factualValidationAttempts: r.factualValidationAttempts,
          })),
      }),
    );
    if (status === 'incomplete') process.exitCode = 1;
  } finally {
    DB.sql.close();
  }
}
