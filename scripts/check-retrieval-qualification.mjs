#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { p1ReleaseQualificationContract as contract } from '../evals/p1-release-contract.mjs';

const path = resolve(process.argv[2] ?? 'outputs/p1-live/retrieval.json');
const report = JSON.parse(await readFile(path, 'utf8'));
const rows = Array.isArray(report.results) ? report.results : [];

const retryableEmbeddingFailures = new Set([
  'network_or_timeout',
  'upstream_rate_limited',
  'upstream_unavailable',
]);

function embeddingAttemptsPass(hybrid) {
  const attempts = Array.isArray(hybrid?.providerAttempts) ? hybrid.providerAttempts : [];
  const retries = hybrid?.embeddingRetries;
  if (
    !Number.isInteger(retries) ||
    retries < 0 ||
    retries > contract.retrieval.maximumEmbeddingRetriesPerSearch ||
    attempts.length !== retries + 1
  )
    return false;
  return attempts.every((attempt, index) => {
    if (attempt?.embeddingCalls !== 1) return false;
    if (index === attempts.length - 1)
      return attempt.embeddingError === null;
    return (
      retryableEmbeddingFailures.has(attempt.embeddingError) &&
      attempt.backendCalls === 0 &&
      attempt.backendRetries === 0 &&
      attempt.backendError === null
    );
  });
}

function backendPasses(turn) {
  const backend = turn?.retrieval?.backend;
  if (
    backend?.timeoutMs !== contract.retrieval.backendTimeoutMs ||
    backend?.retryTimeoutMs !== contract.retrieval.backendRetryTimeoutMs ||
    !Number.isInteger(backend?.calls) ||
    backend.calls < 1 ||
    backend.calls > 1 + contract.retrieval.maximumBackendRetriesPerSearch ||
    !Number.isInteger(backend?.retries) ||
    backend.retries < 0 ||
    backend.retries > contract.retrieval.maximumBackendRetriesPerSearch ||
    backend.calls !== backend.retries + 1 ||
    !Array.isArray(backend?.attemptTimeoutMs) ||
    backend.attemptTimeoutMs.length !== backend.calls ||
    backend.attemptTimeoutMs[0] !== contract.retrieval.backendTimeoutMs ||
    (backend.calls === 2 &&
      backend.attemptTimeoutMs[1] !== contract.retrieval.backendRetryTimeoutMs) ||
    backend.error !== null
  )
    return false;
  return true;
}

function rowPasses(row) {
  const hybrid = row?.hybrid ?? {};
  const lexical = row?.lexical ?? {};
  const embedding = hybrid.retrieval?.embedding;
  return (
    hybrid.scope === 'supabase_published' &&
    lexical.scope === 'supabase_published' &&
    backendPasses(hybrid) &&
    backendPasses(lexical) &&
    embeddingAttemptsPass(hybrid) &&
    hybrid.recallAtK >= contract.retrieval.minimumHybridRecallAtK &&
    hybrid.precisionAtK >= contract.retrieval.minimumHybridPrecisionAtK &&
    (contract.retrieval.allowRecallRegressionVsLexical ||
      hybrid.recallAtK >= lexical.recallAtK) &&
    (!contract.retrieval.requireEmbeddingSuccess ||
      (embedding?.calls === 1 && embedding?.error === null))
  );
}

const lexicalRetryRows = rows.reduce(
  (sum, row) => sum + (row.lexical?.transientRetries ?? 0),
  0,
);
const embeddingRetryRows = rows.reduce(
  (sum, row) => sum + (row.hybrid?.embeddingRetries ?? 0),
  0,
);
const embeddingProviderAttemptCalls = rows.reduce(
  (sum, row) =>
    sum +
    (Array.isArray(row.hybrid?.providerAttempts)
      ? row.hybrid.providerAttempts.reduce(
          (attemptSum, attempt) => attemptSum + (attempt.embeddingCalls ?? 0),
          0,
        )
      : 0),
  0,
);
const backendRetryRows = rows.reduce(
  (sum, row) =>
    sum +
    (Array.isArray(row.lexical?.backendAttempts)
      ? row.lexical.backendAttempts.reduce(
          (attemptSum, attempt) => attemptSum + (attempt.backendRetries ?? 0),
          0,
        )
      : 0) +
    (Array.isArray(row.hybrid?.providerAttempts)
      ? row.hybrid.providerAttempts.reduce(
          (attemptSum, attempt) => attemptSum + (attempt.backendRetries ?? 0),
          0,
        )
      : 0),
  0,
);

