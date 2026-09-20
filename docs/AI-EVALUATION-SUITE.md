# Enterprise conversational evaluation suite

## Purpose

This suite is the regression and capability benchmark for SAV SC Assistant AI before and during the P1 conversational-orchestrator refactor.

The staged P1 runtime has an additional [bounded live semantic evaluation](P1-CONVERSATION-FOUNDATION.md#independent-live-evaluation). It runs the actual chat API against these unchanged targets, defaults to a dry run, and does not replace the historical regression gate.

It is intentionally harder than the current implementation. A failed new scenario is a measured capability gap, not an excuse to rewrite the expectation. Historical P0 checks remain comparable because their scenario IDs are preserved.

## Current corpus contract

The corpus is now governed as an enterprise test asset rather than a loose list of examples.

Minimum contract:

- at least 300 scenarios;
- at least 1,050 conversational turns;
- French, English, German, Spanish and Arabic coverage;
- at least 100 explicitly labelled turns per supported language;
- a Pre-P1 semantic matrix with at least 19 capability families, 95 multilingual scenarios and 475 human-authored target turns;
- critical/high/standard priorities;
- at least 15 critical scenarios with blocking invariants;
- at least 35 high-priority scenarios;
- at least 9 conversations of 10+ turns;
- explicit risk-domain coverage for privacy, security, financial, physical-safety, policy, action-integrity and context-integrity;
- explicit capability coverage for routing, language, context, case isolation, abstention, handoff, grounding, action safety and conversation quality;
- multilingual prompt-injection and cross-customer isolation probes;
- consent reversal and no-action semantics;
- unsupported commitment and fabricated policy probes;
- case switching, co-reference and implicit-reference probes;
- noisy language, typos, emojis, slang and code switching;
- long-context recovery up to 50 turns;
- returns, refunds, delivery, repair, warranty, payment, quote and human handoff.

The evaluator validates these thresholds before executing the application. A malformed or under-covered corpus fails CI independently of application behavior.

## CI policy

The evaluator makes an important distinction:

1. **Historical regression** — a check that passed in the P0 baseline and now fails. This blocks CI.
2. **Critical required failure** — a check explicitly marked as required, for example case isolation or secret non-disclosure. This blocks CI.
3. **Known capability gap** — a newly authored hard case that currently fails but was never previously passing. This is reported and stays visible, but does not automatically block P1 work.

This prevents two bad practices:
- hiding weaknesses by changing expected answers;
- freezing the current regex router by requiring every newly authored P1 target to pass before P1 exists.

## Report

`npm run eval:ai` writes `outputs/ai-evaluation.json` with:

- corpus version and coverage summary;
- global route/language/tool/action/safety/status metrics;
- coverage and metrics by suite, priority, tag, risk domain and capability;
- historical regressions;
- critical required failures;
- known gaps;
- deterministic local latency percentiles.

Local latency is not production latency.

## What this does not measure yet

Without a live provider, live Supabase corpus and semantic evaluator, the suite does not claim:

- semantic intent accuracy;
- RAG recall/precision;
- semantic groundedness;
- hallucination rate;
- response-language consistency;
- context-retention quality;
- escalation quality;
- token cost;
- live-model latency.

These remain explicitly null in the report instead of being guessed.

## P1 usage

P1 should improve the orchestrator against this corpus without weakening backend sovereignty.

The expected target architecture remains:

`LLM understanding -> conversation state -> planner -> tools -> evidence -> natural response -> grounding guard`

When P1 starts, add structured checks rather than deleting difficult scenarios. In particular, case co-reference, implicit switching, corrections, long-context topic resumption and multilingual switching should become first-class measurable capabilities.

## Authoring rules

Every new scenario must:

- have a stable unique ID;
- represent a real customer behavior or adversarial risk;
- use human-authored expectations;
- avoid encoding implementation details unnecessarily;
- preserve safe backend facts and permissions;
- declare a meaningful suite, priority, tags and, where relevant, risk domains/capabilities;
- use `requiredChecks` only for genuine invariants that must block CI;
- never weaken an expectation merely to make a score look better.

Every **critical** scenario additionally must:

- declare at least one approved `riskDomain`;
- declare at least one approved `capability`;
- contain at least one blocking `requiredChecks` assertion;
- avoid relying on a probabilistic or aesthetic judgment for its blocking condition.

This keeps CI strict on security, privacy, action integrity and factual commitments while allowing difficult P1 capability gaps to remain visible without falsifying the baseline.

The corpus contract is tested independently in `tests/atlas-evaluation-corpus.test.mjs`.


## Enterprise risk taxonomy

Risk metadata is intentionally separate from tags. Tags are descriptive; risk domains are governed.

Current risk domains:

- `privacy`: cross-customer access, enumeration and unnecessary disclosure;
- `security`: secret extraction and prompt-injection behavior;
- `financial`: invented amounts, refunds and payment claims;
- `physical-safety`: unsafe device guidance;
- `policy`: fabricated warranty/return commitments;
- `action-integrity`: consent, reversal and no-write semantics;
- `context-integrity`: wrong dossier/topic/reference carry-over.

Capabilities describe what the assistant must eventually demonstrate, including context retention, case isolation, grounding, abstention, handoff and action safety.

The evaluator reports both dimensions independently so a future P1 improvement can be measured by customer capability and operational risk rather than a single opaque score.


## Pre-P1 conversation contract

Before the P1 orchestrator replaces the current lexical routing layer, the desired customer
experience is frozen as a semantic contract. The goal is not to enumerate every sentence a
customer can write. The goal is to cover the behavior classes the future assistant must
generalize across.

The target product model is:

`general conversational assistant + sovereign business engine`

The LLM may understand language, resolve references, preserve conversational context,
recognize corrections and phrase natural answers. Business facts, permissions, case state,
actions, monetary values, dates and policy commitments remain server/tool authoritative.

### Multilingual parity

`evals/pre-p1-conversations.mjs` contains an intentionally symmetric matrix for:

- French;
- English;
- German;
- Spanish;
- Arabic.

Every capability family has exactly one authored conversation in every supported language.
This prevents French from silently becoming the only first-class conversational experience.

The Pre-P1 matrix currently contributes 95 scenarios and 475 semantic target turns. Combined
with the enterprise corpus, the governed minimum is 300 scenarios and 1,050 turns.

### Semantic target per turn

Pre-P1 turns declare desired semantics separately from the legacy route:

- `intent`: what the customer is trying to accomplish;
- `guidance`: whether the assistant should stay conversational, offer help softly, clarify,
  enter the business flow, respect a declined suggestion, or hand off;
- `requiresCase`: whether authoritative dossier data is necessary;
- `conversationRepair`: whether the assistant must explicitly recover from a misunderstanding
  or correction;
- `responseLanguage`: the language in which the answer should be produced.

These targets are deliberately not derived from current router output. P1 must implement and
expose structured understanding that can later be scored directly against them.

### Guidance policy

Business guidance must be useful without being intrusive.

Allowed target modes:

- `none`: answer the conversation normally; do not inject a SAV prompt;
- `soft_offer`: optionally mention relevant SAV/SC capabilities once, naturally;
- `clarify`: ask the smallest useful question needed to identify the customer goal;
- `business_direct`: the user has expressed sufficient business intent; enter the relevant flow;
- `respect_decline`: the customer declined dossier/service guidance; stop pushing it;
- `handoff`: human escalation is explicitly appropriate/requested.

A customer who says “I just want to chat” must not receive the same dossier prompt on every
turn. A customer who later asks about a return must be able to re-enter the business flow
immediately.

### Required Pre-P1 behavior families

The matrix explicitly covers:

- assistant wellbeing and natural small talk;
- recovery after the assistant misunderstood the user;
- transparent questions about AI/LLM identity and business-fact authority;
- soft discovery of SAV/SC capabilities;
- explicit refusal of business guidance;
- later resumption of business guidance;
- vague-problem discovery through minimal clarification;
- transitions from small talk to business and back;
- correction and co-reference;
- pronouns and implicit references;
- topic resumption after intervening topics;
- response-style preferences;
- capability discovery;
- off-topic handling without fallback loops;
- frustration and de-escalation;
- human handoff cancellation/resumption;
- information-only / no-action consent semantics;
- ambiguity resolution;
- repeated fallback-loop prevention;
- multilingual code switching.

### CI governance

CI validates the Pre-P1 matrix before application execution:

- every family must exist in all five languages;
- every matrix scenario has the expected number of authored turns;
- every turn has a valid semantic target;
- supported intents/guidance modes are centrally allowlisted;
- response-language targets must be supported;
- scenario and turn minimums cannot silently shrink;
- language parity cannot silently regress.

The current application is not expected to satisfy every semantic target yet. Those targets
define the P1 acceptance contract. Current deterministic route/tool regressions and critical
security invariants continue to block CI exactly as before.

This separation is deliberate: the benchmark must be difficult **before** the new orchestrator
is implemented, otherwise the implementation would be judged against expectations written to
match itself.
