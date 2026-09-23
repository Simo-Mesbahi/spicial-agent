# P1.6 — factual audit in shadow mode

Base: main `aa1a84a8ad119909d29814073c16f04d5120dd4e` (#35).

## What this increment proves

A draft now has a separate, bounded factual audit. Deterministic checks bind it to the same organization, authorized case, request, language, current case version and documentary evidence. The configured model audits every sentence for unsupported dates, money/currency, status, warranty, actions, case references, policy conditions, other facts, injection and language. Reports are strictly validated and reduced to metadata.

This is **not a proof of semantic truth and not a customer-release gate**. Generation and auditing may use the same model and share errors. A judge can return a positive verdict with a valid quote while misunderstanding its meaning. Tests explicitly demonstrate that limitation. `supported_candidate` is an advisory result; `released` remains false. The server response remains the sole customer answer. Activation of natural business prose still requires independent live measurement, a reviewed release policy and a subsequent code change. No setting introduced here bypasses this boundary.

## Validation pipeline

1. Validate bounded copies of draft and evidence. Check session deadline, request/tenant/case binding, maximum 30-second evidence lifetime, document checksums and effective dates.
2. Compare the generating pack with a pack from a new authorized case read. Reject changed business data or versions before spending. Retrieval timestamps alone do not constitute a business change.
3. Reserve one atomic D1 quota slot for the organization. Run one independent completion with no tools, no retries and at most 1,200 completion tokens. The normal validation deadline remains four seconds; the governed preproduction qualification may use a bounded server-owned override (currently 12 seconds), still capped by provider, evidence and session expiry.
4. Require exactly one ordered verdict per sentence. The provider-facing transport uses parallel `citationRefs[]` and `citationQuotes[]` arrays to avoid a deeper nested-object schema at the Gemini compatibility boundary. The server requires equal lengths, reconstructs canonical `{ref, quote}` objects and re-runs the full strict Zod schema before assessment. Missing, repeated or extra indices, inconsistent verdicts, unknown references, invented quotes and invalid JSON cause abstention. A supported factual sentence needs a citation; a referenced business sentence cannot be relabeled as courtesy. Scalar quotes must match canonical JSON exactly; documentary quotes must appear in content, never just a title. These checks authenticate citations, not entailment.
5. A reported unsupported claim blocks the candidate. Uncertainty causes abstention. A mismatch between audited prose language and requested language blocks it. A positive report is only a `supported_candidate`.
6. After any audit call, reread current case authorization and facts, invalidate the report if facts changed, rebuild the pack and render the server answer. Session revocation aborts persistence. A replay performs no extra completions.

The auditor receives only draft text and bounded aliased evidence, in a separate data message. It receives no auth tokens, internal tenant/session/request IDs, full history, original question, evaluation labels or rubrics. All external strings remain untrusted. The runtime stores neither draft prose nor full model audit reports in client responses, conversation state, messages or logs.

## Scope and costs

```dotenv
LLM_GENERATION_MODE=off
LLM_GENERATION_DAILY_LIMIT=0
LLM_VALIDATION_MODE=off
LLM_VALIDATION_DAILY_LIMIT=0
```

Both stages default to off. Online auditing requires shadow generation plus shadow validation and explicit positive quotas. Validation has its own atomic per-organization rolling 24-hour request allowance, 0–1,000. Failed attempts consume their reservation. These are request limits, not monetary caps. The existing provider spending policy and configured provider remain authoritative; no fallback judge is chosen silently.

Only existing case-only shadow turns are eligible online. An opted-in turn totals at most three completions: understanding, draft, audit. Casual/knowledge/handoff/action routes add no audit completion. This temporary evaluation overhead is not the proposed default customer latency. No additional paid call is made by default or in CI.

Documentary auditing is available for synthetic fixtures offline. A pack hash and effective date do not establish that a document is still published or permitted in a live database; publication, locale, market and permission revalidation must be implemented before documentary customer release. This increment does not modify Supabase RPCs, RLS, schema, auth or migrations.

## Observability

`atlas.ai.interaction.validation` contains mode, outcome, normalized reason, issue categories, sentence count, call count, latency, token usage and `released:false`. Missing provider usage stays null. The existing provider trace includes understanding, draft and audit attempts. Client metadata only exposes outcome and `released:false`, without reasons, source quotes or report details. Validation failures are distinct from provider failure in the understanding stage.

## Independent evaluation

```bash
# Validates authored coverage only; zero model requests.
npm run eval:grounding

# Explicit operator-only measurement against synthetic evidence, at most five calls.
node --env-file=.dev.vars scripts/evaluate-grounding.mjs --live --max-cases 5

# Continue in bounded batches; maximum 20 calls per execution.
node --env-file=.dev.vars scripts/evaluate-grounding.mjs --live --offset 5 --max-cases 5
```

`evals/grounding.mjs` contains 70 authored cases, 14 families in five languages (FR/EN/DE/ES/AR), with 15 supported controls and 55 unsupported candidates. It covers unknown ETA, status, documentary review, absolute/relative invented dates, amounts, warranty, action completion, wrong reference, removed policy conditions, null-to-zero conversion, mixed true/false claims and attempts to instruct the judge. Expected labels never enter model input. Batches interleave families and languages.

Live reports measure false support among negative controls, supported recall and abstention, with observed calls/tokens/latencies per scenario. The default small batch is not representative of the whole corpus. No live report grants release; even a clean result requires human review. Transport/schema failures mark the run incomplete; false support marks it unsafe. To avoid wasting the remaining corpus after a systemic transport misconfiguration, live grounding stops after an auth/configuration failure or three consecutive upstream request rejections, and the P1.7 runner skips later grounding shards. This does not turn missing evidence into a pass. Dry runs validate coverage only, not hallucination detection quality. Existing conversation and retrieval baselines are unchanged.

## Validation and remaining work

Unit, API and real workerd/D1 tests use provider mocks to verify closed failure behavior, budgets, multilingual schema contracts, provider transports, citation integrity, per-sentence completeness, prompt/data separation, document tampering, case changes, revoked sessions and replay. They test plumbing and release boundaries, not a real model's factual reasoning.

No live provider credentials were used and no paid model call was performed for this increment. Before customer activation: run the independent multilingual corpus with the actual provider/model, inspect false support and false rejection, extend adversarial and policy-conflict coverage, compare naturalness and latency to the server baseline, and review the explicit release policy. Source freshness is enforced at backend reads; this does not create a cross-service transaction with concurrent business updates. Multi-tenant admin configuration and commercial billing remain separate work.
