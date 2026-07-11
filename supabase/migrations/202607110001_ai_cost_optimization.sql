CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE startups
  ADD COLUMN IF NOT EXISTS canonical_company_id BIGINT,
  ADD COLUMN IF NOT EXISTS canonical_domain TEXT,
  ADD COLUMN IF NOT EXISTS alternate_names TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS external_provider_ids JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS duplicate_of_startup_id BIGINT REFERENCES startups(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS merge_status TEXT NOT NULL DEFAULT 'active';

UPDATE startups
SET
  canonical_domain = COALESCE(canonical_domain, lower(regexp_replace(COALESCE(domain, website, ''), '^https?://(www\.)?', ''))),
  normalized_name = COALESCE(normalized_name, lower(regexp_replace(name, '[^a-zA-Z0-9 ]', '', 'g')))
WHERE canonical_domain IS NULL OR normalized_name IS NULL;

CREATE INDEX IF NOT EXISTS startups_org_canonical_domain_idx ON startups (org_id, canonical_domain);
CREATE INDEX IF NOT EXISTS startups_org_normalized_name_idx ON startups (org_id, normalized_name);
CREATE INDEX IF NOT EXISTS startups_org_duplicate_idx ON startups (org_id, duplicate_of_startup_id) WHERE duplicate_of_startup_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS startup_field_enrichment (
  id BIGSERIAL PRIMARY KEY,
  org_id TEXT NOT NULL DEFAULT 'default',
  startup_id BIGINT NOT NULL REFERENCES startups(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  field_value_json JSONB,
  source_url TEXT,
  source_type TEXT,
  confidence REAL NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
  status TEXT NOT NULL DEFAULT 'fresh' CHECK (status IN ('missing', 'fresh', 'stale', 'failed', 'manual_review', 'conflict')),
  last_checked_at TIMESTAMPTZ,
  last_changed_at TIMESTAMPTZ,
  refresh_after TIMESTAMPTZ,
  content_hash TEXT,
  model_used TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost NUMERIC(12, 6) NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (startup_id, field_name)
);

CREATE INDEX IF NOT EXISTS startup_field_enrichment_startup_idx ON startup_field_enrichment (startup_id);
CREATE INDEX IF NOT EXISTS startup_field_enrichment_org_field_idx ON startup_field_enrichment (org_id, field_name);
CREATE INDEX IF NOT EXISTS startup_field_enrichment_refresh_idx ON startup_field_enrichment (org_id, refresh_after);
CREATE INDEX IF NOT EXISTS startup_field_enrichment_status_idx ON startup_field_enrichment (org_id, status);
CREATE INDEX IF NOT EXISTS startup_field_enrichment_checked_idx ON startup_field_enrichment (org_id, last_checked_at);

CREATE TABLE IF NOT EXISTS startup_enrichment_sources (
  id BIGSERIAL PRIMARY KEY,
  org_id TEXT NOT NULL DEFAULT 'default',
  startup_id BIGINT NOT NULL REFERENCES startups(id) ON DELETE CASCADE,
  source_url TEXT NOT NULL,
  normalized_url TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'website',
  content_hash TEXT,
  section_hashes_json JSONB NOT NULL DEFAULT '{}',
  last_fetched_at TIMESTAMPTZ,
  last_changed_at TIMESTAMPTZ,
  http_status INTEGER,
  fetch_status TEXT NOT NULL DEFAULT 'pending',
  raw_content_location TEXT,
  normalized_text_location TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (startup_id, normalized_url)
);

CREATE INDEX IF NOT EXISTS startup_enrichment_sources_startup_idx ON startup_enrichment_sources (startup_id);
CREATE INDEX IF NOT EXISTS startup_enrichment_sources_org_url_idx ON startup_enrichment_sources (org_id, normalized_url);
CREATE INDEX IF NOT EXISTS startup_enrichment_sources_hash_idx ON startup_enrichment_sources (org_id, content_hash);
CREATE INDEX IF NOT EXISTS startup_enrichment_sources_fetch_idx ON startup_enrichment_sources (org_id, fetch_status, last_fetched_at);

CREATE TABLE IF NOT EXISTS startup_search_documents (
  id BIGSERIAL PRIMARY KEY,
  org_id TEXT NOT NULL DEFAULT 'default',
  startup_id BIGINT NOT NULL REFERENCES startups(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL DEFAULT 'profile',
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  embedding vector(128) NOT NULL,
  embedding_model TEXT NOT NULL DEFAULT 'local-hash-embedding-v1',
  metadata_json JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (startup_id, document_type)
);

CREATE INDEX IF NOT EXISTS startup_search_documents_startup_idx ON startup_search_documents (startup_id);
CREATE INDEX IF NOT EXISTS startup_search_documents_org_type_idx ON startup_search_documents (org_id, document_type);
CREATE INDEX IF NOT EXISTS startup_search_documents_metadata_idx ON startup_search_documents USING gin (metadata_json);
CREATE INDEX IF NOT EXISTS startup_search_documents_embedding_idx ON startup_search_documents USING ivfflat (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS ai_dataset_versions (
  org_id TEXT PRIMARY KEY,
  version BIGINT NOT NULL DEFAULT 1,
  reason TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO ai_dataset_versions (org_id, version, reason)
SELECT DISTINCT org_id, 1, 'initial'
FROM startups
ON CONFLICT (org_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS ai_query_cache (
  id BIGSERIAL PRIMARY KEY,
  org_id TEXT NOT NULL DEFAULT 'default',
  tenant_id TEXT NOT NULL DEFAULT 'default',
  query_hash TEXT NOT NULL,
  normalized_query TEXT NOT NULL,
  query_embedding vector(128),
  route_type TEXT NOT NULL,
  filters_json JSONB NOT NULL DEFAULT '{}',
  dataset_version BIGINT NOT NULL,
  response_json JSONB NOT NULL,
  source_record_ids BIGINT[] NOT NULL DEFAULT '{}',
  permission_scope TEXT NOT NULL DEFAULT 'default',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_accessed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  hit_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, query_hash, dataset_version, permission_scope)
);

CREATE INDEX IF NOT EXISTS ai_query_cache_hash_idx ON ai_query_cache (query_hash);
CREATE INDEX IF NOT EXISTS ai_query_cache_tenant_version_idx ON ai_query_cache (tenant_id, dataset_version);
CREATE INDEX IF NOT EXISTS ai_query_cache_expires_idx ON ai_query_cache (expires_at);
CREATE INDEX IF NOT EXISTS ai_query_cache_embedding_idx ON ai_query_cache USING ivfflat (query_embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS ai_usage_logs (
  id BIGSERIAL PRIMARY KEY,
  org_id TEXT NOT NULL DEFAULT 'default',
  tenant_id TEXT NOT NULL DEFAULT 'default',
  user_id TEXT,
  feature TEXT NOT NULL,
  route_type TEXT,
  model TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  cached_input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  embedding_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost NUMERIC(12, 6) NOT NULL DEFAULT 0,
  latency_ms INTEGER,
  cache_hit BOOLEAN NOT NULL DEFAULT false,
  records_retrieved INTEGER NOT NULL DEFAULT 0,
  records_sent_to_model INTEGER NOT NULL DEFAULT 0,
  escalated BOOLEAN NOT NULL DEFAULT false,
  escalation_reason TEXT,
  status TEXT NOT NULL DEFAULT 'ok',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_usage_logs_org_created_idx ON ai_usage_logs (org_id, created_at);
CREATE INDEX IF NOT EXISTS ai_usage_logs_feature_model_idx ON ai_usage_logs (org_id, feature, model, created_at);
CREATE INDEX IF NOT EXISTS ai_usage_logs_cache_idx ON ai_usage_logs (org_id, cache_hit, created_at);

CREATE OR REPLACE FUNCTION bump_ai_dataset_version(target_org_id TEXT, change_reason TEXT)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO ai_dataset_versions (org_id, version, reason, updated_at)
  VALUES (target_org_id, 1, change_reason, now())
  ON CONFLICT (org_id)
  DO UPDATE SET
    version = ai_dataset_versions.version + 1,
    reason = EXCLUDED.reason,
    updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION bump_ai_dataset_version_from_startups()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM bump_ai_dataset_version(COALESCE(NEW.org_id, OLD.org_id), TG_TABLE_NAME || ':' || TG_OP);
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS startups_ai_dataset_version_trigger ON startups;
CREATE TRIGGER startups_ai_dataset_version_trigger
AFTER INSERT OR UPDATE OR DELETE ON startups
FOR EACH ROW EXECUTE FUNCTION bump_ai_dataset_version_from_startups();

DROP TRIGGER IF EXISTS startup_field_enrichment_ai_dataset_version_trigger ON startup_field_enrichment;
CREATE TRIGGER startup_field_enrichment_ai_dataset_version_trigger
AFTER INSERT OR UPDATE OR DELETE ON startup_field_enrichment
FOR EACH ROW EXECUTE FUNCTION bump_ai_dataset_version_from_startups();

CREATE OR REPLACE FUNCTION ai_cost_summary(target_org_id TEXT, since_date TIMESTAMPTZ DEFAULT now() - interval '30 days')
RETURNS TABLE (
  feature TEXT,
  model TEXT,
  request_count BIGINT,
  total_estimated_cost NUMERIC,
  cache_hits BIGINT,
  records_sent_to_model BIGINT,
  escalations BIGINT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    feature,
    COALESCE(model, 'none') AS model,
    count(*) AS request_count,
    COALESCE(sum(estimated_cost), 0) AS total_estimated_cost,
    count(*) FILTER (WHERE cache_hit) AS cache_hits,
    COALESCE(sum(records_sent_to_model), 0) AS records_sent_to_model,
    count(*) FILTER (WHERE escalated) AS escalations
  FROM ai_usage_logs
  WHERE org_id = target_org_id
    AND created_at >= since_date
  GROUP BY feature, COALESCE(model, 'none')
  ORDER BY total_estimated_cost DESC;
$$;

CREATE OR REPLACE FUNCTION match_startup_search_documents(
  target_org_id TEXT,
  query_embedding vector(128),
  match_count INTEGER DEFAULT 30,
  filter_country TEXT DEFAULT NULL,
  filter_industry TEXT DEFAULT NULL,
  filter_funding_stage TEXT DEFAULT NULL
)
RETURNS TABLE (
  startup_id BIGINT,
  similarity REAL
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    doc.startup_id,
    (1 - (doc.embedding <=> query_embedding))::REAL AS similarity
  FROM startup_search_documents doc
  WHERE doc.org_id = target_org_id
    AND (filter_country IS NULL OR doc.metadata_json->>'country' ILIKE filter_country)
    AND (filter_industry IS NULL OR doc.metadata_json->>'industry' ILIKE filter_industry)
    AND (filter_funding_stage IS NULL OR doc.metadata_json->>'fundingStage' ILIKE filter_funding_stage)
  ORDER BY doc.embedding <=> query_embedding
  LIMIT LEAST(match_count, 100);
$$;