const failed = rows
  .filter((row) => !rowPasses(row))
  .map((row) => ({
    id: row.id ?? null,
    language: row.language ?? null,
    recallAtK: row.hybrid?.recallAtK ?? null,
    precisionAtK: row.hybrid?.precisionAtK ?? null,
    outcome: row.hybrid?.retrieval?.outcome ?? null,
    embeddingError: row.hybrid?.retrieval?.embedding?.error ?? null,
    expectedProbeSimilarities: row.hybrid?.expectedProbeSimilarities ?? [],
  }));

const createdAt = Date.parse(report.createdAt ?? '');
const fresh =
  Number.isFinite(createdAt) &&
  createdAt <= Date.now() + 5 * 60_000 &&
  createdAt >= Date.now() - 30 * 60_000;

const configuration = report.configuration ?? {};
const configured =
  configuration.queryContract === contract.retrieval.queryContract &&
  configuration.embeddingProvider === process.env.EMBEDDING_PROVIDER &&
  configuration.embeddingModel === process.env.EMBEDDING_MODEL &&
  configuration.embeddingRevision === (process.env.EMBEDDING_REVISION ?? '1') &&
  configuration.corpusLocale === (process.env.RAG_CORPUS_LOCALE ?? contract.retrieval.corpusLocale) &&
  configuration.market === (process.env.RAG_MARKET ?? 'GLOBAL') &&
  configuration.minSimilarity === Number(process.env.RAG_MIN_SIMILARITY ?? '0.7') &&
  configuration.minLexicalScore === Number(process.env.RAG_MIN_LEXICAL_SCORE ?? '3');

const passed =
  report.status === 'completed' &&
  report.completionCalls === contract.retrieval.completionCalls &&
  report.pacingIntervalMs >= contract.retrieval.minimumEmbeddingPacingIntervalMs &&
  report.operational?.maximumTransientRetries === contract.retrieval.maximumTransientRetries &&
  report.operational?.transientRetriesUsed === lexicalRetryRows &&
  report.operational?.transientRetriesUsed <= contract.retrieval.maximumTransientRetries &&
  report.operational?.maximumEmbeddingRetries === contract.retrieval.maximumEmbeddingRetries &&
  report.operational?.embeddingRetriesUsed === embeddingRetryRows &&
  report.operational?.embeddingRetriesUsed <= contract.retrieval.maximumEmbeddingRetries &&
  report.operational?.embeddingProviderCalls === embeddingProviderAttemptCalls &&
  report.operational?.embeddingProviderCalls ===
    contract.retrieval.requiredQueries + report.operational?.embeddingRetriesUsed &&
  report.operational?.embeddingProviderCalls <= contract.liveBudget.maximumEmbeddingCalls &&
  report.operational?.backendRetriesUsed === backendRetryRows &&
  report.operational?.backendRetriesUsed <= contract.retrieval.maximumBackendRetryCalls &&
  rows.length === contract.retrieval.requiredQueries &&
  failed.length === 0 &&
  fresh &&
  configured;

console.log(
  JSON.stringify(
    {
      status: passed ? 'retrieval_qualified' : 'retrieval_not_qualified',
      queries: rows.length,
      configuration,
      metrics: report.metrics ?? null,
      operational: report.operational ?? null,
      failures: failed,
      reportFresh: fresh,
      configurationMatchesEnvironment: configured,
    },
    null,
    2,
  ),
);

if (!passed) process.exitCode = 1;
