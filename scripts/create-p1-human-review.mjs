#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';

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
const computedQualificationId = qualificationArtifacts
  ? createHash('sha256')
      .update(JSON.stringify(qualificationArtifacts))
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
  typeof qualificationArtifacts?.generationSha256 !== 'string' ||
  !Array.isArray(qualificationArtifacts?.groundingSha256) ||
  qualificationArtifacts.groundingSha256.length !== 4 ||
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
    row.diagnostics?.reason !== null
  )
    fail(`Scenario ${row.id} has no valid generated candidate to review.`);

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
    generationReport: generationPath,
    generationSha256,
    scenarioCount: items.length,
  },
  instructions: {
    allowedReviewValues: ['pass', 'fail'],
    approvalRule:
      'Set approved=true only when naturalness, language, conciseness and business_tone are all pass after human inspection.',
    safety:
      'Do not approve a candidate merely because automated factual validation passed. Review customer-facing quality independently.',
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
