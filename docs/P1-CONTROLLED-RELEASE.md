# P1.7 — Controlled grounded-response release

## Objective

P1.7 is the production boundary between an **untrusted model candidate** and a **customer-visible business response**.

The language model may understand the request and draft natural prose. It never becomes authoritative for:

- customer authorization;
- case identity or case state;
- amounts, dates, warranty or entitlement;
- document publication/currentness;
- business actions;
- rollout decisions.

Those remain server/database responsibilities.

## Runtime sequence

For an eligible case or knowledge turn:

```text
verified customer session
        ↓
structured understanding
        ↓
backend plan
        ↓
fresh authorized case / published RAG
        ↓
Evidence Pack
        ↓
natural draft
        ↓
fresh authorization + exact document revalidation
        ↓
factual validation
        ↓
fresh authorization + exact document revalidation AGAIN
        ↓
deterministic release checks
        ↓
canary cohort check
        ↓
RELEASE or deterministic server fallback
```

Any failed, missing, timed-out, stale, malformed or unqualified stage fails closed.

## P1.7A — Live qualification

The governed contract is in:

- `evals/p1-release-contract.mjs`
- `scripts/evaluate-p1-release.mjs`

The dry run is part of CI and sends no model or embedding requests:

```bash
npm run eval:p1:release
```

A cost-bearing qualification requires explicit confirmation:

```bash
npm run eval:p1:release -- --live --confirm P1_RELEASE
```

For a reproducible remote run, the repository also provides the manual-only
`.github/workflows/p1-live-qualification.yml` workflow. It is never triggered by
pushes or pull requests. Before any provider call it requires the literal
`P1_RELEASE` acknowledgement, requires the `main` branch, validates the required
server secrets and runs the complete no-spend CI/evaluation/build gate. Only then does
it execute the bounded live qualification.

The workflow requires a protected GitHub **Environment** selected at dispatch time.
Use a preproduction environment with reviewer protection for this operation; its
secrets are exposed only to the qualification job after the environment gate is
approved.

The selected environment must provide these GitHub Actions secrets:

- `SUPABASE_URL`;
- `SUPABASE_PUBLISHABLE_KEY`;
- `SUPABASE_SECRET_KEY`;
- `SUPABASE_ORGANIZATION_ID`;
- `GEMINI_API_KEY` and/or `OPENAI_API_KEY` for the selected model provider;
- optional `EMBEDDING_API_KEY` when embeddings use a separate credential.

When `EMBEDDING_API_KEY` is intentionally omitted, the workflow can reuse the
selected Gemini/OpenAI provider key for embeddings without printing it. The workflow
never enables `P1_RELEASE_MODE=canary` or `on`. A successful automated run produces
a seven-day GitHub artifact containing the qualification reports and a fail-closed
`human-review.json` template whose approvals all start disabled.

The governed live plan currently measures:

- exactly 100 structured live turns across four critical conversation families and all five supported languages;
- 20 hybrid-retrieval queries;
- all 10 natural-generation scenarios;
- all 70 factual-grounding scenarios.

The manual workflow performs the 20-query hybrid retrieval qualification **before** the completion-heavy stages. Each scenario starts from an authored FR/EN/DE/ES/AR customer utterance but exercises the reviewed French retrieval query used at the actual structured-orchestrator → `fr-FR` corpus boundary. A fresh report is bound to the `canonical_fr_from_multilingual_source` query contract, provider/model/revision, locale, market and relevance thresholds; an older raw-query report is rejected. Every per-query recall/precision requirement must pass before the report can be reused by the full qualification. This prevents spending the 100 + 10 + 70 completion calls when the production retrieval path is not release-ready.

For the Gemini free-tier qualification baseline, completion calls are paced start-to-start with a 7500 ms minimum interval. The live qualification workflow defaults to `gemini-3.5-flash-lite`; earlier approved Gemini model identifiers remain allowlisted for explicit compatibility runs. The pacing helper itself never retries. Structured understanding, natural generation and the Gemini 3.5 factual judge use strict `json_schema` output. The factual transport is intentionally minimal: the provider returns only the detected language plus ordered semantic verdict/issue pairs; sentence indexes, factual/courtesy classification, evidence identity and citations are reconstructed by the server from the validated draft. Older allowlisted Gemini models retain the prompt-constrained fallback because earlier hosted qualification observed HTTP 400 for the larger judge schema. All factual outputs still pass strict local Zod validation.

The hosted runs on 2026-09-23 measured repeated deadline exhaustion at the former 20s/5s/4s ceilings. Run #9 then measured structured p95 ≈43.25s and p99 ≈45.02s, with multiple otherwise-recoverable requests hitting the 45s boundary exactly. The preproduction qualification profile therefore uses the provider policy's maximum bounded 60-second deadline for structured requests, while natural generation and factual validation remain at 12 seconds. These values do not change normal production defaults when the overrides are unset or extend evidence/session expiry. Recoverable structured retries also wait for a bounded 15-second cooldown before rebuilding the scenario, preventing an immediate retry storm during a short provider brownout.

