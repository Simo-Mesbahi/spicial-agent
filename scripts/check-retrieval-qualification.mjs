#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { p1ReleaseQualificationContract as contract } from '../evals/p1-release-contract.mjs';

const path = resolve(process.argv[2] ?? 'outputs/p1-live/retrieval.json');
const report = JSON.parse(await readFile(path, 'utf8'));
const rows = Array.isArray(report.results) ? report.results : [];

function rowPasses(row) {
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

const operational = report.operational ?? {};
const retryEmbeddingCalls =
  (operational.retryEmbeddingCalls ?? 0) + (operational.rateLimitRetries ?? 0);
const operationalPassed =
  operational.systemicTransportFailure === null &&
  retryEmbeddingCalls <= contract.retrieval.maximumRetryEmbeddingCalls &&
  operational.maximumRetryEmbeddingCalls ===
    contract.retrieval.maximumRetryEmbeddingCalls &&
  operational.embeddingCalls <= contract.liveBudget.maximumEmbeddingCalls;

const passed =
  report.status === 'completed' &&
  report.completionCalls === contract.retrieval.completionCalls &&
  rows.length === contract.retrieval.requiredQueries &&
  failed.length === 0 &&
  fresh &&
  configured &&
  operationalPassed;

console.log(
  JSON.stringify(
    {
      status: passed ? 'retrieval_qualified' : 'retrieval_not_qualified',
      queries: rows.length,
      configuration,
      metrics: report.metrics ?? null,
      operational,
      retryEmbeddingCalls,
      operationalPassed,
      failures: failed,
      reportFresh: fresh,
      configurationMatchesEnvironment: configured,
    },
    null,
    2,
  ),
);

if (!passed) process.exitCode = 1;
