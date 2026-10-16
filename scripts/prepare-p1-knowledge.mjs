#!/usr/bin/env node
import { build } from 'esbuild';
import { setTimeout as wait } from 'node:timers/promises';
import { liveEmbeddingPacer } from './lib/live-eval-pacing.mjs';
import {
  p1KnowledgePreparationLimits as limits,
  prepareP1Knowledge,
} from './lib/p1-knowledge-preparation.mjs';

const args = process.argv.slice(2);
if (args.length > 1 || args.some((arg) => arg !== '--live')) {
  console.error(JSON.stringify({ status: 'failed', reason: 'invalid_arguments' }));
  process.exit(2);
}
if (!args.includes('--live')) {
  console.log(JSON.stringify({
    status: 'dry_run', ...limits,
    maximumChunks: limits.maximumBatches * limits.maximumChunksPerBatch,
    completionCalls: 0,
    note: 'No provider or Supabase requests sent. Readiness still requires a live run.',
  }, null, 2));
} else {
  try {
    const built = await build({
      entryPoints: ['lib/atlas/knowledge-indexer.ts'],
      bundle: true, platform: 'node', format: 'esm', write: false,
    });
    const { indexKnowledgeBatch } = await import(
      'data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64')
    );
    // A caller may slow preparation down, but cannot remove its minimum pacing.
    const intervalMs = Math.max(limits.minimumIntervalMs, liveEmbeddingPacer().intervalMs);
    const result = await prepareP1Knowledge({
      indexBatch: (maxChunks) => indexKnowledgeBatch(process.env, maxChunks),
      // Wait after the previous batch has fully completed. RPC latency therefore
      // cannot compress the interval between actual provider requests.
      beforeBatch: () => wait(intervalMs),
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ready) process.exitCode = 1;
  } catch (error) {
    // Never print upstream messages, credentials, source stacks or document text.
    const safeReasons = new Set([
      'network_or_timeout', 'upstream_auth', 'upstream_rate_limited',
      'upstream_request_rejected', 'upstream_unavailable', 'upstream_rejected',
      'invalid_upstream_response', 'invalid_tool_arguments', 'configuration',
      'invalid_preparation_result', 'embedding_space_changed',
    ]);
    const reason = safeReasons.has(error?.reason) ? error.reason
      : safeReasons.has(error?.message) ? error.message : 'preparation_failed';
    console.error(JSON.stringify({ status: 'failed', ready: false, reason }));
    process.exitCode = 1;
  }
}
