# P1 Historical Regression Gate

## Purpose

Every primary root-cause failure observed in the governed P1.7 live qualification window must remain permanently linked to at least one executable regression test.

The historical workflow run itself is immutable evidence. It is never rewritten or made green retroactively.

## Source of truth

`evals/p1-regression-registry.json` is the machine-readable registry.

For every run inside the declared `coverageWindow`, the registry records:

- the immutable workflow run number and GitHub run ID;
- the exact source SHA that failed;
- a normalized root-cause code and category;
- the corrective pull request and squash-merge SHA;
- one or more static regression-test guards that must still exist and execute under `npm test`.

Only the primary root cause is registered. Expected downstream skips or cascaded failures are not separate incidents.

## Fail-closed rules

`npm run check:regressions` fails if any of the following occurs:

- a run inside the historical coverage window is missing;
- the same run or incident ID is registered twice;
- an incident is not marked `covered`;
- correction evidence is malformed;
- a guard points outside the repository test boundary;
- the referenced static test file or exact test title no longer exists;
- `npm test` no longer executes the registered `tests/atlas-*.test.mjs` suite.

The gate runs in normal CI and in P1.7 before provider spend. The P1 release evaluator also validates the registry itself, so invoking the evaluator directly cannot bypass the historical gate.

## Operating procedure for a new P1.7 failure

1. Preserve the failed workflow and artifacts unchanged.
2. Identify the primary root cause; do not register downstream symptoms as independent incidents.
3. Implement the smallest safe correction without lowering qualification thresholds.
4. Add an exact regression test reproducing the incident.
5. Extend the registry coverage window to the failed run and add its incident record.
6. Run the historical gate and the full Quality checks workflow.
7. Merge only after CI is green, then verify post-merge CI on the exact main SHA.
8. Launch a fresh P1.7 qualification. Never use an old failed run as release evidence.

External provider failures remain valid historical incidents when they expose a software handling or diagnostic defect. An unavoidable external outage by itself is not considered a product regression; the regression guard covers the application's required fail-closed handling.
