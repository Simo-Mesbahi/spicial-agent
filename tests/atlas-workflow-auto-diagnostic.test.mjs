import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildWorkflowDiagnostic,
  diagnosticSummaryMarkdown,
} from '../scripts/lib/workflow-diagnostic.mjs';

function failedRun(overrides = {}) {
  return {
    id: 36172720122,
    name: 'P1.7 live qualification',
    run_number: 26,
    event: 'workflow_dispatch',
    status: 'completed',
    conclusion: 'failure',
    head_sha: 'be42f31c0bcaccbe20b1afbe193cf344dfc66198',
    created_at: '2026-09-25T18:19:49Z',
    updated_at: '2026-09-25T18:23:27Z',
    repository: { full_name: 'Simo-Mesbahi/spicial-agent' },
    ...overrides,
  };
}

function failedJobs(step = 'Verify automated qualification gate') {
  return {
    total_count: 1,
    jobs: [
      {
        id: 108195913860,
        name: 'qualify',
        conclusion: 'failure',
        steps: [
          {
            number: 1,
            name: 'Set up job',
            conclusion: 'success',
            started_at: '2026-09-25T18:19:50Z',
            completed_at: '2026-09-25T18:19:51Z',
          },
          {
            number: 9,
            name: step,
            conclusion: 'failure',
            started_at: '2026-09-25T18:23:20Z',
            completed_at: '2026-09-25T18:23:24Z',
          },
        ],
      },
    ],
  };
}

test('workflow diagnostic reproduces run 26 daily-quota root cause without raw log leakage', () => {
  const diagnostic = buildWorkflowDiagnostic({
    run: failedRun(),
    jobsResponse: failedJobs(),
    logs: {
      '108195913860.log':
        '2026-09-25T18:23:22.000Z PRIVATE-CUSTOMER gemini-test-key quotaId=GenerateRequestsPerDay ' +
        'systemicTransportFailure=provider_daily_quota_exhausted',
    },
    artifactDocuments: [],
    generatedAt: '2026-09-25T20:00:00Z',
  });

  assert.equal(diagnostic.schemaVersion, 1);
  assert.equal(diagnostic.kind, 'workflow-diagnostic');
  assert.equal(diagnostic.source.runNumber, 26);
  assert.equal(diagnostic.failure.rootCause.category, 'external_dependency');
  assert.equal(
    diagnostic.failure.rootCause.code,
    'provider_daily_quota_exhausted',
  );
  assert.equal(diagnostic.failure.rootCause.scope, 'external');
  assert.equal(diagnostic.failure.rootCause.retryable, false);
  assert.equal(
    diagnostic.recommendedAction.code,
    'wait_for_provider_quota',
  );
  assert.equal(diagnostic.releaseImpact.blocked, true);
  assert.equal(diagnostic.releaseImpact.failClosed, true);
  assert.equal(diagnostic.privacy.rawLogsIncluded, false);

  const serialized = JSON.stringify(diagnostic);
  assert.doesNotMatch(
    serialized,
    /PRIVATE-CUSTOMER|gemini-test-key|GenerateRequestsPerDay/,
  );
});

test('normalized P1 release artifact outranks conflicting raw log signals', () => {
  const diagnostic = buildWorkflowDiagnostic({
    run: failedRun(),
    jobsResponse: failedJobs(),
    logs: {
      'job.log':
        'unknown_evidence_reference PRIVATE-TEXT provider_rate_limited',
    },
    artifactDocuments: [
      {
        path: '/tmp/release-qualification.json',
        json: {
          outcome: 'external_dependency_blocked',
          blocker: {
            category: 'external_dependency',
            stage: 'structured',
            code: 'provider_daily_quota_exhausted',
            provider: 'gemini',
            model: 'gemini-3.5-flash-lite',
            releaseBlocked: true,
            retryRecommended: false,
            privateMessage: 'DO-NOT-COPY',
          },
        },
      },
    ],
  });

  assert.equal(
    diagnostic.failure.rootCause.code,
    'provider_daily_quota_exhausted',
  );
  assert.equal(diagnostic.failure.rootCause.source, 'normalized_release_artifact');
  assert.equal(diagnostic.failure.rootCause.stage, 'structured');
  assert.equal(diagnostic.failure.rootCause.provider, 'gemini');
  assert.equal(diagnostic.failure.rootCause.model, 'gemini-3.5-flash-lite');
  assert.deepEqual(diagnostic.evidence.artifactReports, [
    'release-qualification.json',
  ]);
  assert.doesNotMatch(
    JSON.stringify(diagnostic),
    /DO-NOT-COPY|PRIVATE-TEXT/,
  );
});

