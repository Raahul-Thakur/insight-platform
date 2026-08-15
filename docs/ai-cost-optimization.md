# AI Cost Optimization

> Historical optimization notes. The current factual-first implementation and live validation report are in [factual-enrichment-architecture.md](./factual-enrichment-architecture.md).

## Final Architecture

The database remains the source of truth. CSV imports write structured startup fields to `startups`, enrichment writes field-level metadata to `startup_field_enrichment`, and chatbot retrieval returns database records before any model is considered. The LLM is never given the full startup table.

## Data Flow

1. CSV import inserts startup rows and creates enrichment jobs for incomplete records.
2. Job processing fetches source content, normalizes it, hashes meaningful sections, and checks which fields are actually due.
3. If no field is due, the job skips the model call.
4. If fields are due, only relevant passages are sent to the extraction model.
5. Extracted fields update legacy startup columns and field-level metadata.
6. Compact startup search documents are regenerated only when their content hash changes.
7. Chat queries are routed to direct lookup, structured SQL-style filters, aggregate count, semantic search, or hybrid search.
8. Exact cache keys include tenant, normalized query, filters, route, permission scope, and dataset version.

## Enrichment Refresh Policy

Refresh policy lives in `artifacts/startup-intel/src/server/ai/config.ts`.

- Immutable unless missing: `name`.
- Slow-changing: location and country refresh yearly.
- Medium-changing: website, domain, founders, and profile links refresh every 180 days.
- Fast-changing: funding and investors refresh monthly or quarterly.
- Source-change driven: description and website summary refresh only when meaningful source content changes.

## Source Hashing

Source HTML is stripped of scripts, styles, navigation, footer text, cookie boilerplate, trivial copyright years, tags, and repeated whitespace. The normalized text receives a SHA-256 hash. Meaningful sections such as about, team, funding, product, and careers receive separate hashes in `startup_enrichment_sources.section_hashes_json`.

## Model Routing

Small models are used first for extraction. The escalation model is used only when extraction is empty or low-confidence. Model names and pricing are centralized in `server/ai/config.ts`.

## SQL Retrieval

Structured chatbot questions are answered with Supabase query-builder filters against approved startup columns. Aggregate count and missing-field questions return direct responses without an answer LLM.

## Semantic And Hybrid Retrieval

Semantic and hybrid retrieval use compact startup text and local hash embeddings/scoring. Structured filters are applied first, then semantic ranking is performed within that reduced result set. Defaults limit retrieval to about 30 records and model evidence to 10 records.

## Cache Behavior

`ai_query_cache` stores route-aware cached responses. Cache keys include tenant, query hash, normalized filters, route type, permission scope, and dataset version. Dataset version changes invalidate old cache entries naturally without deleting them.

## Dataset Versioning

`ai_dataset_versions` stores one version per `org_id`. Triggers bump the version when `startups` or `startup_field_enrichment` changes.

## Conversation Memory

The helper in `server/ai/chat.ts` supports bounded memory as recent messages plus a compact summary hash and structured state. Current retrieval endpoints do not replay unlimited history.

## Environment Variables

- `OPENAI_EXTRACTION_MODEL`
- `OPENAI_ESCALATION_MODEL`
- `OPENAI_ROUTER_MODEL`
- `OPENAI_ANSWER_MODEL`
- `EMBEDDING_MODEL`
- `ENRICHMENT_BATCH_SIZE`
- `AI_MAX_SOURCE_CHARS`
- `AI_MAX_PASSAGE_CHARS`
- `AI_MAX_RETRIEVED_STARTUPS`
- `AI_MAX_STARTUPS_SENT_TO_MODEL`
- `AI_RECENT_MESSAGES`

Existing variables such as `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `GROQ_API_KEY`, and profile API keys are unchanged.

## Migration Instructions

Apply migrations from the root Supabase folder:

```bash
supabase db push
```

## Backfill Instructions

- Enrichment metadata: run `/api/jobs/process` with small limits until pending jobs complete.
- Content hashes: enrichment fetches and upserts `startup_enrichment_sources` as jobs run.
- Search documents and embeddings: enrichment upserts `startup_search_documents` after applying field updates.
- Dataset versions: the migration seeds `ai_dataset_versions` from existing startup orgs.

## Rollback

The migration is additive. To roll back the application behavior, deploy the previous route code. The new tables can remain unused. Dropping them should only be done after confirming no newer deployment depends on them.

## Monitoring Metrics

Use `ai_usage_logs` and `ai_cost_summary(org_id, since_date)` for daily/monthly cost, cost by feature/model, cache hit rate, records sent to models, and escalation counts.

## Known Limitations

- The current app still uses a default org and service-role server access. Full user/tenant auth and RLS policies should be added before exposing multi-tenant production data.
- Semantic retrieval currently uses deterministic local embeddings/scoring. Provider embeddings can be swapped in behind the same search-document table if higher recall is needed.
- The repository has no dedicated test runner configured for the Next app, so validation currently relies on TypeScript typechecking.
