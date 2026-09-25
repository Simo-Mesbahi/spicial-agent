import { readFile } from 'node:fs/promises';
import { isAbsolute, posix, resolve } from 'node:path';

const SHA_RE = /^[a-f0-9]{40}$/;
const ID_RE = /^INC-P1-(\d{3})$/;
const TEST_PATH_RE = /^tests\/atlas-[a-z0-9-]+\.test\.mjs$/;
const CODE_RE = /^[a-z0-9_]+$/;

function push(errors, condition, message) {
  if (!condition) errors.push(message);
}

function safeRepoPath(root, relativePath) {
  if (
    typeof relativePath !== 'string' ||
    !relativePath ||
    isAbsolute(relativePath) ||
    relativePath.includes('\\') ||
    posix.normalize(relativePath) !== relativePath ||
    relativePath.startsWith('../') ||
    relativePath.includes('/../')
  ) {
    return null;
  }
  const absolute = resolve(root, relativePath);
  const rootPrefix = resolve(root) + '/';
  return absolute.startsWith(rootPrefix) ? absolute : null;
}

function staticTestTitles(source) {
  const titles = new Set();
  const expressions = [
    /\btest\(\s*'((?:\\.|[^'\\])*)'\s*,/g,
    /\btest\(\s*"((?:\\.|[^"\\])*)"\s*,/g,
  ];
  for (const expression of expressions) {
    for (const match of source.matchAll(expression)) titles.add(match[1]);
  }
  return titles;
}

