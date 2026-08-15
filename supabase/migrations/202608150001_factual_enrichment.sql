ALTER TABLE startup_field_enrichment
  ADD COLUMN IF NOT EXISTS extraction_method TEXT,
  ADD COLUMN IF NOT EXISTS observation_type TEXT NOT NULL DEFAULT 'observed'
    CHECK (observation_type IN ('observed', 'inferred'));

UPDATE startups
SET canonical_domain = NULLIF(lower(split_part(regexp_replace(COALESCE(website, ''), '^https?://(www\.)?', '', 'i'), '/', 1)), 'unknown.com')
WHERE canonical_domain IS NULL;

WITH ranked AS (
  SELECT id, first_value(id) OVER (PARTITION BY org_id, canonical_domain ORDER BY created_at, id) AS keeper_id,
    row_number() OVER (PARTITION BY org_id, canonical_domain ORDER BY created_at, id) AS duplicate_rank
  FROM startups
  WHERE canonical_domain IS NOT NULL AND duplicate_of_startup_id IS NULL
)
UPDATE startups AS startup
SET duplicate_of_startup_id = ranked.keeper_id, merge_status = 'duplicate'
FROM ranked
WHERE startup.id = ranked.id AND ranked.duplicate_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS startups_org_canonical_domain_unique_idx
  ON startups (org_id, canonical_domain)
  WHERE canonical_domain IS NOT NULL AND duplicate_of_startup_id IS NULL;

CREATE TABLE IF NOT EXISTS enrichment_runs (
  id BIGSERIAL PRIMARY KEY,
  org_id TEXT NOT NULL DEFAULT 'default',
  startup_id BIGINT NOT NULL REFERENCES startups(id) ON DELETE CASCADE,
  enrichment_job_id BIGINT REFERENCES enrichment_jobs(id) ON DELETE SET NULL,
  level TEXT NOT NULL CHECK (level IN ('identity', 'standard', 'intelligence')),
  status TEXT NOT NULL CHECK (status IN ('completed', 'partial', 'failed')),
  pages_fetched INTEGER NOT NULL DEFAULT 0,
  pages_from_cache INTEGER NOT NULL DEFAULT 0,
  fetch_failures INTEGER NOT NULL DEFAULT 0,
  bytes_downloaded BIGINT NOT NULL DEFAULT 0,
  fields_extracted INTEGER NOT NULL DEFAULT 0,
  fields_extracted_without_ai INTEGER NOT NULL DEFAULT 0,
  llm_calls INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_ai_cost NUMERIC(12, 6) NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  metadata_json JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS enrichment_runs_org_created_idx ON enrichment_runs (org_id, created_at);
CREATE INDEX IF NOT EXISTS enrichment_runs_startup_idx ON enrichment_runs (startup_id, created_at);

CREATE OR REPLACE FUNCTION enrichment_cost_kpis(target_org_id TEXT, since_date TIMESTAMPTZ DEFAULT now() - interval '30 days')
RETURNS TABLE (total_companies BIGINT, llm_free_enrichment_rate NUMERIC, field_level_llm_rate NUMERIC, average_llm_cost_per_company NUMERIC)
LANGUAGE sql STABLE AS $$
  SELECT count(*)::BIGINT,
    COALESCE(avg(CASE WHEN llm_calls = 0 THEN 1 ELSE 0 END), 0)::NUMERIC,
    COALESCE(sum(fields_extracted - fields_extracted_without_ai)::NUMERIC / NULLIF(sum(fields_extracted), 0), 0),
    COALESCE(avg(estimated_ai_cost), 0)::NUMERIC
  FROM enrichment_runs WHERE org_id = target_org_id AND created_at >= since_date;
$$;