Hosted run #8 then exposed a different failure mode: Gemini 3.5 returned HTTP 200 for the factual smoke but the prompt-only response did not satisfy the semantic transport contract. The judge contract was therefore reduced further so the model no longer returns server-known `index`, `kind` or citation fields. Gemini 3.5 now receives that minimal contract through structured output, while the server reconstructs and revalidates every authoritative field before assessment. The first governed grounding scenario remains the factual transport smoke before structured/generation spend. The grounding evaluator also fails fast after systemic transport failures; a partial run still fails the automated gate.

Run #9 also exposed two `requiresCase` boundary errors. The server-owned normalizer now treats an informational question about the quote of an already-authorized active case as case-specific (fresh case + procedure evidence required), while a generic information turn with no active or authorized candidate case can no longer be forced into verification merely because the model mislabeled a problem statement as `status`/`eta`/`reason`. Personal lookups remain represented by the distinct `case_lookup` intent and continue to require authorization.

The runner caps the qualification budget before executing: 100 required structured completions, at most 30 additional structured completion calls for up to six clean-scenario retries after recoverable `503/timeout` failures, 10 generation completions, 70 grounding completions and 20 embedding calls. The total completion ceiling is therefore 210. Retries are qualification-only, scenario-level and observable. A provider fallback aborts the current multi-turn attempt immediately; a recoverable transport failure waits through the governed cooldown and restarts that scenario from a fresh synthetic database so later turns are never scored against contaminated conversation state. HTTP 429 is deliberately **not** retried: the first rate-limited structured turn is classified as `provider_rate_limited` and the campaign stops fail-closed. This avoids misclassifying a provider-side rate limit as a recoverable timeout and prevents the retry allowance from being consumed. Semantic mismatches and HTTP 400 request rejections are likewise never retried. Missing metrics, exhausted retry budgets and malformed verdicts never count as passing.

Natural-generation qualification additionally requires explicit human review of:

- naturalness;
- response language;
- conciseness;
- professional business tone.

An automated green report alone does **not** authorize customer release.

The live qualification writes an immutable artifact manifest containing the clean Git
source-tree SHA plus SHA-256 fingerprints for the qualification contract, structured
report, retrieval report, generation report and all grounding shards. A derived
`qualificationId` binds the full evidence set. Live qualification and finalization
refuse tracked working-tree changes, so a reviewed release cannot silently drift to
different application code. Human review is bound to that exact qualification run and
to the exact generated customer-facing prose.

After the live run reaches `human_review_required`, generate the fail-closed review
template:

```bash
npm run eval:p1:review-template -- \
  --qualification-report outputs/p1-live/release-qualification.json \
  --generation outputs/p1-live/generation.json \
  --output outputs/p1-live/human-review.json
```

The template intentionally starts with every approval set to `false` and every review
dimension set to `pending`. A reviewer must inspect each candidate and then set the
four dimensions to `pass` and `approved=true` only when all criteria are satisfied.

Finalization reuses the already-generated qualification artifacts and sends **zero**
provider or embedding calls:

```bash
npm run eval:p1:finalize -- \
  --qualification-report outputs/p1-live/release-qualification.json \
  --human-review outputs/p1-live/human-review.json
```

The final report is written separately to
`outputs/p1-live/release-final.json`; the original live qualification report is never
overwritten. Finalization fails closed if the source tree, organization scope, any
artifact, contract, reviewed candidate, candidate hash, language, rubric, reviewer
metadata or qualification ID has changed.

After—and only after—a successful finalization, create the short-lived signed release
attestation:

```bash
P1_RELEASE_ATTESTATION_KEY='<server-only secret>' \
npm run eval:p1:attest -- \
  --final-report outputs/p1-live/release-final.json \
  --expires-hours 168
```

The signing command independently rechecks the final report, every named automated
gate, human approval, qualification identity, organization scope and source-tree
identity. It writes `outputs/p1-live/release-attestation.json` containing the
non-secret attestation token and the exact qualified source-tree SHA. The HMAC key is
never written to the artifact.

At runtime, `canary` and `on` are rejected unless the HMAC signature is valid, the
attestation is unexpired, its organization matches `SUPABASE_ORGANIZATION_ID`, and
its qualified source tree exactly matches `P1_DEPLOYED_SOURCE_TREE_SHA`. This makes
qualification/human review a technical release prerequisite rather than documentation
alone.

## P1.7B — Documentary freshness gate

`public.knowledge_revalidate_sources` is server-only.

Immediately after model latency it checks the exact evidence identity again:

- organization;
- document ID;
- chunk ID;
- version;
- locale;
- market;
- published status;
- current effective dates;
- non-superseded revision;
- exact chunk content and SHA-256 content hash.

A second identical freshness pass occurs after factual-validation latency.

A document unpublished, replaced, expired or modified during either interval cannot support a released answer.

## P1.7C — Customer release gate

`lib/atlas/p1-release.ts` is the only component allowed to convert a validated draft into customer-visible prose.

Release requires all of the following:

