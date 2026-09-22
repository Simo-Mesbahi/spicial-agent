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

The governed live plan currently measures:

- at least 50 structured multilingual conversation turns;
- 20 hybrid-retrieval queries;
- all 10 natural-generation scenarios;
- all 70 factual-grounding scenarios.

The runner caps the qualification budget before executing. Missing metrics never count as passing.

Natural-generation qualification additionally requires explicit human review of:

- naturalness;
- response language;
- conciseness;
- professional business tone.

An automated green report alone does **not** authorize customer release.

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
- authorized case ID;
- customer session identifier.

The bucket is stable for the same session and cannot be chosen by the browser.

Required configuration:

```dotenv
LLM_ORCHESTRATOR=structured
RAG_MODE=hybrid
LLM_GENERATION_MODE=release
LLM_VALIDATION_MODE=release

P1_RELEASE_MODE=canary
P1_CANARY_PERCENT=1
P1_CANARY_SALT=<server-side high-entropy value>
```

Recommended rollout after qualification:

```text
1% → 5% → 15% → 30% → 50% → 100%
```

Expansion is an operational decision based on observed telemetry. There is no automatic percentage increase.

At every percentage the deterministic fallback remains available.

## P1.7E — Full activation

Full release uses:

```dotenv
LLM_ORCHESTRATOR=structured
RAG_MODE=hybrid
LLM_GENERATION_MODE=release
LLM_VALIDATION_MODE=release
P1_RELEASE_MODE=on
```

The release controller refuses to arm `canary` or `on` if any required layer is not enabled.

`GET /api/production/config` exposes only non-secret readiness diagnostics:

- release mode;
- readiness;
- canary percentage;
- whether a salt is configured;
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
