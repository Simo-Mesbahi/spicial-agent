#!/usr/bin/env node
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { performance } from 'node:perf_hooks';
import { database } from '../tests/helpers/atlas-fixture.mjs';
import { retrievalScenarios } from '../evals/retrieval.mjs';
import { liveEmbeddingPacer, liveTransientRetryBackoff } from './lib/live-eval-pacing.mjs';
import {
  searchHybridWithEmbeddingRetries,
  searchLexicalWithTransientRetries,
} from './lib/live-retrieval-resilience.mjs';
const args = process.argv.slice(2);
const options = {
  live: false,
  maxQueries: 5,
  maxTransientRetries: 0,
  maxEmbeddingRetries: 0,
  output: 'outputs/retrieval-evaluation.json',
};
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--live') options.live = true;
  else if (args[i] === '--max-queries') options.maxQueries = Number(args[++i]);
  else if (args[i] === '--max-transient-retries') options.maxTransientRetries = Number(args[++i]);
  else if (args[i] === '--max-embedding-retries') options.maxEmbeddingRetries = Number(args[++i]);
  else if (args[i] === '--output') options.output = args[++i];
  else throw new Error('Unknown argument');
}
if (
  !Number.isInteger(options.maxQueries) ||
  options.maxQueries < 1 ||
  options.maxQueries > 20 ||
  !Number.isInteger(options.maxTransientRetries) ||
  options.maxTransientRetries < 0 ||
  options.maxTransientRetries > 4 ||
  !Number.isInteger(options.maxEmbeddingRetries) ||
  options.maxEmbeddingRetries < 0 ||
  options.maxEmbeddingRetries > 4 ||
  !options.output
)
  throw new Error('Invalid evaluation options');
const scenarios = retrievalScenarios.slice(0, options.maxQueries);
if (!options.live) {
  console.log(
    JSON.stringify(
      {
        status: 'dry_run',
        scenarios: scenarios.map((s) => s.id),
        maxEmbeddingCalls: scenarios.length + options.maxEmbeddingRetries,
        maxTransientRetries: options.maxTransientRetries,
        maxEmbeddingRetries: options.maxEmbeddingRetries,
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
    embeddingPacing = liveEmbeddingPacer(),
    retryBackoff = liveTransientRetryBackoff();
  let transientRetriesUsed = 0;
  let embeddingRetriesUsed = 0;
  try {
    const cfg = {
      ...process.env,
      DB,
      RAG_MODE: 'hybrid',
      RAG_RESULTS: 3,
      EMBEDDING_DAILY_LIMIT: String(scenarios.length + options.maxEmbeddingRetries),
      RAG_EVAL_VECTOR_PROBE: 'true',
      RAG_EVAL_VECTOR_CANDIDATE_FLOOR: '0.3',
    };
    for (const scenario of scenarios) {
      const turns = {};
      for (const [mode, limit] of [
        ['lexical', '0'],
        ['hybrid', String(scenarios.length + options.maxEmbeddingRetries)],
      ]) {
        const start = performance.now();
        let result;
        let modeRetries = 0;
        let providerAttempts = [];
        const search = () =>
          searchKnowledge(
            {
              ...cfg,
              EMBEDDING_DAILY_LIMIT: limit,
              ...(mode === 'hybrid' ? { RAG_EVAL_REQUIRE_EMBEDDING: 'true' } : {}),
            },
            scenario.retrievalQuery,
          );
        if (mode === 'lexical') {
          const retried = await searchLexicalWithTransientRetries(
            search,
            options.maxTransientRetries - transientRetriesUsed,
            retryBackoff,
          );
          result = retried.result;
          modeRetries = retried.retries;
          transientRetriesUsed += retried.retries;
        } else {
          const retried = await searchHybridWithEmbeddingRetries(
            search,
            Math.min(1, options.maxEmbeddingRetries - embeddingRetriesUsed),
            retryBackoff,
            embeddingPacing,
          );
          result = retried.result;
          modeRetries = retried.retries;
          providerAttempts = retried.attempts;
          embeddingRetriesUsed += retried.retries;
        }
        const hits = result.articles.filter((a) =>
          scenario.expectedTitles.includes(a.title),
        ).length;
        const expectedProbeSimilarities = (result.retrieval?.evaluationProbe?.vectorCandidates ?? [])
          .filter((candidate) => scenario.expectedTitles.includes(candidate.title))
          .map((candidate) => candidate.similarity)
          .sort((a, b) => b - a);
        turns[mode] = {
          scope: result.scope,
          precisionAtK: result.articles.length ? hits / result.articles.length : 0,
          recallAtK: hits ? 1 : 0,
          latencyMs: Math.round(performance.now() - start),
          retrieval: result.retrieval,
          evidence: result.evidence,
          expectedProbeSimilarities,
          vectorProbe: result.retrieval?.evaluationProbe ?? null,
          returnedTitles: result.articles.map((a) => a.title),
          transientRetries: mode === 'lexical' ? modeRetries : 0,
          embeddingRetries: mode === 'hybrid' ? modeRetries : 0,
          providerAttempts: mode === 'hybrid' ? providerAttempts : [],
        };
      }
      results.push({
        id: scenario.id,
        language: scenario.language,
        queryContract: 'canonical_fr_from_multilingual_source',
        ...turns,
      });
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
    const backendRetriesUsed = results.reduce(
      (sum, row) =>
        sum +
        (row.lexical.retrieval?.backend?.retries ?? 0) +
        row.hybrid.providerAttempts.reduce(
          (attemptSum, attempt) => attemptSum + attempt.backendRetries,
          0,
        ),
      0,
    );
    const embeddingProviderCalls = results.reduce(
      (sum, row) =>
        sum +
        row.hybrid.providerAttempts.reduce(
          (attemptSum, attempt) => attemptSum + attempt.embeddingCalls,
          0,
        ),
      0,
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
      pacingIntervalMs: embeddingPacing.intervalMs,
      retryBackoffMs: retryBackoff.intervalMs,
      operational: {
        transientRetriesUsed,
        maximumTransientRetries: options.maxTransientRetries,
        embeddingRetriesUsed,
        maximumEmbeddingRetries: options.maxEmbeddingRetries,
        embeddingProviderCalls,
        backendRetriesUsed,
      },
      status: results.every(
        (r) =>
          r.lexical.scope === 'supabase_published' &&
          r.hybrid.scope === 'supabase_published' &&
          r.hybrid.retrieval?.embedding.calls === 1 &&
          r.hybrid.retrieval.embedding.error === null &&
          r.hybrid.embeddingRetries <= 1,
      )
        ? 'completed'
        : 'incomplete',
      completionCalls: 0,
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
        embeddingPacingIntervalMs: embeddingPacing.intervalMs,
        transientRetriesUsed,
        embeddingRetriesUsed,
        embeddingProviderCalls,
        backendRetriesUsed,
        output: options.output,
      }),
    );
    if (report.status !== 'completed') process.exitCode = 1;
  } finally {
    DB.sql.close();
  }
}