- eligible business plan (`case`, `knowledge`, `case_and_knowledge`);
- selected rollout cohort;
- valid release configuration;
- generation outcome `candidate_generated`;
- factual-validation outcome `supported_candidate`;
- zero validation issues;
- unchanged fresh Evidence Pack;
- valid evidence references;
- correct response language;
- no completed-action claim path;
- safe bounded text;
- no URL, HTML, markdown link, control character or disallowed emoji.

Failure preserves the deterministic server-owned answer. A stale documentary fallback is replaced by the safe “information cannot be confirmed” response rather than stale policy prose.

## P1.7D — Canary rollout

`P1_RELEASE_MODE=canary` uses a deterministic SHA-256 cohort over:

- server-only rollout salt;
- organization ID;
- authorized case ID.

The bucket is stable across browser/session re-authentication for the same dossier and cannot be chosen by the browser.

Required configuration:

```dotenv
LLM_ORCHESTRATOR=structured
RAG_MODE=hybrid
EMBEDDING_PROVIDER=<approved provider>
EMBEDDING_MODEL=<768-dimensional multilingual model>
EMBEDDING_API_KEY=<server secret>
LLM_GENERATION_MODE=release
LLM_VALIDATION_MODE=release

P1_RELEASE_MODE=canary
P1_CANARY_PERCENT=1
P1_CANARY_SALT=<server-side high-entropy value>
P1_DEPLOYED_SOURCE_TREE_SHA=<exact qualified Git tree SHA>
P1_RELEASE_ATTESTATION=<signed token from eval:p1:attest>
P1_RELEASE_ATTESTATION_KEY=<server-only HMAC secret>
```

Recommended rollout after qualification:

```text
1% → 5% → 15% → 30% → 50% → 100%
```

Expansion is an operational decision based on observed telemetry. There is no automatic percentage increase.

Canary observability is recorded asynchronously after the customer response is ready.
The telemetry path stores only bounded technical diagnostics:

- release mode and cohort membership;
- whether a natural response was attempted or released;
- normalized release-block reason;
- plan, generation and validation outcomes;
- provider/model identifiers;
- bounded token counts, provider-call count and latency.

It **never stores** the customer message, generated prose, Evidence Pack content,
case ID, customer ID or session ID. The insert is idempotent by
`organization_id + request_id` and is kept off the response critical path.

Administrators can inspect aggregate 1–168 hour rollout metrics from
`/admin/performance`, including:

- canary sample size;
- attempted and released responses;
- controlled fallback counts;
- evidence/freshness invalidations;
- generation and validation failures;
- P50/P95 latency;
- provider calls/tokens;
- release invariant violations.

The database never returns per-customer telemetry rows to the admin UI. Direct table
access is deny-all; the application writes through a server-only RPC and reads only
through an MFA-backed aggregate RPC. Retention can be enforced with the server-only
`purge_p1_release_events` helper and is capped by the organization retention policy.

At every percentage the deterministic fallback remains available.

## P1.7E — Full activation

Full release uses:

```dotenv
LLM_ORCHESTRATOR=structured
RAG_MODE=hybrid
EMBEDDING_PROVIDER=<approved provider>
EMBEDDING_MODEL=<768-dimensional multilingual model>
EMBEDDING_API_KEY=<server secret>
LLM_GENERATION_MODE=release
LLM_VALIDATION_MODE=release
P1_RELEASE_MODE=on
P1_DEPLOYED_SOURCE_TREE_SHA=<exact qualified Git tree SHA>
P1_RELEASE_ATTESTATION=<signed token from eval:p1:attest>
P1_RELEASE_ATTESTATION_KEY=<server-only HMAC secret>
```

The release controller refuses to arm `canary` or `on` if any required layer is not enabled or if the active generation provider / multilingual embedding provider is not validly configured.

`GET /api/production/config` exposes only non-secret readiness diagnostics:

- release mode;
- readiness;
- canary percentage;
- whether a salt is configured;
- whether the active generation provider is configured;
- whether the embedding provider is configured;
- whether a release attestation is configured and cryptographically verified;
- attestation expiry;
- configuration issue codes.

The salt itself is never exposed.

## Rollback

Emergency rollback is configuration-only:

```dotenv
P1_RELEASE_MODE=off
```

This immediately prevents generated business prose from crossing the customer release boundary while preserving the verified deterministic assistant path.

For a less disruptive investigation mode:

```dotenv
P1_RELEASE_MODE=shadow
LLM_GENERATION_MODE=shadow
LLM_VALIDATION_MODE=shadow
```

Shadow candidates and validation diagnostics remain non-customer-visible.

## Promotion gate

P1 is considered technically complete only when:

1. repository CI is green;
2. GitHub and Supabase migration histories match exactly;
3. documentary freshness smoke tests pass on preproduction;
4. the full live qualification automated contract passes;
5. generation outputs receive explicit human review;
6. a controlled canary is observed without unsafe releases;
7. only then is `P1_RELEASE_MODE=on` eligible for production.

Until those conditions are met, the correct state is fail-closed, not “best effort”.
