#!/usr/bin/env node
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const args = process.argv.slice(2);
const value = (flag, fallback = null) =>
  args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback;

const finalReportPath = resolve(
  value('--final-report', 'outputs/p1-live/release-final.json'),
);
const outputPath = resolve(
  value('--output', 'outputs/p1-live/release-attestation.json'),
);
const expiresHours = Number(value('--expires-hours', '168'));

if (!Number.isInteger(expiresHours) || expiresHours < 1 || expiresHours > 720)
  throw new Error('--expires-hours must be an integer between 1 and 720.');

const secret = process.env.P1_RELEASE_ATTESTATION_KEY?.trim() ?? '';
if (secret.length < 32 || secret.length > 512)
  throw new Error(
    'P1_RELEASE_ATTESTATION_KEY must be configured server-side with at least 32 characters.',
  );

const report = JSON.parse(await readFile(finalReportPath, 'utf8'));
const valueSha256 = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const requiredGates = [
  'historicalRegressions',
  'subprocesses',
  'reportsReadable',
  'qualificationArtifactIntegrity',
  'structured',
  'retrieval',
  'documentaryFreshness',
  'generation',
  'grounding',
];

if (
  report?.schema !== 1 ||
  report?.kind !== 'p1-live-release-qualification' ||
  report?.runMode !== 'finalize_existing' ||
  report?.releaseAllowed !== true ||
  report?.automatedPassed !== true ||
  report?.humanReview?.approved !== true ||
  report?.humanReview?.valid !== true ||
  report?.qualificationAnchor?.valid !== true ||
  requiredGates.some((gate) => report?.gates?.[gate] !== true) ||
  typeof report?.qualificationId !== 'string' ||
  !/^[a-f0-9]{64}$/.test(report.qualificationId) ||
  report?.parentQualificationId !== report.qualificationId ||
  report?.qualificationAnchor?.sourceQualificationId !== report.qualificationId ||
  report?.humanReview?.qualificationId !== report.qualificationId ||
  typeof report?.artifacts?.sourceTreeSha !== 'string' ||
  !/^[a-f0-9]{40,64}$/.test(report.artifacts.sourceTreeSha) ||
  typeof report?.artifacts?.documentaryFreshnessSha256 !== 'string' ||
  !/^[a-f0-9]{64}$/.test(report.artifacts.documentaryFreshnessSha256) ||
  report?.source?.treeSha !== report.artifacts.sourceTreeSha ||
  typeof report?.scope?.organizationId !== 'string' ||
  !uuid.test(report.scope.organizationId) ||
  valueSha256({ scope: report.scope, artifacts: report.artifacts }) !== report.qualificationId
)
  throw new Error(
    'Final report is not an approved, artifact-bound P1.7 qualification.',
  );

const approvedAtMs = Date.parse(report.createdAt ?? '');
if (!Number.isFinite(approvedAtMs) || approvedAtMs > Date.now() + 5 * 60_000)
  throw new Error('Final report has an invalid approval timestamp.');

const expiresAtMs = approvedAtMs + expiresHours * 60 * 60 * 1000;
const payload = {
  schema: 1,
  qualificationId: report.qualificationId,
  sourceTreeSha: report.artifacts.sourceTreeSha,
  organizationId: report.scope.organizationId,
  approvedAt: new Date(approvedAtMs).toISOString(),
  expiresAt: new Date(expiresAtMs).toISOString(),
};

const built = await build({
  stdin: {
    contents:
      "export {createReleaseAttestation} from './lib/atlas/p1-release-attestation';",
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { createReleaseAttestation } = await import(
  'data:text/javascript;base64,' +
    Buffer.from(built.outputFiles[0].text).toString('base64')
);

const token = await createReleaseAttestation(payload, secret);

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(
  outputPath,
  JSON.stringify(
    {
      schema: 1,
      kind: 'p1-release-attestation',
      token,
      payload,
      deployment: {
        P1_DEPLOYED_SOURCE_TREE_SHA: payload.sourceTreeSha,
        P1_RELEASE_ATTESTATION: token,
      },
      note:
        'P1_RELEASE_ATTESTATION_KEY remains secret and is intentionally never written to this artifact.',
    },
    null,
    2,
  ) + '\n',
);

console.log(
  JSON.stringify(
    {
      status: 'release_attestation_created',
      qualificationId: payload.qualificationId,
      organizationId: payload.organizationId,
      sourceTreeSha: payload.sourceTreeSha,
      expiresAt: payload.expiresAt,
      output: outputPath,
    },
    null,
    2,
  ),
);