test('workflow diagnostic never copies untrusted blocker codes, providers or model strings', () => {
  const diagnostic = buildWorkflowDiagnostic({
    run: failedRun(),
    jobsResponse: failedJobs('Run npm run build'),
    logs: {},
    artifactDocuments: [
      {
        path: '/tmp/release-qualification.json',
        json: {
          outcome: 'external_dependency_blocked',
          blocker: {
            category: 'external_dependency',
            code: 'SECRET-BLOCKER-CODE',
            provider: 'PRIVATE-PROVIDER',
            model: 'api-key-super-secret',
            retryRecommended: false,
          },
        },
      },
    ],
  });

  assert.equal(diagnostic.failure.rootCause.code, 'build_failed');
  const serialized = JSON.stringify(diagnostic);
  assert.doesNotMatch(
    serialized,
    /SECRET-BLOCKER-CODE|PRIVATE-PROVIDER|api-key-super-secret/,
  );
});

test('workflow diagnostic ignores allowlisted signals from earlier successful steps', () => {
  const diagnostic = buildWorkflowDiagnostic({
    run: failedRun({
      id: 77,
      name: 'Quality checks',
      run_number: 370,
      event: 'pull_request',
      head_sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    }),
    jobsResponse: {
      jobs: [
        {
          id: 9001,
          name: 'verify',
          conclusion: 'failure',
          steps: [
            {
              number: 7,
              name: 'Run npm test',
              conclusion: 'success',
              started_at: '2026-09-25T18:20:00Z',
              completed_at: '2026-09-25T18:21:00Z',
            },
            {
              number: 14,
              name: 'Run npm run build',
              conclusion: 'failure',
              started_at: '2026-09-25T18:30:00Z',
              completed_at: '2026-09-25T18:30:20Z',
            },
          ],
        },
      ],
    },
    logs: {
      '9001.log': [
        '2026-09-25T18:20:30.000Z provider_daily_quota_exhausted from regression test fixture',
        '2026-09-25T18:30:05.000Z build compilation failed',
      ].join('\n'),
    },
  });

  assert.equal(diagnostic.failure.rootCause.category, 'build');
  assert.equal(diagnostic.failure.rootCause.code, 'build_failed');
  assert.equal(diagnostic.failure.rootCause.source, 'failed_step');
});

test('workflow diagnostic falls back deterministically to the first failed CI step', () => {
  const diagnostic = buildWorkflowDiagnostic({
    run: failedRun({
      id: 42,
      name: 'Quality checks',
      run_number: 369,
      event: 'pull_request',
      head_sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    }),
    jobsResponse: failedJobs('Run npm run typecheck'),
  });

  assert.equal(diagnostic.failure.rootCause.category, 'code_quality');
  assert.equal(diagnostic.failure.rootCause.code, 'typecheck_failed');
  assert.equal(diagnostic.failure.rootCause.scope, 'internal');
  assert.equal(diagnostic.failure.rootCause.retryable, false);
  assert.equal(diagnostic.failure.rootCause.confidence, 'medium');
});

test('workflow diagnostic preserves first failure and bounds secondary failures', () => {
  const jobs = { jobs: [] };
  for (let index = 0; index < 15; index++) {
    jobs.jobs.push({
      id: 1000 + index,
      name: 'job-' + index,
      conclusion: 'failure',
      steps: [
        {
          number: 1,
          name: 'Run npm test',
          conclusion: 'failure',
          started_at: new Date(Date.UTC(2026, 8, 25, 10, index)).toISOString(),
        },
      ],
    });
  }

  const diagnostic = buildWorkflowDiagnostic({
    run: failedRun(),
    jobsResponse: jobs,
  });

  assert.equal(diagnostic.failure.firstFailure.job, 'job-0');
  assert.equal(diagnostic.failure.secondaryFailures.length, 11);
  assert.equal(diagnostic.failure.secondaryFailures[0].job, 'job-1');
  assert.equal(diagnostic.failure.secondaryFailures.at(-1).job, 'job-11');
});

