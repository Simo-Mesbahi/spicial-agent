# Enterprise conversational evaluation suite

## Purpose

This suite is the regression and capability benchmark for SAV SC Assistant AI before and during the P1 conversational-orchestrator refactor.

It is intentionally harder than the current implementation. A failed new scenario is a measured capability gap, not an excuse to rewrite the expectation. Historical P0 checks remain comparable because their scenario IDs are preserved.

## Current corpus contract

- at least 155 scenarios;
- at least 330 conversational turns;
- French, English, German, Spanish and Arabic coverage;
- critical/high/standard priorities;
- long conversations;
- safety and prompt-injection probes;
- case switching and implicit-reference probes;
- noisy language, typos and slang;
- returns, refunds, delivery, repair, warranty, payment, quote and human handoff;
- explicit abstention / anti-fabrication cases.

The current expanded corpus contains 160 scenarios and 368 turns.

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
- coverage and metrics by suite, priority and tag;
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
- use `requiredChecks` only for genuine invariants that must block CI;
- never be changed merely to make a score look better.

The corpus contract is tested independently in `tests/atlas-evaluation-corpus.test.mjs`.
