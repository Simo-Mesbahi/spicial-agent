# P1.4 — request-scoped server evidence

Base: main `e28139e1e4950cec7d2713c3661fddfba424706e` (hybrid retrieval, #33).

## Purpose and boundary

The production structured conversation now assembles and validates a strict, versioned Evidence Pack **before rendering**. It is built from the authorized case adapter and published knowledge results, not from conversation state, the user prompt or model-authored business claims. No additional provider call, database request, dependency or migration is introduced.

This increment prepares controlled natural generation. It does not enable free-form business generation or claim a complete semantic fact validator. Existing deterministic business rendering, social-answer guard, safety handling, default rollout flags and benchmarks remain intact. The legacy/demo engine does not acquire production evidence authority.

## Contract

`lib/atlas/evidence-pack.ts` exports the strict Zod schema, builder, scope/expiry assertion and text-free diagnostics summary.

- Scope: organization, authorized case and server-generated request ID. These originate from the authenticated server adapter. The pack is not an authorization grant and must never be accepted from a client as one.
- Freshness: maximum 30 seconds, shortened by the current session expiry and the case/document retrieval age. Future retrieval timestamps and stale facts are rejected. An old business update is allowed if freshly read: retrieval freshness is distinct from the date of the last business event.
- Facts: exact status, product, warranty information, amounts in integer cents with currency, case version and timestamps. An estimate never becomes a confirmed ETA. The current backend has no confirmed ETA field, so `confirmedEta` must be null.
- Unknowns: explicit absence of an ETA, estimate, product, quote, refund, warranty label or usable knowledge. Zero cents remains a known value. A field omitted because no case read was required is distinguished from a field read and found absent.
- Documents: at most three chunks of at most 4,000 characters, each with document/chunk/version, content checksum, locale, market, effective dates and score. All retrieved candidates are checked before selection. Missing provenance, mismatched versions, duplicate sources, altered content, invalid dates and out-of-scope data fail closed.
- Actions: only opening the existing contact UI can be offered. `completedActions` is always empty. No handoff, email, refund or quote acceptance is asserted to have occurred.
- Text trust: product names, warranty labels and documentary text remain untrusted data. `dataPolicy` records this boundary; it is not a claim that a label neutralizes every prompt injection. Future generation must keep these values out of system instructions and pass its own factual/safety gates.

The pack is parsed into a detached snapshot and frozen recursively. Scope and expiry are checked again before response persistence. Any validation error aborts the response with a neutral client message, a normalized internal error code, and cleanup of the request/lease; an invalid pack is never displayed or stored as a successful answer.

## Integration and privacy

Both lexical and hybrid retrieval now attach a server-owned organization/retrieval context, chunk checksum and effective dates. Existing Supabase RPC publication/version filters remain authoritative. Lexical mode retains its existing `fr-FR` / unrestricted-market query contract; hybrid mode retains explicit deployment locale/market filters. No RLS, access grant or database policy changes.

The generic structured executor accepts a production evidence-building dependency after tools and before rendering. Displayed sources must match the validated pack. Production fallbacks also obtain fresh verified case evidence; safety and casual replies do not unnecessarily add case facts to their packs. Existing access checks and atomic conversation persistence remain in place.

The full pack is ephemeral: no copies in conversation state, history, client JSON or logs. Only a bounded diagnostic summary (schema version, case version, knowledge state, source count, unknown-field codes and action counts) is emitted. No source text, amounts, product names, session tokens or keys are added to telemetry. Existing response history still contains the customer-visible answers, as before.

## Enterprise configuration

The organization boundary is part of the contract from the outset, so future company-specific generation settings can be applied within the same verified scope. This does not implement shared multi-tenant routing, tenant credentials, company persona settings or their admin editor. The current runtime continues to use the deployment's configured organization. Security rules and case authorization are not editable business preferences.

## Verification and remaining work

Unit tests exercise five response languages, scope/request mismatch, stale or future evidence, session expiry, missing checksums, tampered text, version/locale/market/date mismatches, bounds, frozen snapshots and non-executable actions. API tests verify rejected evidence never enters history and run ten turns with changing backend versions and alternating social/business requests. Existing Cloudflare/workerd integration covers the hybrid evidence path and request replay without additional provider spend.

Validation uses mocks, synthetic customer records and the repository's existing PostgreSQL/pgvector fixture; it does not demonstrate live model intelligence or hosted Supabase behavior. No remote deployment, database migration, paid provider test or mode activation is performed.

Next increments: consume this contract in natural business generation; enforce factual consistency before release; revalidate authorization/freshness after any new generation latency; measure live conversations against the independent baseline. Do not extend evidence TTL or cache case truth to mask slow generation. HTTP idempotency still replays an already completed response after access validation; a replay is historical output, not a refreshed business lookup.
