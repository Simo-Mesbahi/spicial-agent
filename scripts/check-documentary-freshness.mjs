#!/usr/bin/env node
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const args = process.argv.slice(2);
const value = (flag, fallback) =>
  args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback;
const live = args.includes('--live');
const retrievalPath = resolve(
  value('--retrieval', 'outputs/p1-live/retrieval.json'),
);
const outputPath = resolve(
  value('--output', 'outputs/p1-live/freshness-smoke.json'),
);
const maxAgeMs = Number(value('--max-age-ms', String(30 * 60_000)));

for (let i = 0; i < args.length; i++) {
  if (['--retrieval', '--output', '--max-age-ms'].includes(args[i])) {
    i++;
    continue;
  }
  if (args[i] !== '--live') throw new Error('Unknown argument: ' + args[i]);
}
if (!Number.isInteger(maxAgeMs) || maxAgeMs < 60_000 || maxAgeMs > 60 * 60_000) {
  throw new Error('--max-age-ms must be between 60000 and 3600000.');
}

if (!live) {
  console.log(
    JSON.stringify(
      {
        status: 'dry_run',
        providerCalls: 0,
        embeddingCalls: 0,
        maximumDatabaseRpcCalls: 3,
        note:
          'No network request sent. Live mode revalidates evidence from an already-qualified retrieval report.',
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/i;

function requireString(value, name, maximum = 160) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) {
    throw new Error('Invalid ' + name + '.');
  }
  return value;
}

function selectProbe(report, now = Date.now()) {
  if (report?.status !== 'completed') {
    throw new Error('Retrieval report is not completed.');
  }
  if (
    report?.configuration?.queryContract !==
    'canonical_fr_from_multilingual_source'
  ) {
    throw new Error('Retrieval query contract is not eligible for P1.7B.');
  }
  const createdAtMs = Date.parse(report?.createdAt ?? '');
  if (
    !Number.isFinite(createdAtMs) ||
    createdAtMs > now + 5 * 60_000 ||
    now - createdAtMs > maxAgeMs
  ) {
    throw new Error('Retrieval report is stale or has an invalid timestamp.');
  }

  const row = (Array.isArray(report?.results) ? report.results : []).find(
    (entry) =>
      entry?.hybrid?.scope === 'supabase_published' &&
      Array.isArray(entry?.hybrid?.evidence) &&
      entry.hybrid.evidence.length > 0,
  );
  if (!row) throw new Error('No live published retrieval evidence is available.');

  const evidence = row.hybrid.evidence.slice(0, 3).map((source) => {
    const documentId = requireString(source?.documentId, 'documentId', 64);
    const chunkId = requireString(source?.chunkId, 'chunkId', 64);
    const version = requireString(source?.version, 'version', 80);
    const locale = requireString(source?.locale, 'locale', 12);
    const market = requireString(source?.market, 'market', 16);
    const contentHash = requireString(source?.contentHash, 'contentHash', 64);
    if (!UUID.test(documentId) || !UUID.test(chunkId) || !SHA256.test(contentHash)) {
      throw new Error('Retrieval evidence identity is invalid.');
    }
    return {
      documentId,
      chunkId,
      version,
      locale,
      market,
      contentHash: contentHash.toLowerCase(),
      effectiveFrom:
        source?.effectiveFrom === null
          ? null
          : requireString(source?.effectiveFrom, 'effectiveFrom', 10),
      effectiveUntil:
        source?.effectiveUntil === null
          ? null
          : requireString(source?.effectiveUntil, 'effectiveUntil', 10),
    };
  });
  if (evidence.length < 1 || evidence.length > 3) {
    throw new Error('Freshness probe requires between one and three sources.');
  }
  return {
    retrievalCreatedAt: new Date(createdAtMs).toISOString(),
    queryContract: report.configuration.queryContract,
    evidence,
  };
}

function rpcSources(evidence, tamperVersion = false) {
  return evidence.map((source, index) => ({
    document_id: source.documentId,
    chunk_id: source.chunkId,
    version:
      tamperVersion && index === 0
        ? source.version.slice(0, 56) + '__stale_probe__'
        : source.version,
    locale: source.locale,
    market: source.market,
  }));
}

const retrieval = JSON.parse(await readFile(retrievalPath, 'utf8'));
const probe = selectProbe(retrieval);

const built = await build({
  stdin: {
    contents:
      "export {supabaseRequest,SupabaseRequestError} from './lib/atlas/supabase'; export {digest} from './lib/atlas/embedding-runtime';",
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { supabaseRequest, SupabaseRequestError, digest } = await import(
  'data:text/javascript;base64,' +
    Buffer.from(built.outputFiles[0].text).toString('base64')
);

const organizationId = process.env.SUPABASE_ORGANIZATION_ID?.trim() ?? '';
if (!UUID.test(organizationId)) {
  throw new Error('SUPABASE_ORGANIZATION_ID is missing or invalid.');
}

const body = {
  p_organization_id: organizationId,
  p_sources: rpcSources(probe.evidence),
};

let currentRows;
try {
  currentRows = await supabaseRequest(
    process.env,
    '/rest/v1/rpc/knowledge_revalidate_sources',
    {
      mode: { kind: 'privileged' },
      method: 'POST',
      timeoutMs: 5000,
      body,
    },
  );
} catch {
  throw new Error('Documentary freshness RPC is unavailable.');
}

if (!Array.isArray(currentRows) || currentRows.length !== probe.evidence.length) {
  throw new Error('Current documentary evidence failed exact revalidation.');
}

const expectedByKey = new Map(
  probe.evidence.map((source) => [
    source.documentId + ':' + source.chunkId,
    source,
  ]),
);
const seen = new Set();
for (const row of currentRows) {
  const key =
    typeof row?.document_id === 'string' && typeof row?.chunk_id === 'string'
      ? row.document_id + ':' + row.chunk_id
      : '';
  const expected = expectedByKey.get(key);
  if (
    !expected ||
    seen.has(key) ||
    row?.version !== expected.version ||
    row?.locale !== expected.locale ||
    row?.market !== expected.market ||
    row?.effective_from !== expected.effectiveFrom ||
    row?.effective_until !== expected.effectiveUntil ||
    !Number.isInteger(row?.revision) ||
    row.revision < 1 ||
    typeof row?.content !== 'string' ||
    row.content.length < 1 ||
    row.content.length > 4000 ||
    (await digest(row.content)) !== expected.contentHash
  ) {
    throw new Error('Current documentary evidence does not match retrieval evidence.');
  }
  seen.add(key);
}
if (seen.size !== probe.evidence.length) {
  throw new Error('Current documentary evidence is incomplete.');
}

let changedRows;
try {
  changedRows = await supabaseRequest(
    process.env,
    '/rest/v1/rpc/knowledge_revalidate_sources',
    {
      mode: { kind: 'privileged' },
      method: 'POST',
      timeoutMs: 5000,
      body: {
        p_organization_id: organizationId,
        p_sources: rpcSources(probe.evidence, true),
      },
    },
  );
} catch {
  throw new Error('Documentary negative revalidation probe is unavailable.');
}
if (!Array.isArray(changedRows) || changedRows.length !== 0) {
  throw new Error('Changed documentary evidence was not blocked.');
}

let publishableBlocked = false;
try {
  await supabaseRequest(process.env, '/rest/v1/rpc/knowledge_revalidate_sources', {
    mode: { kind: 'publishable' },
    method: 'POST',
    timeoutMs: 5000,
    body,
  });
} catch (error) {
  publishableBlocked =
    error instanceof SupabaseRequestError &&
    ([401, 403].includes(error.status) || error.code === '42501');
}
if (!publishableBlocked) {
  throw new Error('Documentary revalidation RPC is executable by publishable clients.');
}

const result = {
  schema: 1,
  kind: 'p1-documentary-freshness-smoke',
  status: 'passed',
  createdAt: new Date().toISOString(),
  retrieval: {
    createdAt: probe.retrievalCreatedAt,
    queryContract: probe.queryContract,
    sourceCount: probe.evidence.length,
  },
  checks: {
    exactCurrentEvidence: true,
    changedVersionBlocked: true,
    publishableExecutionBlocked: true,
  },
  operational: {
    databaseRpcCalls: 3,
    providerCalls: 0,
    embeddingCalls: 0,
  },
  privacy: {
    documentContentIncluded: false,
    documentIdentifiersIncluded: false,
    credentialsIncluded: false,
    rawUpstreamPayloadIncluded: false,
  },
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(result, null, 2) + '\n');
console.log(
  JSON.stringify(
    {
      status: 'passed',
      sourceCount: probe.evidence.length,
      databaseRpcCalls: 3,
      providerCalls: 0,
      embeddingCalls: 0,
      output: outputPath,
    },
    null,
    2,
  ),
);
