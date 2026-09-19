# P0 — provider foundation, 2026-09-19

## Scope and starting evidence

Audited GitHub `main` at `d0902a619940a7b511a4d09427963f6b31fbb14f` (PR #25).
A separate clean checkout was used: an older local branch had uncommitted admin/session
work, which was not touched. The original application suite passed **198/198** before edits.
The lockfile matched the existing installed local dependency tree exactly (SHA-256
`075bbde949a7415a132e02c6dbc11145b402e171243719082e329250c36a5eb3`);
local validation reused that tree. CI must still validate a fresh `npm ci`.

No active provider configuration or API key was available in this execution environment
or in the related checkout's standard local environment files. Actual deployed settings,
provider account permissions and historical upstream error responses were not accessible.
**No claim is made that the observed production incident has been reproduced or fixed.**

## Architecture actually present

1. `worker/index.ts` dispatches `/api/*` to `handleApi` and production routes to separate
   production/admin handlers. Admin requests also pass the persistent idle/session guard.
2. `/api/chat` verifies the D1 session, CSRF, authorized case grant, message bounds,
   reference constraints, idempotency and quotas. History is scoped to the selected case
   and limited to 12 messages; provider context uses up to eight same-case messages.
3. `conversation-intelligence.ts` uses lexical language/intent rules. Small talk, case
   switching, security and support decisions can be served locally without a provider call.
4. Business queries use `knowledge-runtime.ts`. Configured Supabase retrieval calls
   `knowledge_search` with server-owned organization and French locale. It is lexical
   FTS/trigram retrieval, with published/current document filtering in SQL. Retrieval
   outages return no evidence; the built-in corpus is used only without configured Supabase.
   There is no vector retrieval or LLM understanding/state layer in this P0 change.
5. Model selection combines server environment and scoped D1 admin settings.
   Secrets, provider enablement and spending policy remain server-owned. Invalid/revoked
   saved settings currently select demo; this pre-existing behavior is not a provider outage.
6. `generate` runs at most three Chat Completions rounds under a shared deadline.
   Available tools are `get_case` (the already authorized D1 case) and `search_knowledge`.
   Tool results are paired by ID; the last round disables tool choice. Business replies
   remain server-authored from verified facts; only the open conversational route uses
   unrestricted model wording. `mode=openai` does not mean business prose was model-authored.
7. The production `/file` → `/suivi` flow reads real Supabase dossiers via separate RPCs
   and secure cookies. **The current chat is not connected to real Supabase dossier grants.**
   The admin UI already documents this distinction. Connecting these planes is future work.

Security preserved: cookie protections, CSRF, expiry, MFA/AAL2, admin organization/role
checks, D1 grants, RLS/server-only RPC boundaries, bounded JSON, redirects blocked before
credentials can be forwarded, read-only model tools, quotas and evidence-based business replies.
No Supabase schema, permissions, auth flow or business transition was modified.

## Demonstrated defects and changes

| Observation in original code | P0 change | Verification |
| --- | --- | --- |
| `reasoning_effort=none` imposed on every OpenAI model | Optional validated server `OPENAI_REASONING_EFFORT`; omitted when unset | Payload tests for unset, explicit and invalid values |
| Upstream error bodies immediately discarded; classification depended on French exception text | Typed failure reasons; HTTP status and allowlisted error code/parameter retained internally | 400/401/403/422/429/500/502/503, redirects, malicious error text tests |
| `OPENAI_MODEL` could be absent from fallback logs because only `LLM_MODEL` was logged | Log resolved provider/model from effective configuration | API tests using provider-specific model |
| Usage from earlier rounds lost when a later round failed | Per-attempt counters survive failure; known token totals and completeness flag retained | Successful tool round followed by 429 |
| Missing tool `type` accepted then forwarded unchanged | Validated tool type normalized to `function` | Transcript/ID pairing assertion |
| Tool calls could be executed on a route advertising no tools | Reject unadvertised tool calls | Fail-closed transport/API regression coverage |
| No paid-provider synthetic health or conversational baseline | Shared transport health with persistent cache/lease; baseline vs candidate CI gate | Health, quota, authorization/concurrency tests; 65 scenarios/131 turns |

The OpenAI change is preventive compatibility work, not proof of the real incident's root
cause. Omitting reasoning uses the provider's default and can increase latency/reasoning
tokens. Set an explicitly supported effort for the approved model, then measure real calls.
No model identifier is substituted, and no automatic paid retry is introduced.
Official contract: https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create

## Observability contract

`atlas.ai.interaction` contains a server-generated trace/request ID, hashed ephemeral
session identifier, timestamp, resolved provider/model, route, detected language, mode,
fallback reason, initial retrieval time/evidence, actual provider calls, actual tool calls,
per-attempt HTTP status/latency/usage, tool-retrieval evidence (document/chunk/version/score),
escalation and outcome. No prompts, tool results, customer facts, secrets or raw upstream
error messages are logged. The client idempotency key is not used as the log correlation ID.
`Atlas LLM fallback` adds only allowlisted error details linked by the same trace ID.

Response/message metadata retains existing fields plus trace ID, model, timings and known
consumption. `measuredInputTokens`/`measuredOutputTokens` are observed totals, not estimates.
`usageComplete=false` means at least one attempted call omitted usage or failed; never
interpret unknown usage as zero billed tokens. `executedTools` is distinct from server
answer `tools`. Provider time excludes retrieval; `latencyMs` covers the chat branch up to
answer assembly, not network transmission, prior session middleware or final persistence.

Structured events permit downstream fallback/error/availability and latency percentile
calculation. No durable log-export backend, production dashboard aggregation, pricing
catalog, satisfaction instrumentation or semantic hallucination judge is claimed here.
Configure deployment log retention/access controls before operational rollout.

## Health behavior and deployment

| Endpoint | What it establishes | Provider calls |
| --- | --- | --- |
| `GET /api/live` | Worker handler responds independently of storage/config | None |
| `GET /api/ready` | Effective provider configuration is structurally ready; otherwise degraded | None |
| Existing `/api/health`, `/api/production/health` | Existing storage/database checks, unchanged | None |
| `POST /api/production/admin/operations/provider-health?organizationId=…` | Real fixed mini-completion, exact `OK`, positive usage | At most one per uncached probe |

Synthetic route requires active admin session/MFA, deployment organization, super_admin,
same-origin POST and strict empty JSON `{}`. No caller-controlled provider, model or prompt.
Results are server-cached 5 minutes in D1, failures included. An atomic D1 lease suppresses
concurrent probes across workers. Fingerprint changes on key, endpoint, model or payload
changes; raw keys are never stored. Limits: one fresh probe/minute and 12/day per deployment,
plus the existing shared `LLM_DAILY_LIMIT`. No cache-bypass flag. Demo/invalid configuration
is degraded without an external call. An unavailable primary is degraded because the local
fallback remains available; storage/auth failures remain normal API errors.

Apply generated D1 migration `0005_provider_health.sql` with the existing migration process
before deploying this code. Locally: `npm run db:migrate:local`. No remote migration or
deployment was performed as part of this patch. The shared transport validates the
synthetic completion; it does not replace the separate real tool-calling smoke suite.

## Evaluation baseline

`evals/baseline-p0.json` was generated against the unmodified starting commit using the
same corpus/runner. `npm run eval:ai` compares current checks to that baseline and fails
on a previously passing check becoming false, a removed turn or a removed check.
Corpus: **65 authored scenarios / 131 turns**, five languages, the exact requested television
conversation, 10/20/30-turn conversations, corrections, topic switches, security and abstention
probes. This is a first baseline, not the several-hundred-scenario final target.

| Measured local proxy | Baseline and candidate |
| --- | --- |
| Route classification | 104 / 125 (83.2%) |
| Language detection | 60 / 68 (88.2%) |
| Tool-selection checks | 4 / 5 |
| Implicit case-switch checks | 0 / 2 |
| Specific forbidden-output checks | 4 / 4 |
| Expected API status | 131 / 131 |
| Newly regressed checks | 0 |

The 0/2 case result documents a real P1 gap; it is not hidden by changing expected answers.
Language detection is not response-language consistency. Four negative-output assertions
are not a general safety or hallucination rate. Intent taxonomy, retrieval precision/recall,
semantic groundedness, context retention, token cost and live provider metrics are **null /
unmeasured**, explicitly. The runner uses local deterministic responses and synthetic
SQLite data; local latency percentiles are not production performance numbers.

## Validation and remaining gates

Local results: **228/228 application tests**, **10/10 starter/rendering tests**, typecheck,
full lint and build pass. The app tests include Cloudflare/Miniflare regression tests and
30 additional provider/health/API tests over the starting suite. Build retains the existing
Vinext notice about routes whose static/dynamic classification is unknown.

The first full-lint attempt also traversed the temporary baseline worktree nested under
`outputs/`; that worktree was moved outside the repository and the same full lint passed.
No application lint exception was added.

`npm run ai:probe -- --live` returned **not_run** (exit 2): no configured live provider;
zero external provider calls. To validate in an authorized local configuration:

```bash
node --env-file=.dev.vars scripts/probe-provider.mjs --live
```

The script uses real provider requests but only synthetic D1 cases and the built-in public
procedure fixtures, not customer data or the live Supabase corpus. It checks no-tool,
get_case→final, search_knowledge→final, and multi-turn with positive tokens and no fallback.
It can consume up to four conversation reservations / twelve completion calls and requires
the existing approved spending policy for OpenAI. Repeat for reproducibility, then exercise
the protected health endpoint against the actual deployed settings and verify the live RAG
and real dossier integrations separately.

**P0 remains open** until real-provider reproducibility and deployed synthetic health are
proven. CI status is reported with the PR; local success does not imply remote CI success.
Do not start the P1 orchestrator refactor based on these simulated-provider tests alone.
