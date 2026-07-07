# Supabase SQL Workspace

Use this folder as the source of truth for database SQL.

## Recommended Order

1. Open your Supabase project.
2. Go to **SQL Editor**.
3. Run the files in `migrations/` in timestamp order.
4. Save one-off/manual SQL in `queries/`.

## Current Migration

- `migrations/202607070001_initial_schema.sql`

This creates the tables needed by the Next.js app:

- `startups`
- `startup_sources`
- `enrichment_jobs`
- `uploaded_files`
- `crawled_pages`
- `query_cache`

It also enables `pgvector` with:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

## Notes

- Do not put API keys or secrets in SQL files.
- For production changes, add a new timestamped file in `migrations/` instead of editing an already-run migration.
- Use `queries/` for saved inspection, cleanup, or debugging SQL.
