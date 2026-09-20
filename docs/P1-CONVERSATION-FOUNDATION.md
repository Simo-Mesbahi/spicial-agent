# P1 conversation foundation — staged rollout

## Audit and scope

Base: `main` at `ab45442eb00db159a8e0bd8f6812190e9571c123` (PR #30). P0 provider transport, diagnostics, health, quotas and evaluation are reused.

The actual corpus contains **307 scenarios / 1,116 turns**, including **20 Pre-P1 families / 100 scenarios / 500 semantic targets**. The handoff's 302 / 1,091 and 19 families are older counts. No corpus, baseline, target or historical CI threshold is changed. The old evaluator reports 439 known gaps and no blocking regression; this is not a P1 quality score.

`/api/chat` still reads verified **D1 demonstration cases**. `/file` and `/suivi` use separate **Supabase production RPCs**. This change does not bridge those data planes. Knowledge uses the existing published-document RPC with server-owned organization filters. MFA, RLS, CSRF, sessions, grants and write workflows remain authoritative.

This increment implements structured understanding, session state, authorized reference selection, planning, guidance, query rewriting and social drafting. Vector retrieval, reranking, production case adapter, evidence-pack generation and a general semantic fact validator remain future P1 work.

## Request path and truth boundary

`LLM_ORCHESTRATOR=legacy` remains the default. `structured` explicitly enables the new path after migration and live validation.

1. Existing session, origin, CSRF, size, request-id and quota checks run. Existing critical security/physical-safety guards can answer without spending.
2. A D1 lease serializes session turns. Concurrent requests receive 409 before a second completion.
3. Understanding receives at most 24 authorized candidate IDs/references/products/kinds, bounded session context and the redacted user message. It receives no current case facts, amounts, codes or customer identity.
4. **One provider call** returns a closed schema and social draft. Strict Zod validation rejects extra fields, invalid enums/JSON and unexpected tools. Confidence below 0.65 leads to clarification; model confidence is not calibrated proof.
5. The server chooses reads. A remembered/returned ID never authorizes access: grants are checked after provider latency, and case facts are fetched again. Rewritten queries affect retrieval only; original redacted messages remain in the normal history.
6. Business answers use existing server renderers/sources. Model business drafts are discarded. Handoff only proposes the existing workflow; no message is sent and no case is mutated by the LLM.
7. Social/general prose passes a conservative multilingual sensitive-claim guard. A rejection uses server wording without a second paid call. This guard is not a complete semantic proof.
8. State, messages, audit and idempotent reply commit in one D1 batch. Lost lease/version aborts the entire batch. Successful telemetry follows persistence.

If access, session expiry or persistence fails after a provider call, an error interaction still records measured tokens and calls with a normalized classification. It excludes prompt/reply text, raw session IDs and arbitrary error messages. Successful telemetry includes persistence latency; the live evaluator measures elapsed API time. Concurrent rejected requests record zero calls, avoiding double-counted spend.

The UI follows the authorized server selection and preserves the structured discussion across case changes. Refresh does not automatically restore a rejected case.

## Session memory

Migration `0006_conversation_state.sql`: one row per space with deletion cascade, schema version, optimistic revision, **30-minute idle TTL bounded by session expiry**, and **60-second lease**. Expired/corrupt/unknown-version memory is discarded. A superseded request cannot release another worker's lease.

State stores active/previous ID, language preferences, topics (six history entries), intents, pending clarification/switch/handoff, guidance acceptance and style. Six recent turns retain at most 400 redacted user characters and 600 social-reply characters each; total payload cannot exceed 12,000 characters. Business replies and tool results are excluded from model memory. This is neither personal memory nor business truth.

Candidate IDs are pruned against live grants. Explicit other-case references require a grant. Cached replay rechecks the selected case's grant. Session reset removes the state.

## Cost and provider portability

- One completion per structured turn; at most 1,600 completion tokens, no tool loop, no schema-repair/model-judge retry. No whole-history retransmission or paid summarization.
- Existing approved budgets and daily/network quotas stay enforced. Upstream failure falls back locally with its normalized reason. Missing token usage remains unknown.
- Existing deadlines: 20 seconds hosted / 40 seconds local, possibly another 5 seconds for retrieval plus DB work. These are ceilings, not demonstrated p95 latency.
- `LLM_STRUCTURED_OUTPUT=json_schema|json_object|prompt` is server-owned. Empty uses JSON schema for OpenAI, JSON object otherwise. Prompt mode supports explicitly configured compatible providers. **All modes use identical strict local validation**; no automatic paid format downgrade.
- Keep the approved model's supported `OPENAI_REASONING_EFFORT`; no blanket reasoning/temperature override is introduced. Reasoning can consume the output budget: test the exact model.

References: [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [Gemini compatibility](https://ai.google.dev/gemini-api/docs/openai). Transport mocks do not establish actual model support or quality.

## Independent live evaluation

The historical `npm run eval:ai` is unchanged. The new runner exercises `/api/chat` with the independent authored Pre-P1 targets. Expected targets never reach the provider. Synthetic D1 fixtures are used; production Supabase configuration is deliberately excluded.

```bash
# Dry run by default: selection and upper call bound only.
npm run eval:ai:structured -- --max-turns 10

# Real configuration stays in the ignored .dev.vars; never paste secrets in chat.
node --env-file=.dev.vars scripts/probe-provider.mjs --live
node --env-file=.dev.vars scripts/evaluate-structured-ai.mjs --live --max-turns 5 --languages fr --families assistant-wellbeing-repair --output outputs/p1-baseline-live.json
```

Default cap: ten turns. Allowed bounds: 5–100, complete scenarios only. Filters support deliberate language/family sampling. After a candidate change, repeat the same selection with a different output and `--compare outputs/p1-baseline-live.json`. Changed corpus hashes are rejected before spending.

Reports contain semantic checks, missing observations, fallbacks, guard rejections, tools, tokens, latency and synthetic responses for human review. `--mode legacy` records the old engine; unavailable semantic metrics remain null. Cost stays null unless complete usage and operator-supplied `AI_EVAL_INPUT_USD_PER_MILLION` / `AI_EVAL_OUTPUT_USD_PER_MILLION` exist.

Declared response language is not proof of actual response language. Naturalness, grounding, case selection and retrieval relevance still require independent human review. Mock tests validate runtime/security behavior, not semantic intelligence.

## Validation and activation

Coverage includes five response languages, four transports, malformed output, upstream failures, unauthorized/expired grants, fresh facts, revoked replay, concurrency, stale-lease rollback, thirty-turn memory, TTL/corruption/reset, preferences, handoff reversal, query preservation and the seven-turn television conversation. Cloudflare/workerd tests exercise real D1 persistence and transactional rollback after lease loss.

Before activation: apply migration 0006 through the deployment's normal migration process; run real provider smoke and a small semantic sample; review five-language/risk-family results, fallbacks, usage completeness and measured latency; then explicitly set `LLM_ORCHESTRATOR=structured`. Rollback is `legacy`, without destructive schema rollback. No remote migration or activation is performed here.

The live check during implementation returned **not_run: no configured live provider**. No paid request was sent. There is no measured live intelligence gain or production-ready claim. The default stays on the validated legacy engine pending those gates.
