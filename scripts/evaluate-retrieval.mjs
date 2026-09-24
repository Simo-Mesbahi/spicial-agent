#!/usr/bin/env node
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { performance } from 'node:perf_hooks';
import { database } from '../tests/helpers/atlas-fixture.mjs';
import { retrievalScenarios } from '../evals/retrieval.mjs';
import { liveEmbeddingPacer } from './lib/live-eval-pacing.mjs';
import {
  boundedRetryValue,
  isRecoverableTransport,
  retryPolicy,
  waitForRetry,
} from './lib/live-eval-retry.mjs';
const args = process.argv.slice(2);
const options = { live: false, maxQueries: 5, output: 'outputs/retrieval-evaluation.json' };
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--live') options.live = true;
  else if (args[i] === '--max-queries') options.maxQueries = Number(args[++i]);
  else if (args[i] === '--output') options.output = args[++i];
  else throw new Error('Unknown argument');
}
if (
  !Number.isInteger(options.maxQueries) ||
  options.maxQueries < 1 ||
  options.maxQueries > 20 ||
  !options.output
)
  throw new Error('Invalid evaluation options');
const scenarios = retrievalScenarios.slice(0, options.maxQueries);
const retry = retryPolicy(process.env, {
  limitKey: 'P1_RETRIEVAL_MAX_RETRIES',
  backoffKey: 'P1_RETRIEVAL_RETRY_BACKOFF_MS',
  maximumLimit: 4,
  maximumBackoffMs: 30000,
});
const maximumRateLimitRetries = boundedRetryValue(
  process.env.P1_RETRIEVAL_MAX_RATE_LIMIT_RETRIES,
  0,
  { name: 'P1_RETRIEVAL_MAX_RATE_LIMIT_RETRIES', max: 1 },
);
if (!options.live) {
  console.log(
    JSON.stringify(
      {
        status: 'dry_run',
        scenarios: scenarios.map((s) => s.id),
        maxEmbeddingCalls:
          scenarios.length + retry.limit + maximumRateLimitRetries,
        maxRetryEmbeddingCalls: retry.limit + maximumRateLimitRetries,
        maxCompletionCalls: 0,
        note: 'No requests sent. Labels refer to the published repository seed corpus.',
      },
      null,
      2,
    ),
  );
} else {
  const built = await build({
    entryPoints: ['lib/atlas/knowledge-runtime.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
  });
  const { searchKnowledge } = await import(
    'data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64')
  );
  const DB = database(),
    results = [],
    embeddingPacing = liveEmbeddingPacer();
  try {
    const maximumRetryEmbeddingCalls = retry.limit + maximumRateLimitRetries;
    const maximumEmbeddingCalls = scenarios.length + maximumRetryEmbeddingCalls;
    const cfg = {
      ...process.env,
      DB,
      RAG_MODE: 'hybrid',
      RAG_RESULTS: 3,
      EMBEDDING_DAILY_LIMIT: String(maximumEmbeddingCalls),
      RAG_EVAL_VECTOR_PROBE: 'true',
      RAG_EVAL_VECTOR_CANDIDATE_FLOOR: '0.3',
    };
    let retryEmbeddingCalls = 0;
    let rateLimitRetries = 0;
    let discardedEmbeddingCalls = 0;
    let systemicTransportFailure = null;

    const turn = (result, start) => {
      const hits = result.articles.filter((a) =>
        currentScenario.expectedTitles.includes(a.title),
      ).length;
      const expectedProbeSimilarities = (result.retrieval?.evaluationProbe?.vectorCandidates ?? [])
        .filter((candidate) => currentScenario.expectedTitles.includes(candidate.title))
        .map((candidate) => candidate.similarity)
        .sort((a, b) => b - a);
      return {
        scope: result.scope,
        precisionAtK: result.articles.length ? hits / result.articles.length : 0,
        recallAtK: hits ? 1 : 0,
        latencyMs: Math.round(performance.now() - start),
        retrieval: result.retrieval,
        evidence: result.evidence,
        expectedProbeSimilarities,
        vectorProbe: result.retrieval?.evaluationProbe ?? null,
        returnedTitles: result.articles.map((a) => a.title),
      };
    };

    let currentScenario = null;
    scenarioLoop: for (const scenario of scenarios) {
      currentScenario = scenario;
      const turns = {};
      const lexicalStart = performance.now();
      const lexical = await searchKnowledge(
        { ...cfg, EMBEDDING_DAILY_LIMIT: '0' },
        scenario.retrievalQuery,
      );
      turns.lexical = turn(lexical, lexicalStart);

      while (true) {
        await embeddingPacing.beforeCall();
        const hybridStart = performance.now();
        const hybrid = await searchKnowledge(cfg, scenario.retrievalQuery);
        const hybridTurn = turn(hybrid, hybridStart);
        const reason = hybrid.retrieval?.embedding?.error ?? null;

        if (
          isRecoverableTransport(reason) &&
          retryEmbeddingCalls < retry.limit
        ) {
          retryEmbeddingCalls++;
          discardedEmbeddingCalls += hybrid.retrieval?.embedding?.calls ?? 0;
          await waitForRetry(retry.backoffMs);
          continue;
        }

        if (reason === 'upstream_rate_limited') {
          if (rateLimitRetries < maximumRateLimitRetries) {
            rateLimitRetries++;
            discardedEmbeddingCalls += hybrid.retrieval?.embedding?.calls ?? 0;
            await waitForRetry(retry.backoffMs);
            continue;
          }
          systemicTransportFailure = 'provider_rate_limited';
          turns.hybrid = hybridTurn;
          results.push({
            id: scenario.id,
            language: scenario.language,
            queryContract: 'canonical_fr_from_multilingual_source',
            ...turns,
          });
          break scenarioLoop;
        }

        if (isRecoverableTransport(reason) && retryEmbeddingCalls >= retry.limit)
          systemicTransportFailure = 'transient_retry_budget_exhausted';

        turns.hybrid = hybridTurn;
        results.push({
          id: scenario.id,
          language: scenario.language,
          queryContract: 'canonical_fr_from_multilingual_source',
          ...turns,
        });
        if (systemicTransportFailure) break scenarioLoop;
        break;
      }
    }
    const perLanguage = Object.fromEntries(
      ['fr', 'en', 'de', 'es', 'ar'].map((language) => {
        const rows = results.filter((row) => row.language === language);
        return [
          language,
          {
            queries: rows.length,
            hybridRecallAtK:
              rows.length ? rows.reduce((sum, row) => sum + row.hybrid.recallAtK, 0) / rows.length : null,
            hybridPrecisionAtK:
              rows.length
                ? rows.reduce((sum, row) => sum + row.hybrid.precisionAtK, 0) / rows.length
                : null,
          },
        ];
      }),
    );
    const report = {
      createdAt: new Date().toISOString(),
      configuration: {
        queryContract: 'canonical_fr_from_multilingual_source',
        corpusLocale: cfg.RAG_CORPUS_LOCALE ?? 'fr-FR',
        market: cfg.RAG_MARKET ?? 'GLOBAL',
        minSimilarity: Number(cfg.RAG_MIN_SIMILARITY ?? '0.7'),
        evaluationCandidateFloor: 0.3,
        minLexicalScore: Number(cfg.RAG_MIN_LEXICAL_SCORE ?? '3'),
        embeddingProvider: cfg.EMBEDDING_PROVIDER ?? null,
        embeddingModel: cfg.EMBEDDING_MODEL ?? null,
        embeddingRevision: cfg.EMBEDDING_REVISION ?? '1',
      },
      status:
        results.length === scenarios.length &&
        !systemicTransportFailure &&
        results.every(
          (r) =>
            r.lexical.scope === 'supabase_published' &&
            r.hybrid.scope === 'supabase_published' &&
            r.hybrid.retrieval?.embedding.calls === 1 &&
            r.hybrid.retrieval.embedding.error === null,
        )
          ? 'completed'
          : 'incomplete',
      completionCalls: 0,
      operational: {
        embeddingCalls:
          results.reduce(
            (n, r) => n + (r.hybrid?.retrieval?.embedding?.calls ?? 0),
            0,
          ) + discardedEmbeddingCalls,
        retryEmbeddingCalls,
        rateLimitRetries,
        discardedEmbeddingCalls,
        maximumRetryEmbeddingCalls,
        maximumEmbeddingCalls,
        retryBackoffMs: retry.backoffMs,
        embeddingPacingIntervalMs: embeddingPacing.intervalMs,
        systemicTransportFailure,
      },
      metrics: {
        hybridRecallAtK:
          results.length
            ? results.reduce((sum, row) => sum + row.hybrid.recallAtK, 0) / results.length
            : null,
        hybridPrecisionAtK:
          results.length
            ? results.reduce((sum, row) => sum + row.hybrid.precisionAtK, 0) / results.length
            : null,
        perLanguage,
      },
      results,
      note: 'Production-aligned retrieval qualification: multilingual customer utterances are evaluated through independently authored French retrieval queries, matching the structured orchestrator contract. Raw cross-lingual embedding robustness is diagnostic, not the release retrieval boundary.',
    };
    await mkdir(dirname(options.output), { recursive: true });
    await writeFile(options.output, JSON.stringify(report, null, 2) + '\n');
    console.log(
      JSON.stringify({
        status: report.status,
        queries: results.length,
        output: options.output,
        operational: report.operational,
      }),
    );
    if (report.status !== 'completed') process.exitCode = 1;
  } finally {
    DB.sql.close();
  }
}
