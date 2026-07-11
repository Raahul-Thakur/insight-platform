# AI Cost Optimization Implementation Plan

## Current Architecture

- Runtime: TypeScript monorepo using Next.js 15 under `artifacts/startup-intel` for the active UI and API routes. A separate Express artifact exists under `artifacts/api-server`.
- Database: Supabase/Postgres migrations live in the root `supabase/migrations` folder. The schema already includes `startups`, `startup_sources`, `enrichment_jobs`, `uploaded_files`, `crawled_pages`, and `query_cache`.
- Vector support: the initial migration enables `pgvector` and stores local 128-dimensional hash embeddings in `query_cache`.
- CSV import: `artifacts/startup-intel/src/app/api/upload/confirm/route.ts` inserts startup rows, marks CSV-provided fields as manual, and creates pending enrichment jobs for missing core fields.
- Enrichment: `artifacts/startup-intel/src/app/api/jobs/process/route.ts` processes a small number of pending jobs, fetches website text, sends up to 6,000 characters plus startup identifiers to OpenAI, and writes enriched fields back to `startups`.
- Chatbot: `artifacts/startup-intel/src/app/api/chat/query/route.ts` uses deterministic filters and local lexical scoring. `artifacts/api-server/src/routes/llmChat.ts` can send up to 500 startup records to a chat model.
- Tenant isolation: current code uses `org_id` with `DEFAULT_ORG_ID = "default"` and server-side Supabase service-role access. No Supabase RLS policies are present in the existing migration.
- Providers/models: OpenAI is used for enrichment. The Express LLM chat route supports Groq and xAI-compatible OpenAI clients.

## Current Cost Problems

- Enrichment is startup-level instead of field-level, so fresh fields can be reconsidered unnecessarily.
- Website content is cached, but unchanged source content does not prevent extraction.
- The enrichment prompt can include a large general website slice instead of field-relevant passages.
- The stronger model path is not centrally routed or logged.
- The Express LLM chat route sends many startup records directly to a model.
- Chat caching is query-text based and does not include dataset versioning.
- There is no centralized AI usage/cost log.
- Embeddings/search documents are not versioned per startup, making regeneration decisions hard.

## Files Changed

- `supabase/migrations/202607110001_ai_cost_optimization.sql`
- `artifacts/startup-intel/src/server/ai/config.ts`
- `artifacts/startup-intel/src/server/ai/usage.ts`
- `artifacts/startup-intel/src/server/ai/enrichment.ts`
- `artifacts/startup-intel/src/server/ai/chat.ts`
- `artifacts/startup-intel/src/app/api/jobs/process/route.ts`
- `artifacts/startup-intel/src/app/api/chat/query/route.ts`
- `artifacts/api-server/src/routes/llmChat.ts`
- `.env.example`
- `docs/ai-cost-optimization.md`

## Database Migrations Required

- Add field-level enrichment metadata.
- Add source-document hash tracking.
- Add compact startup search documents with vector embeddings.
- Add AI query cache with dataset-version keys.
- Add dataset versions per org.
- Add centralized AI usage logs.
- Add identity/deduplication helper columns to `startups`.
- Add triggers/functions to bump dataset versions after startup and enrichment changes.

## Backward Compatibility

- Existing `startups`, `startup_sources`, `enrichment_jobs`, `crawled_pages`, and `query_cache` tables remain intact.
- Current UI endpoints continue returning the existing fields.
- Enrichment still updates legacy startup columns, but now also records field-level metadata.
- Chat still returns `query`, `parsedFilters`, `startups`, `totalMatched`, `cacheHit`, `provider`, `model`, and `answer`.

## Rollout Order

1. Apply the new Supabase migration.
2. Deploy the helper modules and API route changes.
3. Backfill dataset versions and startup search documents.
4. Run enrichment jobs in small batches.
5. Watch AI usage logs for cache hit rate, records retrieved, records sent to models, and escalation rate.

## Risks and Assumptions

- The app currently uses service-role Supabase access on server routes; tenant isolation depends on server-side `org_id` filters until proper auth/RLS is added.
- The current embedding implementation is local hash-based and 128-dimensional. It is cheap and deterministic but weaker than provider embeddings.
- No test runner is configured for `artifacts/startup-intel`; validation initially relies on TypeScript typechecking.
- Source-content normalization is intentionally lightweight to avoid new dependencies.
