export const p1AutomatedReleaseGates = Object.freeze([
  'historicalRegressions',
  'subprocesses',
  'reportsReadable',
  'qualificationArtifactIntegrity',
  'structured',
  'retrieval',
  'generation',
  'grounding',
]);

export function automatedReleaseGatesPass(report) {
  return p1AutomatedReleaseGates.every((gate) => report?.gates?.[gate] === true);
}

export function safeHistoricalRegressionSummary(report) {
  const value = report?.historicalRegressionGate;
  if (
    !value ||
    value.valid !== true ||
    !Number.isInteger(value.incidents) ||
    value.incidents < 1 ||
    !Array.isArray(value.guardedRuns) ||
    value.guardedRuns.length !== value.incidents ||
    !value.guardedRuns.every((run) => Number.isInteger(run) && run > 0) ||
    !Number.isInteger(value.coverageWindow?.firstRun) ||
    !Number.isInteger(value.coverageWindow?.lastRun) ||
    value.coverageWindow.firstRun < 1 ||
    value.coverageWindow.lastRun < value.coverageWindow.firstRun ||
    value.coverageWindow.lastRun - value.coverageWindow.firstRun + 1 !==
      value.incidents
  ) {
    return null;
  }

  const expected = Array.from(
    { length: value.incidents },
    (_, index) => value.coverageWindow.firstRun + index,
  );
  if (!expected.every((run, index) => value.guardedRuns[index] === run)) {
    return null;
  }

  return {
    valid: true,
    incidents: value.incidents,
    guardedRuns: [...value.guardedRuns],
    coverageWindow: {
      firstRun: value.coverageWindow.firstRun,
      lastRun: value.coverageWindow.lastRun,
    },
  };
}
