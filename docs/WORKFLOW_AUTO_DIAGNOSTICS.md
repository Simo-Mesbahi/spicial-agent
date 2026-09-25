# Workflow Auto Diagnostic

## Purpose

The Workflow Auto Diagnostic analyzes failed `Quality checks` and `P1.7 live qualification` runs without modifying source code, opening pull requests, merging changes, or authorizing a release.

It is an evidence and classification layer. Remediation remains a controlled engineering action.

## Triggers

The workflow runs automatically after a failed:

- `Quality checks`
- `P1.7 live qualification`

It can also be launched manually with a failed GitHub Actions `run_id`.

Successful runs are deliberately rejected as diagnostic targets.

## Security model

The diagnostic workflow:

- checks out trusted `main`, never the source SHA of an untrusted pull request;
- uses only `contents: read` and `actions: read`;
- disables persisted checkout credentials;
- receives no application/provider secrets;
- validates that the target run belongs to the same repository;
- accepts only the two allowlisted workflow names;
- bounds jobs, logs, artifacts, JSON sizes, and artifact counts;
- extracts only JSON from allowlisted P1.7 qualification artifacts;
- rejects ZIP path traversal and never calls `extractall`;
- never includes raw logs or raw artifact payloads in diagnostic output.

## Output

Each successful diagnostic produces:

- `workflow-diagnostic.json`
- `diagnostic-summary.md`

The JSON is intentionally allowlist-only and contains:

- workflow/run/SHA identity;
- first failed job and step;
- normalized root-cause category and code;
- external/internal/quality scope;
- retryability when known;
- provider/model only when safely allowlisted;
- bounded secondary failures;
- release impact;
- a controlled recommended-action code;
- explicit privacy assertions.

No raw provider response, prompt, customer text, credential, API key, or arbitrary log excerpt is retained.

## Classification precedence

1. normalized P1 release/evaluation artifact;
2. allowlisted signal found only inside the exact failed-step time window;
3. deterministic failed-step classification;
4. `unclassified_workflow_failure`.

Whole-job log scanning is intentionally forbidden because regression fixtures from earlier successful steps can contain historical error strings and create false diagnoses.

## Failure behavior

If the diagnostic pipeline itself fails, the workflow remains red and emits a minimal fail-closed marker:

`diagnostic_pipeline_failed`

This marker contains no raw failure body. It exists only so an operational failure of the diagnostic system is itself observable.

## Remediation boundary

The engine never:

- edits source code;
- retries a product release;
- changes P1 thresholds;
- increases provider budgets;
- opens or merges a pull request;
- deploys;
- changes release mode.

A human-controlled engineering workflow consumes the diagnostic and performs any required correction with tests, CI, review, and post-merge verification.
