#!/usr/bin/env node
import { build } from 'esbuild';
const args = process.argv.slice(2),
  live = args.includes('--live');
const at = args.indexOf('--max-chunks'),
  maxChunks = at >= 0 ? Number(args[at + 1]) : 8;
if (!Number.isInteger(maxChunks) || maxChunks < 1 || maxChunks > 32)
  throw new Error('--max-chunks must be between 1 and 32');
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--max-chunks') {
    i++;
    continue;
  }
  if (args[i] !== '--live') throw new Error('Unknown argument');
}
if (!live) {
  console.log(
    JSON.stringify(
      {
        status: 'dry_run',
        maxChunks,
        maxProviderCalls: 1,
        note: 'No requests sent. Use --live with server credentials in .dev.vars for one bounded batch.',
      },
      null,
      2,
    ),
  );
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
  try {
    console.log(
      JSON.stringify(
        { status: 'indexed', ...(await indexKnowledgeBatch(process.env, maxChunks)) },
        null,
        2,
      ),
    );
  } catch (error) {
    // Never emit raw upstream messages, documents, credentials or bundled source stacks.
    console.error(
      JSON.stringify({
        status: 'failed',
        reason: typeof error.reason === 'string' ? error.reason : 'index_batch_failed',
      }),
    );
    process.exitCode = 1;
  }
}
