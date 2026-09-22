#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const args = process.argv.slice(2);
const value = (flag, fallback) =>
  args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback;

const generationPath = resolve(
  value('--generation', 'outputs/p1-live/generation.json'),
);
const outputPath = resolve(
  value('--output', 'outputs/p1-live/human-review.json'),
);

function fail(message) {
  throw new Error(message);
}

const report = JSON.parse(await readFile(generationPath, 'utf8'));
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

  return {
    id: row.id,
    expectedLanguage: row.language ?? row.draft.language ?? null,
    candidate: sentences.join(' '),
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
    generationReport: generationPath,
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
      generation: generationPath,
      output: outputPath,
      note: 'All approvals are false and all review dimensions are pending by design.',
    },
    null,
    2,
  ),
);