export async function validateHistoricalRegressionRegistry(
  registry,
  { root = process.cwd() } = {},
) {
  const errors = [];
  push(
    errors,
    registry && typeof registry === 'object' && !Array.isArray(registry),
    'registry must be an object',
  );
  if (!registry || typeof registry !== 'object' || Array.isArray(registry)) {
    return { valid: false, errors, incidents: 0, guardedRuns: [] };
  }

  push(errors, registry.schema === 1, 'registry.schema must equal 1');
  push(
    errors,
    registry.kind === 'p1-historical-regression-registry',
    'registry.kind is invalid',
  );
  push(
    errors,
    registry.workflow === 'P1.7 live qualification',
    'registry.workflow is invalid',
  );

  const firstRun = registry.coverageWindow?.firstRun;
  const lastRun = registry.coverageWindow?.lastRun;
  push(
    errors,
    Number.isInteger(firstRun) &&
      Number.isInteger(lastRun) &&
      firstRun > 0 &&
      lastRun >= firstRun,
    'coverageWindow must contain an ordered positive integer range',
  );

  push(errors, registry.policy?.status === 'covered', 'policy.status must be covered');
  push(
    errors,
    registry.policy?.primaryRootCauseOnly === true,
    'policy.primaryRootCauseOnly must be true',
  );
  push(
    errors,
    registry.policy?.requireRegressionGuard === true,
    'policy.requireRegressionGuard must be true',
  );
  push(
    errors,
    registry.policy?.failOnCoverageGap === true,
    'policy.failOnCoverageGap must be true',
  );

  const incidents = Array.isArray(registry.incidents) ? registry.incidents : [];
  push(errors, incidents.length > 0, 'registry.incidents must be a non-empty array');

  let packageJson = null;
  try {
    packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  } catch {
    errors.push('package.json must be readable');
  }
  push(
    errors,
    typeof packageJson?.scripts?.test === 'string' &&
      packageJson.scripts.test.includes('tests/atlas-*.test.mjs'),
    'npm test must execute tests/atlas-*.test.mjs so registered guards cannot become orphaned',
  );

  const seenIds = new Set();
  const seenRuns = new Set();
  const testTitleCache = new Map();

  for (const [index, incident] of incidents.entries()) {
    const prefix = 'incidents[' + index + ']';
    push(
      errors,
      incident && typeof incident === 'object' && !Array.isArray(incident),
      prefix + ' must be an object',
    );
    if (!incident || typeof incident !== 'object' || Array.isArray(incident)) continue;

    const idMatch = typeof incident.id === 'string' ? incident.id.match(ID_RE) : null;
    push(errors, Boolean(idMatch), prefix + '.id is invalid');
    if (idMatch) {
      push(errors, !seenIds.has(incident.id), 'duplicate incident id: ' + incident.id);
      seenIds.add(incident.id);
    }

    push(errors, incident.status === 'covered', prefix + '.status must be covered');
    push(
      errors,
      typeof incident.title === 'string' &&
        incident.title.trim().length >= 12 &&
        incident.title.length <= 180,
      prefix + '.title is invalid',
    );
    push(
      errors,
      typeof incident.category === 'string' && CODE_RE.test(incident.category),
      prefix + '.category is invalid',
    );
    push(
      errors,
      typeof incident.rootCauseCode === 'string' && CODE_RE.test(incident.rootCauseCode),
      prefix + '.rootCauseCode is invalid',
    );

    const source = incident.source ?? {};
    const runNumber = source.runNumber;
    push(
      errors,
      Number.isInteger(runNumber) && runNumber > 0,
      prefix + '.source.runNumber is invalid',
    );
    push(
      errors,
      Number.isInteger(source.runId) && source.runId > 0,
      prefix + '.source.runId is invalid',
    );
    push(
      errors,
      typeof source.headSha === 'string' && SHA_RE.test(source.headSha),
      prefix + '.source.headSha is invalid',
    );
    push(
      errors,
      typeof source.occurredAt === 'string' &&
        Number.isFinite(Date.parse(source.occurredAt)),
      prefix + '.source.occurredAt is invalid',
    );

    if (Number.isInteger(runNumber)) {
      push(
        errors,
        !seenRuns.has(runNumber),
        'run #' + runNumber + ' is registered more than once',
      );
      seenRuns.add(runNumber);
      if (idMatch) {
        push(
          errors,
          Number(idMatch[1]) === runNumber,
          prefix + '.id must encode source run #' + runNumber,
        );
      }
    }

    const correction = incident.correction ?? {};
    push(
      errors,
      Number.isInteger(correction.pullRequest) && correction.pullRequest > 0,
      prefix + '.correction.pullRequest is invalid',
    );
    push(
      errors,
      typeof correction.mergeCommitSha === 'string' &&
        SHA_RE.test(correction.mergeCommitSha),
      prefix + '.correction.mergeCommitSha is invalid',
    );

    const guards = Array.isArray(incident.guards) ? incident.guards : [];
    push(
      errors,
      guards.length > 0,
      prefix + '.guards must contain at least one regression test',
    );

    const seenGuards = new Set();
    for (const [guardIndex, guard] of guards.entries()) {
      const guardPrefix = prefix + '.guards[' + guardIndex + ']';
      push(errors, guard?.type === 'test', guardPrefix + '.type must be test');
      push(
        errors,
        typeof guard?.path === 'string' && TEST_PATH_RE.test(guard.path),
        guardPrefix + '.path must be an atlas test file',
      );
      push(
        errors,
        typeof guard?.title === 'string' &&
          guard.title.trim().length >= 8 &&
          guard.title.length <= 240,
        guardPrefix + '.title is invalid',
      );
      if (typeof guard?.path !== 'string' || typeof guard?.title !== 'string') continue;

      const key = guard.path + '\0' + guard.title;
      push(
        errors,
        !seenGuards.has(key),
        guardPrefix + ' duplicates another guard in the same incident',
      );
      seenGuards.add(key);

      const absolute = safeRepoPath(root, guard.path);
      if (!absolute || !TEST_PATH_RE.test(guard.path)) continue;

      let titles = testTitleCache.get(absolute);
      if (!titles) {
        try {
          titles = staticTestTitles(await readFile(absolute, 'utf8'));
          testTitleCache.set(absolute, titles);
        } catch {
          errors.push(guardPrefix + '.path is not readable: ' + guard.path);
          continue;
        }
      }
      push(
        errors,
        titles.has(guard.title),
        guardPrefix + ' references a missing static test title: ' + guard.title,
      );
    }
  }

  if (Number.isInteger(firstRun) && Number.isInteger(lastRun) && lastRun >= firstRun) {
    for (let run = firstRun; run <= lastRun; run++) {
      push(
        errors,
        seenRuns.has(run),
        'historical coverage gap: P1.7 run #' + run + ' is not registered',
      );
    }
    for (const run of seenRuns) {
      push(
        errors,
        run >= firstRun && run <= lastRun,
        'registered run #' + run + ' is outside the declared coverage window',
      );
    }
    push(
      errors,
      incidents.length === lastRun - firstRun + 1,
      'coverage window requires exactly one primary incident record per historical run',
    );
  }

  const orderedRuns = incidents.map((incident) => incident?.source?.runNumber);
  push(
    errors,
    orderedRuns.every(
      (run, index) => index === 0 || run > orderedRuns[index - 1],
    ),
    'incidents must be ordered by ascending source run number',
  );

  return {
    valid: errors.length === 0,
    errors,
    incidents: incidents.length,
    guardedRuns: [...seenRuns].sort((a, b) => a - b),
  };
}
