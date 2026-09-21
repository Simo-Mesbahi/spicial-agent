# P1.5 — bounded natural-response drafts

Base: main `e2f7c6edc18f1ec22d813fef38ab61eda0db684b` (Evidence Pack, #34).

## Release boundary

This increment implements the generator from the staged roadmap. It deliberately has **no customer-release mode**. The default is off. Explicit shadow mode produces a private candidate, records structure/transport diagnostics, discards the candidate and returns the existing verified server response. A schema-valid sentence with a valid citation can still be false: structural validation must not be represented as factual validation.

P1.6 now adds a shadow factual audit (see `P1-FACTUAL-VALIDATION.md`). A reviewed release policy and independent live evaluation are still required before generated business prose can reach customers. Social responses continue through the existing understanding flow and guard. No benchmark expectations or safety/authentication protections are relaxed.

## Generator contract

`lib/atlas/natural-generation.ts` accepts a validated Evidence Pack, its server context, the bounded current question and structured topic/sub-intent/style guidance. Scope and freshness are checked before and after the request. Case IDs/organizations and document checksums are checked before spending. Internal organization/session/request IDs, full history, credentials, retrieval vectors and evaluation labels are not sent to the provider.

The model receives an instruction message and a separate JSON data message. Documentary text, product names, warranty labels and user content remain untrusted data. Instructions require preserving unknowns, estimates, currencies and action boundaries. They do not by themselves prove protection against every injection.

The output is strict JSON: declared response language and at most six sentences, each at most 500 characters, with bounded evidence references. References use aliases such as `case.status`, `case.confirmedEta` and `knowledge.0`. Unknown, duplicated or missing-all references, extra fields, wrong declared language, empty/partial outputs and unexpected tool calls are rejected. A declared language match does not prove the prose is actually in that language. Semantic entailment, real language quality and naturalness remain evaluation work.

OpenAI strict JSON schema, compatible JSON-object mode and prompt-only mode reuse the existing configured provider transport. OpenAI, Gemini, compatible and local Ollama paths have mock contract tests. No new SDK or fallback provider is introduced. Actual model compatibility still requires a live test.

## Spending and latency

Server-only settings:

```dotenv
LLM_GENERATION_MODE=off
LLM_GENERATION_DAILY_LIMIT=0
```

An operator must explicitly set both `shadow` and a positive quota to make online draft calls. The quota is an atomic D1 reservation per organization per rolling 24 hours, bounded to 0–1,000. It is separate from the existing conversation quota and embedding quota. Reservations are not refunded after transport failure or a late expiry. These are request limits, not monetary billing caps. The existing provider budget policy still applies.

At most one draft completion is made per eligible turn: 900 maximum completion tokens, at most five seconds and never beyond remaining evidence lifetime. No retry or tool loop in generation. The separate P1.6 shadow auditor can optionally add one bounded semantic audit call; it is off by default. Case-only shadow turns can therefore total two completions (understanding plus draft). Casual, clarification, handoff, unsupported-action and documentary turns do not add a runtime draft call.

The limited runtime scope is intentional: case-only answers can reread current case authorization and facts after the new latency. Documentary drafts are available through synthetic evaluation, pending publication revalidation in P1.6. After every attempted runtime draft call, successful or failed, the case adapter rereads access and current facts, builds a fresh pack and renders the verified server answer. Revocation aborts persistence. Idempotent replay adds no provider call.

## Privacy and observability

Full candidates are never placed in customer JSON, message history, conversation state or application logs. Public metadata only states shadow mode, outcome and `released:false`. Internal diagnostics include normalized reason, input case version, call count, latency and token usage; missing upstream usage remains null. Aggregate provider telemetry includes both requests. Generation failures remain distinct from understanding-provider failures.

The operator evaluation below stores candidates only from repository-owned synthetic records. It never loads customer records or contacts a Supabase project.

## Evaluation

```bash
# Dry run: zero provider requests.
npm run eval:generation

# Explicit live evaluation: at most five calls, synthetic evidence only.
node --env-file=.dev.vars scripts/evaluate-generation.mjs --live --max-cases 5
```

`evals/generation.mjs` contains ten authored scenarios: unconfirmed repair ETA and refund-policy explanation, each in FR/EN/DE/ES/AR. The runner supports 1–10 cases and writes `outputs/generation-evaluation.json`. Review criteria are kept out of model input. A structurally successful run reports `requires_human_review`; it does not award groundedness or naturalness scores. Transport/schema errors report incomplete. CI uses dry run only.

Review source entailment, unsupported commitments/actions, real language, tone, concision and consistency against the existing server reply before comparing candidates. This first corpus is not a substitute for the independent broader conversation benchmark.

## Validation and next work

Tests cover all provider HTTP failure classes, network/timeout, malformed/partial output, unexpected tools, stale/cross-scope evidence, zero/concurrent quotas, checksum tampering, prompt/data separation, token accounting and deliberate schema-valid hallucinations. Production API and workerd tests prove draft exclusion, updated case rendering, revocation during generation and replay without repeat spending.

No real provider credentials were available for this increment: no paid call or live naturalness improvement is claimed. No database migration, new dependency or default activation is required. Company-specific administrative persona settings and shared multi-tenant routing remain separate work; the generation scope already binds to the authenticated organization's evidence. The factual release gate must also revalidate documentary eligibility after generation and measure multilingual semantic failures before any customer activation.
