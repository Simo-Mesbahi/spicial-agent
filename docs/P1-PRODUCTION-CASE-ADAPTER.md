# P1.2 — authenticated production case conversations

Follow-up: [P1.3 hybrid retrieval](P1-HYBRID-RETRIEVAL.md) adds a separate retrieval gate; production authorization remains unchanged.

Base: PR #31, main `559150024bbedb87c702a688f15a262cb2a06813`.

## Boundary and request path

The existing `/file` and `/suivi` verification flow now supports the structured assistant behind `LLM_ORCHESTRATOR=structured`. The default remains legacy. `GET /api/production/config` exposes the rollout flag; no key or provider internals are exposed in the page.

Successful reference/code verification binds a SHA-256 digest of the opaque case cookie to the server-configured organization, the returned case ID and a distinct conversation space. The binding expires within 30 minutes and never after the source session. No raw case access token is stored in D1 or sent to the LLM. A new verification creates a separate conversation, even for the same case.

`GET /api/production/chat` revalidates the Supabase cookie and returns bounded history plus a session CSRF token. `POST` accepts only message and idempotency ID, checks same origin and CSRF, and uses the existing bounded understanding, planner and conversation lease. Only the verified case is an authorized candidate. Another case requires another reference/code verification.

The server adapter calls only `customer_case_snapshot`, through the existing privileged server transport. It verifies the pinned case ID, source expiry and response schema. It rereads after understanding/retrieval, including for social replies and provider fallbacks. Revocation or expiry during an upstream call prevents the response from being released or persisted. No generic database access is exposed to the LLM; no Supabase function, grant, RLS policy or production migration is changed.

The adapter never creates a demonstration case or substitutes demo knowledge. Conversation state stores bounded dialogue context, not authoritative business facts. Redacted messages and reply metadata are stored as session history; these may contain the verified facts shown to that customer. Each new reply rereads Supabase instead of treating history as current truth. Logout revokes the Supabase session and cascades deletion of the corresponding D1 conversation. Expired spaces are inaccessible and are removed by the existing session cleanup; a scheduled retention sweep remains an operational follow-up for deployments without new session traffic.

## Facts and rendering

The engine accepts a generic server-owned case type instead of coercing production data into the demo model. Production facts preserve currency, nullable monetary amounts, source version and update timestamp. `estimated_at` remains an estimate; it is never promoted to a confirmed ETA. Dates/currencies are validated before rendering. Descriptions, SKU and event details are excluded from the understanding request.

Business replies remain conservatively rendered in five languages during this increment. Recorded product/warranty labels are displayed as source data. Natural grounded business generation and its evidence validator are subsequent P1 steps. Social drafting already uses the structured model from #31. Existing security and immediate-danger guards are shared without adding phrase-by-phrase intent routing.

Handoff remains an invitation to use the existing contact flow; no email, refund, case transition or handoff submission is performed by this chat. Case-switch requests expose the secure verification action.

## Cost, consistency and observability

- One understanding completion per normal turn, no extra drafting completion, no paid call for critical local guards.
- Existing provider timeout/token limits and deployment-wide daily quota apply. A zero quota rejects the first call too.
- A completed idempotent retry revalidates authorization and replays its original response without another completion. Reused IDs with a different message are rejected.
- A session lease rejects overlapping requests before another completion. State, both messages and cached reply are committed in one D1 transaction.
- Provider failures use a freshly verified production response and retain the normalized reason, measured calls, token usage/completeness and latency. Upstream bodies are not returned or logged.
- `atlas.ai.interaction` records success, fallback, safety guard or failure, hashed session identity and provider diagnostics. Source version is associated with business replies.

## Validation and deployment gate

Local validation: typecheck, lint, 305 application tests, 10 rendered/component tests, unchanged historical evaluation and production build. D1 migration `0007_production_case_binding.sql` was applied locally. The app suite includes actual Cloudflare/workerd execution with mocked remote HTTP services and transactional D1 storage.

Targeted coverage: fresh status/version after model latency, currencies, nullable amounts, unconfirmed estimates, organization/case isolation, distinct sessions, replay, overlapping messages, strict body/origin/CSRF, zero budget, invalid provider schema, upstream 429, mid-call revocation, source expiry, logout deletion, multi-turn preferences, unresolved case switching and local safety guards.

Historical evaluation: 307 scenarios / 1,116 turns, no regressions or required failures, 439 pre-existing known gaps. Targets, corpus and thresholds are unchanged. This result does not establish a live intelligence improvement.

Before enabling the flag in any deployment:

1. Apply all existing D1 migrations, including 0006 and 0007, through that environment's normal migration process. No remote migration was performed here.
2. Verify a real Supabase case in that environment, including denial, expiry and logout behavior.
3. Run the provider smoke test and bounded independent multilingual evaluation with secrets in the ignored `.dev.vars`, never in chat or Git. Reuse the commands in `P1-CONVERSATION-FOUNDATION.md`.
4. Validate actual model support, naturalness, grounding, latency, tokens and budget before setting `LLM_ORCHESTRATOR=structured`.

No configured live provider or Supabase credentials were available for this increment. All remote requests in automated tests use synthetic services; no paid API call was made. Rollback uses `LLM_ORCHESTRATOR=legacy`, preserving existing dossier tracking and migrations.
