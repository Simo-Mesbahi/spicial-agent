# Enterprise conversational evaluation suite

## Purpose

This suite is the regression and capability benchmark for SAV SC Assistant AI before and during the P1 conversational-orchestrator refactor.

It is intentionally harder than the current implementation. A failed new scenario is a measured capability gap, not an excuse to rewrite the expectation. Historical P0 checks remain comparable because their scenario IDs are preserved.

## Current corpus contract

The corpus is now governed as an enterprise test asset rather than a loose list of examples.

Minimum contract:

- at least 200 scenarios;
- at least 525 conversational turns;
- French, English, German, Spanish and Arabic coverage;
- at least 30 explicitly labelled turns per supported language;
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
