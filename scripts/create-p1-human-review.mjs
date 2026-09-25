#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { p1GroundingReportCount } from '../evals/p1-grounding-plan.mjs';

const args = process.argv.slice(2);
const value = (flag, fallback) =>
  args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback;

const generationPath = resolve(
  value('--generation', 'outputs/p1-live/generation.json'),
);
const qualificationPath = resolve(
  value('--qualification-report', 'outputs/p1-live/release-qualification.json'),
);
const outputPath = resolve(
  value('--output', 'outputs/p1-live/human-review.json'),
);

function fail(message) {
  throw new Error(message);
}

const generationRaw = await readFile(generationPath, 'utf8');
const generationSha256 = createHash('sha256').update(generationRaw).digest('hex');
const qualificationRaw = await readFile(qualificationPath, 'utf8');
const qualification = JSON.parse(qualificationRaw);
const qualificationArtifacts =
  qualification?.artifacts && typeof qualification.artifacts === 'object'
    ? qualification.artifacts
    : null;
const qualificationScope =
  qualification?.scope && typeof qualification.scope === 'object'
    ? qualification.scope
    : null;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const computedQualificationId =
  qualificationArtifacts &&
  qualificationScope &&
  UUID.test(qualificationScope.organizationId ?? '')
    ? createHash('sha256')
        .update(
          JSON.stringify({
            scope: qualificationScope,
            artifacts: qualificationArtifacts,
          }),
        )
        .digest('hex')
    : null;

if (
  qualification?.schema !== 1 ||
  qualification?.kind !== 'p1-live-release-qualification' ||
  qualification?.runMode !== 'live' ||
  qualification?.automatedPassed !== true ||
  typeof qualification?.qualificationId !== 'string' ||
  !/^[a-f0-9]{64}$/.test(qualification.qualificationId) ||
  computedQualificationId !== qualification.qualificationId ||
  typeof qualificationArtifacts?.contractSha256 !== 'string' ||
  typeof qualificationArtifacts?.structuredSha256 !== 'string' ||
  typeof qualificationArtifacts?.retrievalSha256 !== 'string' ||
  typeof qualificationArtifacts?.documentaryFreshnessSha256 !== 'string' ||
  !/^[a-f0-9]{64}$/.test(qualificationArtifacts.documentaryFreshnessSha256) ||
  typeof qualificationArtifacts?.generationSha256 !== 'string' ||
  !Array.isArray(qualificationArtifacts?.groundingSha256) ||
  qualificationArtifacts.groundingSha256.length !== p1GroundingReportCount ||
  qualificationArtifacts.groundingSha256.some(
    (value) => typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value),
  ) ||
  qualificationArtifacts.generationSha256 !== generationSha256
)
  fail('Qualification report is not a valid automated-passed source for this generation artifact.');

const report = JSON.parse(generationRaw);
const results = Array.isArray(report.results) ? report.results : [];
if (!results.length) fail('Generation report has no reviewable results.');

const ids = results.map((row) => row?.id).filter((id) => typeof id === 'string');
if (ids.length !== results.length || new Set(ids).size !== ids.length)
  fail('Generation report has invalid or duplicate scenario IDs.');

const items = results.map((row) => {
  if (
    !row.draft ||
    row.diagnostics?.outcome !== 'candidate_generated' ||
    row.diagnostics?.reason !== null ||
    row.factualValidation?.outcome !== 'supported_candidate' ||
    row.factualValidation?.reason !== null ||
    row.factualValidation?.issues?.length !== 0 ||
    row.groundedness !== true
  )
    fail(`Scenario ${row.id} has no factually validated generated candidate to review.`);

  const sentences = Array.isArray(row.draft.sentences)
    ? row.draft.sentences.map((sentence) => sentence?.text).filter(Boolean)
    : [];
  if (!sentences.length) fail(`Scenario ${row.id} has an empty candidate.`);

  const candidate = sentences.join(' ');
  return {
    id: row.id,
    expectedLanguage: row.language ?? row.draft.language ?? null,
    candidate,
    candidateSha256: createHash('sha256').update(candidate).digest('hex'),
    rubric: Array.isArray(row.rubric) ? row.rubric : [],
    approved: false,
    naturalness: 'pending',
    language: 'pending',
    conciseness: 'pending',
    business_tone: 'pending',
    notes: '',
  };
});

const template = {
  schema: 1,
  reviewer: '',
  reviewedAt: '',
  source: {
    kind: 'p1-generation-evaluation',
    qualificationReport: qualificationPath,
    qualificationId: qualification.qualificationId,
    organizationId: qualificationScope.organizationId,
    generationReport: generationPath,
    generationSha256,
    scenarioCount: items.length,
  },
  instructions: {
    allowedReviewValues: ['pass', 'fail'],
    approvalRule:
      'Set approved=true only when naturalness, language, conciseness and business_tone are all pass after human inspection.',
    safety:
      'Automated factual validation is required before this template is created, but it is model-assisted rather than proof. Review customer-facing naturalness, language, conciseness and business tone independently.',
  },
  items,
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(template, null, 2) + '\n');

console.log(
  JSON.stringify(
    {
      status: 'human_review_template_created',
      releaseAllowed: false,
      scenarios: items.length,
      qualification: qualificationPath,
      qualificationId: qualification.qualificationId,
      generation: generationPath,
      output: outputPath,
      note: 'All approvals are false and all review dimensions are pending by design.',
    },
    null,
    2,
  ),
);
