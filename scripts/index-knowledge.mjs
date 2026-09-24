#!/usr/bin/env node
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { liveEmbeddingPacer } from './lib/live-eval-pacing.mjs';
import {
  boundedRetryValue,
  isRecoverableTransport,
  waitForRetry,
} from './lib/live-eval-retry.mjs';
const args = process.argv.slice(2),
  live = args.includes('--live');
const value = (flag, fallback) =>
  args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback;
const maxChunks = Number(value('--max-chunks', '8'));
const maxRetries = Number(value('--max-retries', '0'));
const output = value('--output', null);
const retryBackoffMs = boundedRetryValue(value('--retry-backoff-ms', '0'), 0, {
  name: '--retry-backoff-ms',
  max: 30000,
});
if (!Number.isInteger(maxChunks) || maxChunks < 1 || maxChunks > 32)
  throw new Error('--max-chunks must be between 1 and 32');
if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 1)
  throw new Error('--max-retries must be between 0 and 1');
if (output !== null && (typeof output !== 'string' || !output.trim()))
  throw new Error('--output must be a non-empty path');
for (let i = 0; i < args.length; i++) {
  if (['--max-chunks', '--max-retries', '--retry-backoff-ms', '--output'].includes(args[i])) {
    i++;
    continue;
  }
  if (args[i] !== '--live') throw new Error('Unknown argument');
}
async function emit(report, failed = false) {
  const serialized = JSON.stringify(report, null, 2) + '\n';
  if (output) {
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, serialized);
  }
  (failed ? console.error : console.log)(serialized.trimEnd());
}

if (!live) {
  await emit({
    status: 'dry_run',
    maxChunks,
    maxProviderCalls: 1 + maxRetries,
    maxRetries,
    note: 'No requests sent. Live retries are bounded to transport/rate-limit failures only.',
  });
} else {
  const result = await build({
    entryPoints: ['lib/atlas/knowledge-indexer.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
  });
  const { indexKnowledgeBatch } = await import(
    'data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64')
  );
  const pacing = liveEmbeddingPacer();
  let retries = 0;
  let discardedEmbeddingCalls = 0;
  while (true) {
    try {
      await pacing.beforeCall();
      const indexed = await indexKnowledgeBatch(process.env, maxChunks);
      await emit({
        status: 'indexed',
        ...indexed,
        operational: {
          indexingRetries: retries,
          maximumRetries: maxRetries,
          retryBackoffMs,
          embeddingPacingIntervalMs: pacing.intervalMs,
          discardedEmbeddingCalls,
          embeddingCalls: (indexed.trace?.calls ?? 0) + discardedEmbeddingCalls,
        },
      });
      break;
    } catch (error) {
      const reason =
        typeof error?.reason === 'string' ? error.reason : 'index_batch_failed';
      const retryable =
        isRecoverableTransport(reason) || reason === 'upstream_rate_limited';
      if (retryable && retries < maxRetries) {
        retries++;
        discardedEmbeddingCalls++;
        await waitForRetry(retryBackoffMs);
        continue;
      }
      // Never emit raw upstream messages, documents, credentials or bundled source stacks.
      await emit(
        {
          status: 'failed',
          reason,
          operational: {
            indexingRetries: retries,
            maximumRetries: maxRetries,
            retryBackoffMs,
            embeddingPacingIntervalMs: pacing.intervalMs,
            discardedEmbeddingCalls,
            embeddingCalls: discardedEmbeddingCalls + (retryable ? 1 : 0),
          },
        },
        true,
      );
      process.exitCode = 1;
      break;
    }
  }
}
