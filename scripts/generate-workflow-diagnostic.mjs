#!/usr/bin/env node
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  writeFile,
} from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';

import {
  buildWorkflowDiagnostic,
  diagnosticSummaryMarkdown,
} from './lib/workflow-diagnostic.mjs';

const limits = {
  runBytes: 1024 * 1024,
  jobsBytes: 5 * 1024 * 1024,
  logFileBytes: 10 * 1024 * 1024,
  logTotalBytes: 30 * 1024 * 1024,
  artifactFileBytes: 2 * 1024 * 1024,
  artifactTotalBytes: 20 * 1024 * 1024,
  artifactFiles: 100,
};

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index];
    if (!key.startsWith('--')) throw new Error('Unexpected positional argument.');
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error('Missing value for ' + key);
    out[key.slice(2)] = value;
    index++;
  }
  for (const required of ['run', 'jobs', 'output', 'summary']) {
    if (!out[required]) throw new Error('Missing required --' + required);
  }
  return out;
}

async function readBounded(path, maximumBytes) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Unsafe input file: ' + path);
  if (stat.size > maximumBytes) throw new Error('Input exceeds byte limit: ' + path);
  return readFile(path, 'utf8');
}

async function readJsonBounded(path, maximumBytes) {
  return JSON.parse(await readBounded(path, maximumBytes));
}

async function assertInside(root, path) {
  const realRoot = await realpath(root);
  const realPath = await realpath(path);
  if (realPath !== realRoot && !realPath.startsWith(realRoot + sep)) {
    throw new Error('Input escapes configured root.');
  }
  return realPath;
}

async function loadLogs(logsDir) {
  if (!logsDir) return {};
  const root = resolve(logsDir);
  const stat = await lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe logs directory.');

  const logs = {};
  let total = 0;
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink()) continue;
    if (!/^[a-zA-Z0-9._-]+\.log$/.test(entry.name)) continue;
    const path = join(root, entry.name);
    await assertInside(root, path);
    const fileStat = await lstat(path);
    if (fileStat.size > limits.logFileBytes) throw new Error('Log exceeds byte limit.');
    total += fileStat.size;
    if (total > limits.logTotalBytes) throw new Error('Logs exceed total byte limit.');
    logs[entry.name] = await readFile(path, 'utf8');
  }
  return logs;
}

async function walkJson(root, current, output) {
  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(current, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      await assertInside(root, path);
      await walkJson(root, path, output);
      continue;
    }
    if (!entry.isFile() || extname(entry.name).toLowerCase() !== '.json') continue;
    output.push(path);
    if (output.length > limits.artifactFiles) {
      throw new Error('Too many artifact JSON files.');
    }
  }
}

async function loadArtifactDocuments(artifactsDir) {
  if (!artifactsDir) return [];
  const root = resolve(artifactsDir);
  const stat = await lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('Unsafe artifacts directory.');
  }

  const files = [];
  await walkJson(root, root, files);
  const documents = [];
  let total = 0;
  for (const path of files.sort()) {
    await assertInside(root, path);
    const fileStat = await lstat(path);
    if (fileStat.size > limits.artifactFileBytes) continue;
    total += fileStat.size;
    if (total > limits.artifactTotalBytes) {
      throw new Error('Artifact JSON exceeds total byte limit.');
    }
    try {
      documents.push({
        path,
        json: JSON.parse(await readFile(path, 'utf8')),
      });
    } catch {
      // Malformed artifact files are intentionally ignored; they are never copied
      // into the safe diagnostic output.
    }
  }
  return documents;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const run = await readJsonBounded(resolve(args.run), limits.runBytes);
  const jobs = await readJsonBounded(resolve(args.jobs), limits.jobsBytes);
  const logs = await loadLogs(args['logs-dir']);
  const artifactDocuments = await loadArtifactDocuments(args['artifacts-dir']);

  if (run?.status !== 'completed' || run?.conclusion !== 'failure') {
    throw new Error('Only completed failed workflow runs can be diagnosed.');
  }
  if (!Number.isSafeInteger(run?.id) || run.id <= 0) {
    throw new Error('Workflow run ID is missing or invalid.');
  }
  if (!Array.isArray(jobs?.jobs)) {
    throw new Error('Jobs payload is missing its jobs array.');
  }

  const diagnostic = buildWorkflowDiagnostic({
    run,
    jobsResponse: jobs,
    logs,
    artifactDocuments,
  });

  await mkdir(dirname(resolve(args.output)), { recursive: true });
  await mkdir(dirname(resolve(args.summary)), { recursive: true });
  await writeFile(resolve(args.output), JSON.stringify(diagnostic, null, 2) + '\n');
  await writeFile(resolve(args.summary), diagnosticSummaryMarkdown(diagnostic));

  console.log(
    JSON.stringify({
      status: 'diagnosed',
      runId: diagnostic.source.runId,
      workflow: diagnostic.source.workflow,
      category: diagnostic.failure.rootCause.category,
      code: diagnostic.failure.rootCause.code,
      confidence: diagnostic.failure.rootCause.confidence,
      rawLogsIncluded: false,
      output: args.output,
      summary: args.summary,
    }),
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      status: 'diagnostic_failed',
      reason: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exitCode = 1;
});
