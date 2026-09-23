# P1.3 — bounded hybrid multilingual retrieval

## Scope

Base: main `c047541f4566a56fb64e3ced8953e7f6c43f3b9a`, after the production case adapter (#32).

`RAG_MODE=lexical` remains the default. Explicit `hybrid` enables the new path for configured Supabase knowledge. Existing FTS/trigram ranking is reused; the historical corpus, baseline, evaluation expectations and legacy behavior are unchanged.

The pipeline uses the structured understanding's standalone retrieval query (separate from the stored original message), one optional query embedding, one Supabase candidate RPC, metadata verification, reciprocal rank fusion (RRF), deduplication and a relevance gate. The candidate RPC evaluates both channels against one PostgreSQL statement snapshot. There is no LLM reranking or extra completion. Conversation understanding and business authorization stay in their existing layers.

## Model independence and spending

The embedding provider is configured separately from the chat provider. OpenAI, Gemini's native embedding API, OpenAI-compatible endpoints and local Ollama-compatible embeddings are supported. A deployment must select a multilingual model that supports **768 dimensions**, matching the existing pgvector column. Provider support and semantic quality require live verification; API compatibility does not establish model intelligence.

For the September 2026 qualification baseline, use **`gemini-embedding-2`** with explicit 768-dimensional output. It is the stable Gemini embedding generation selected for this rollout. Changing the model or `EMBEDDING_REVISION` changes the embedding-space digest and therefore requires a controlled re-index before hybrid release.

Configuration lives only in server environment variables:

- `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, `EMBEDDING_API_KEY` (a dedicated key; no automatic reuse of a chat key).
- `EMBEDDING_BASE_URL` for compatible/local endpoints. Hosted URLs require HTTPS without embedded credentials; local URLs use the existing loopback-only validation. Redirects are rejected.
- `EMBEDDING_SEND_DIMENSIONS=true` only if the compatible endpoint supports it. OpenAI always receives dimensions=768; Gemini uses its native embedding configuration.
- `EMBEDDING_REVISION` invalidates the embedding space when an operator changes model behavior behind an unchanged model ID.
- `EMBEDDING_DAILY_LIMIT` limits online query requests atomically across workers (default 100, zero blocks the first request).

Existing `LLM_BUDGET_MODE` still applies. Hosted OpenAI/compatible providers require `approved`; Gemini allows `free` or `approved`; local Ollama does not require paid access. `free` is an application permission, not a guarantee about a provider account's billing tier.

Per retrieval: at most one embedding request, 3.5-second HTTP deadline, no automatic retry, then a 2.5-second Supabase HTTP deadline. These deadlines do not prove cancellation of server-side PostgreSQL work. The existing case adapter revalidates access after retrieval. Embedding input tokens are separate from completion tokens; missing usage is **null**, not zero. No query text, key or vector is logged in diagnostics. No result/query cache can serve an archived version.

## Source and permission boundary

The new migration reuses `knowledge_chunks.embedding` and adds its model-space digest and SHA-256 source checksum. Model identity, endpoint, dimension contract and revision are part of the space digest; key rotation is not. Unlabelled pre-existing vectors are excluded. A content update invalidates its vector automatically.

Search filters by the server organization, published status, active series revision, effective dates, configured corpus locale and market (including GLOBAL). Clients cannot choose these filters. Defaults are `RAG_CORPUS_LOCALE=fr-FR` and `RAG_MARKET=GLOBAL`; choose the deployment market explicitly to include regional policies. A French corpus can be searched with queries in other languages using a multilingual model. Source labels remain in their published language until the later grounded-generation phase.

New RPCs are **SECURITY INVOKER**, executable only by `service_role`. Only the required service-role SELECT and embedding-column UPDATE grants are added. No client grant or RLS policy is relaxed. Draft, review, archived, expired, future and foreign-organization documents are excluded before fusion. The application also verifies returned organization, dates, locale, market, content checksum and provenance.

The vector channel excludes a document until all its chunks match the requested space and source checksums. Published lexical knowledge continues to work during bounded indexing. This does not replace the enterprise publication workflow planned for P2.

## Fusion, reranking and abstention

Each channel returns at most eight documents; vector preselection examines at most 32 returned chunk candidates. RRF with k=60 combines **ranks**, not incompatible lexical/cosine scores. Agreement across channels drives ranking; stable IDs break ties. One selected chunk per document is exposed as evidence, with separate lexical/vector supporting chunk IDs so a similarity is never silently attributed to a different chunk.

Qualification baseline relevance gates are lexical score >=3 and cosine similarity >=0.55. The 0.55 vector threshold is a **live-calibration candidate**, not a probability and not a release waiver: all 20 authored FR/EN/DE/ES/AR queries must still satisfy the P1.7 per-query recall/precision contract before any completion-heavy qualification stage is allowed to start. `RAG_MIN_LEXICAL_SCORE` and `RAG_MIN_SIMILARITY` remain bounded server settings.

Absent/weak evidence yields no article. Conflicting revisions in a series fail closed. Obvious instruction-injection markers are quarantined before rendering, with a diagnostic event; this conservative detector is not a complete semantic injection or factual-consistency validator. Retrieved text never becomes understanding-system instructions. Arbitrary contradictions across independent policies still require the subsequent evidence/validator work.

A failed/unconfigured/exhausted embedding service degrades to filtered lexical candidates with a recorded reason. A failed/invalid Supabase response yields unavailable knowledge; hybrid mode never substitutes demonstration text. Diagnostics include channel scores, source/version/chunk/checksum, retrieval duration and embedding provider/calls/tokens/error.

## Bounded indexing and evaluation

Apply `20260920181024_hybrid_knowledge_retrieval.sql` through the deployment's normal migration process before enabling hybrid mode. No remote migration is performed by these scripts.

```bash
# Both commands below are dry runs: no requests or writes.
npm run knowledge:index
npm run eval:rag

# Secrets remain in the ignored .dev.vars. One operator batch; no endless loop.
node --env-file=.dev.vars scripts/index-knowledge.mjs --live --max-chunks 32

# Five independent multilingual retrieval questions; at most five embeddings,
# zero completions. Each compares filtered lexical-only versus hybrid retrieval.
node --env-file=.dev.vars scripts/evaluate-retrieval.mjs --live --max-queries 5
```

Indexing accepts 1–32 chunks per invocation and makes at most one provider batch. Only stale/missing published chunks are selected. After that provider batch, a no-model Supabase readiness read checks whether any stale/missing published chunk remains in the exact embedding space; live P1.7 qualification fails closed if the corpus is still incomplete. Source checksums are checked again in the transactional write RPC; a changed/missing source aborts the whole batch. Repeating indexing skips completed chunks. An explicit operator indexing batch has its own maximum and does not use the online D1 daily bucket. No publication status or business action is changed.

`evals/retrieval.mjs` provides 20 authored questions across FR/EN/DE/ES/AR and four procedures from the repository's seed corpus. The runner records precision@K, recall@K, per-query latency, selected evidence and embedding diagnostics. Deployments with a different corpus need reviewed gold labels. Transport failures are reported as incomplete, not a passing evaluation. Gold labels never enter the provider request.

## Verification and limits

Two pinned **development-only** dependencies, PGlite 0.5.8 and its pgvector extension 0.0.9, execute the SQL in CI. They are absent from application runtime imports. The PostgreSQL fixture reuses the repository's knowledge-table definitions, control-plane columns and FTS/trigram function; it simulates Supabase roles/JWT context, not hosted Auth/PostgREST.

Tests cover schema/HTTP/timeout failures, dimensions, zero vectors, duplicate/missing indices, budget concurrency, source isolation, stale and partial indexing, atomic rollback, locale/market/date/status filtering, RRF provenance, multilingual query preservation and obvious document injection. Cloudflare/workerd also exercises the authenticated production chat through both the completion and embedding HTTP transports with real D1 persistence.

A first hosted preproduction run on 2026-09-23 successfully indexed the complete published corpus into the `gemini-embedding-2` 768-dimensional space. The qualification workflow now runs the 20-query live retrieval gate immediately after corpus readiness and stops before completion-heavy evaluation if any multilingual retrieval row misses the governed contract. CI still uses synthetic provider responses and vectors; only the explicit manual live gate measures hosted semantic recall.

Before activation, run hosted migrations/advisors, inspect query plans on representative tenant sizes, verify ANN recall under tenant/model filters, calibrate thresholds using reviewed relevance labels, and measure p50/p95/p99 and token costs. The existing HNSW index is reused where PostgreSQL chooses it; a small fixture cannot demonstrate enterprise-scale throughput. Rollback is `RAG_MODE=lexical`, without destructive schema changes.

Primary API references checked for this implementation: [Supabase hybrid search](https://supabase.com/docs/guides/ai/hybrid-search), [RAG permissions](https://supabase.com/docs/guides/ai/rag-with-permissions), [OpenAI embeddings](https://developers.openai.com/api/reference/resources/embeddings/methods/create), [Gemini embeddings](https://ai.google.dev/api/embeddings), [PGlite extensions](https://pglite.dev/extensions/).
