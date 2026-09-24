#!/usr/bin/env node
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { database } from '../tests/helpers/atlas-fixture.mjs';
import { generationScenarios, generationFixture } from '../evals/generation.mjs';
import {
  liveCompletionPacer,
  liveTransientRetryBackoff,
} from './lib/live-eval-pacing.mjs';
const args = process.argv.slice(2);
const options = {
  live: false,
  maxCases: 5,
  maxGenerationRetries: 0,
  maxValidationRetries: 0,
  output: 'outputs/generation-evaluation.json',
};
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--live') options.live = true;
  else if (args[i] === '--max-cases') options.maxCases = Number(args[++i]);
  else if (args[i] === '--max-generation-retries') options.maxGenerationRetries = Number(args[++i]);
  else if (args[i] === '--max-validation-retries') options.maxValidationRetries = Number(args[++i]);
  else if (args[i] === '--output') options.output = args[++i];
  else throw new Error('Unknown argument');
}
if (
  !Number.isInteger(options.maxCases) ||
  options.maxCases < 1 ||
  options.maxCases > 10 ||
  !Number.isInteger(options.maxGenerationRetries) ||
  options.maxGenerationRetries < 0 ||
  options.maxGenerationRetries > 4 ||
  !Number.isInteger(options.maxValidationRetries) ||
  options.maxValidationRetries < 0 ||
  options.maxValidationRetries > 4 ||
  !options.output
)
  throw new Error('Invalid generation evaluation options');
const selected = generationScenarios.slice(0, options.maxCases);
if (!options.live) {
  console.log(
    JSON.stringify(
      {
        status: 'dry_run',
        scenarios: selected.map((s) => s.id),
        maxGenerationCalls: selected.length + options.maxGenerationRetries,
        maxValidationCalls: selected.length + options.maxValidationRetries,
        maxProviderCalls:
          selected.length * 2 +
          options.maxGenerationRetries +
          options.maxValidationRetries,
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
    pacing = liveCompletionPacer(),
    retryBackoff = liveTransientRetryBackoff();
  const retryableTransportReasons = new Set(['network_or_timeout', 'upstream_unavailable']);
  try {
    const results = [];
    let generationRetriesUsed = 0;
    let validationRetriesUsed = 0;
    for (const scenario of selected) {
      const fixture = generationFixture(scenario);
      let draft = null;
      let diagnostics = null;
      let providerAttempts = [];
      let generationRetries = 0;

      while (true) {
        await pacing.beforeCall();
        const trace = providerTrace();
        const generated = await generateNaturalDraft(
          {
            ...process.env,
            DB,
            SUPABASE_ORGANIZATION_ID: fixture.context.organizationId,
            LLM_GENERATION_MODE: 'shadow',
            LLM_GENERATION_DAILY_LIMIT: String(
              options.maxCases + options.maxGenerationRetries,
            ),
          },
          fixture,
          trace,
        );
        draft = generated.draft;
        diagnostics = generated.diagnostics;
        providerAttempts.push(...trace.attempts);

        if (
          draft ||
          !retryableTransportReasons.has(diagnostics.reason) ||
          generationRetriesUsed >= options.maxGenerationRetries
        )
          break;

        generationRetriesUsed++;
        generationRetries++;
        await retryBackoff.wait();
      }

      let factualValidation = null;
      let validationAttempts = [];
      let validationRetries = 0;
      if (draft) {
        while (true) {
          await pacing.beforeCall();
          const validationTrace = providerTrace();
          factualValidation = await validateNaturalDraft(
            {
              ...process.env,
              DB,
              SUPABASE_ORGANIZATION_ID: fixture.context.organizationId,
              LLM_VALIDATION_MODE: 'shadow',
              LLM_VALIDATION_DAILY_LIMIT: String(
                options.maxCases + options.maxValidationRetries,
              ),
            },
            {
              draft,
              pack: fixture.pack,
              currentPack: structuredClone(fixture.pack),
              context: fixture.context,
            },
            validationTrace,
          );
          validationAttempts.push(...validationTrace.attempts);

          if (
            !retryableTransportReasons.has(factualValidation.reason) ||
            validationRetriesUsed >= options.maxValidationRetries
          )
            break;

          validationRetriesUsed++;
          validationRetries++;
          await retryBackoff.wait();
        }
      }
      results.push({
        id: scenario.id,
        language: scenario.language,
        rubric: scenario.rubric,
        draft,
        diagnostics,
        providerAttempts,
        generationRetries,
        groundedness:
          factualValidation?.outcome === 'supported_candidate' &&
          factualValidation?.reason === null,
        naturalness: null,
        factualValidation,
        factualValidationAttempts: validationAttempts,
        validationRetries,
      });
    }
    const status = results.every(
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
          retryBackoffMs: retryBackoff.intervalMs,
          operational: {
            generationRetriesUsed,
            validationRetriesUsed,
            maximumGenerationRetries: options.maxGenerationRetries,
            maximumValidationRetries: options.maxValidationRetries,
            providerCalls: results.reduce(
              (n, r) =>
                n +
                r.providerAttempts.length +
                r.factualValidationAttempts.length,
              0,
            ),
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
        generationCalls: results.reduce((n, r) => n + r.providerAttempts.length, 0),
        validationCalls: results.reduce(
          (n, r) => n + r.factualValidationAttempts.length,
          0,
        ),
        generationRetriesUsed,
        validationRetriesUsed,
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