test('diagnostic markdown contains only controlled summary fields', () => {
  const diagnostic = buildWorkflowDiagnostic({
    run: failedRun(),
    jobsResponse: failedJobs(),
    logs: {
      '108195913860.log':
        '2026-09-25T18:23:22.000Z provider_daily_quota_exhausted SECRET-UPSTREAM-CONTENT',
    },
  });
  const markdown = diagnosticSummaryMarkdown(diagnostic);

  assert.match(markdown, /Category: external_dependency/);
  assert.match(markdown, /Code: provider_daily_quota_exhausted/);
  assert.match(markdown, /Raw logs included: false/);
  assert.doesNotMatch(markdown, /SECRET-UPSTREAM-CONTENT/);
});

test('workflow diagnostic CLI writes bounded artifacts for a failed run', () => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-workflow-diagnostic-'));
  try {
    const runPath = join(dir, 'run.json');
    const jobsPath = join(dir, 'jobs.json');
    const outputPath = join(dir, 'out', 'workflow-diagnostic.json');
    const summaryPath = join(dir, 'out', 'diagnostic-summary.md');
    writeFileSync(runPath, JSON.stringify(failedRun()));
    writeFileSync(jobsPath, JSON.stringify(failedJobs('Run npm run build')));

    const stdout = execFileSync(
      process.execPath,
      [
        'scripts/generate-workflow-diagnostic.mjs',
        '--run',
        runPath,
        '--jobs',
        jobsPath,
        '--output',
        outputPath,
        '--summary',
        summaryPath,
      ],
      { encoding: 'utf8' },
    );

    const result = JSON.parse(stdout);
    const diagnostic = JSON.parse(readFileSync(outputPath, 'utf8'));
    const summary = readFileSync(summaryPath, 'utf8');

    assert.equal(result.status, 'diagnosed');
    assert.equal(diagnostic.failure.rootCause.code, 'build_failed');
    assert.match(summary, /Release blocked: true/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('workflow diagnostic CLI refuses successful runs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-workflow-diagnostic-success-'));
  try {
    const runPath = join(dir, 'run.json');
    const jobsPath = join(dir, 'jobs.json');
    writeFileSync(
      runPath,
      JSON.stringify(
        failedRun({
          conclusion: 'success',
        }),
      ),
    );
    writeFileSync(jobsPath, JSON.stringify({ total_count: 1, jobs: [] }));

    assert.throws(
      () =>
        execFileSync(
          process.execPath,
          [
            'scripts/generate-workflow-diagnostic.mjs',
            '--run',
            runPath,
            '--jobs',
            jobsPath,
            '--output',
            join(dir, 'output.json'),
            '--summary',
            join(dir, 'summary.md'),
          ],
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
        ),
      (error) => {
        assert.equal(error.status, 1);
        assert.match(error.stderr, /completed failed runs/);
        return true;
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('auto-diagnostic workflow is automatic, manual, read-only and trusted-source only', () => {
  const source = readFileSync(
    '.github/workflows/workflow-auto-diagnostic.yml',
    'utf8',
  );

  assert.match(source, /workflow_run:/);
  assert.match(source, /- Quality checks/);
  assert.match(source, /- P1\.7 live qualification/);
  assert.match(source, /workflow_dispatch:/);
  assert.match(source, /github\.event\.workflow_run\.conclusion == 'failure'/);
  assert.match(source, /contents: read/);
  assert.match(source, /actions: read/);
  assert.doesNotMatch(source, /\b(?:contents|actions|pull-requests|issues): write\b/);
  assert.doesNotMatch(source, /pull_request_target/);
  assert.doesNotMatch(source, /secrets\./);
  assert.match(source, /ref: main/);
  assert.match(source, /persist-credentials: false/);
  assert.match(source, /Only completed failed runs can be diagnosed/);
  assert.match(source, /Target workflow is not allowlisted/);
  assert.match(source, /p1-live-qualification-\[a-f0-9\]/);
  assert.match(source, /path: diagnostics\/output\//);
  assert.doesNotMatch(source, /path: diagnostics\/input\//);
  assert.match(source, /retention-days: 30/);
});

test('auto-diagnostic artifact extraction rejects traversal and bounds JSON payloads', () => {
  const source = readFileSync(
    '.github/workflows/workflow-auto-diagnostic.yml',
    'utf8',
  );

  assert.match(source, /pathlib\.PurePosixPath\(name\)\.is_absolute\(\)/);
  assert.match(source, /"\.\." in parts/);
  assert.match(source, /max_file = 2 \* 1024 \* 1024/);
  assert.match(source, /max_total = 20 \* 1024 \* 1024/);
  assert.match(source, /max_files = 100/);
  assert.match(source, /bundle\.read\(info\)/);
  assert.doesNotMatch(source, /extractall\(/);
});
