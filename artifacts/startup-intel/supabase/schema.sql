CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS startups (
  id BIGSERIAL PRIMARY KEY,
  org_id TEXT NOT NULL DEFAULT 'default',
  name TEXT NOT NULL,
  normalized_name TEXT,
  website TEXT NOT NULL,
  poc_name TEXT,
  poc_email TEXT,
  linkedin_url TEXT,
  crunchbase_url TEXT,
  tracxn_url TEXT,
  domain TEXT,
  subdomain TEXT,
  hq_location TEXT,
  country TEXT,
  funding_stage TEXT,
  total_funding TEXT,
  employee_count INTEGER,
  founders TEXT[] NOT NULL DEFAULT '{}',
  investors TEXT[] NOT NULL DEFAULT '{}',
  description TEXT,
  website_summary TEXT,
  confidence_score REAL,
  last_enriched_at TIMESTAMPTZ,
  manual_fields TEXT[] NOT NULL DEFAULT '{}',
  field_confidence JSONB NOT NULL DEFAULT '{}',
  field_last_verified_at JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, normalized_name)
);

CREATE TABLE IF NOT EXISTS startup_sources (
  id BIGSERIAL PRIMARY KEY,
  startup_id BIGINT NOT NULL REFERENCES startups(id) ON DELETE CASCADE,
  org_id TEXT NOT NULL DEFAULT 'default',
  source_type TEXT NOT NULL,
  source_url TEXT,
  extracted_field TEXT NOT NULL,
  extracted_value TEXT,
  confidence_score REAL,
  last_checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS enrichment_jobs (
  id BIGSERIAL PRIMARY KEY,
  startup_id BIGINT NOT NULL REFERENCES startups(id) ON DELETE CASCADE,
  org_id TEXT NOT NULL DEFAULT 'default',
  job_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS uploaded_files (
  id BIGSERIAL PRIMARY KEY,
  org_id TEXT NOT NULL DEFAULT 'default',
  filename TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0,
  imported_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crawled_pages (
  id BIGSERIAL PRIMARY KEY,
  org_id TEXT NOT NULL DEFAULT 'default',
  url TEXT NOT NULL,
  normalized_url TEXT NOT NULL,
  title TEXT,
  text TEXT NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE (org_id, normalized_url)
);

CREATE TABLE IF NOT EXISTS query_cache (
  id BIGSERIAL PRIMARY KEY,
  org_id TEXT NOT NULL DEFAULT 'default',
  query_text TEXT NOT NULL,
  normalized_query TEXT NOT NULL,
  query_embedding vector(128) NOT NULL,
  parsed_filters JSONB NOT NULL,
  result_startup_ids BIGINT[] NOT NULL DEFAULT '{}',
  similarity_score REAL NOT NULL DEFAULT 1,
  query_type TEXT NOT NULL CHECK (query_type IN ('exact', 'semantic', 'hybrid')),
  confidence_score REAL NOT NULL DEFAULT 0.9,
  source_versions JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS startups_org_domain_idx ON startups (org_id, domain);
CREATE INDEX IF NOT EXISTS startups_org_funding_idx ON startups (org_id, funding_stage);
CREATE INDEX IF NOT EXISTS startups_org_location_idx ON startups (org_id, hq_location);
CREATE INDEX IF NOT EXISTS enrichment_jobs_status_idx ON enrichment_jobs (org_id, status, created_at);
CREATE INDEX IF NOT EXISTS query_cache_embedding_idx ON query_cache USING ivfflat (query_embedding vector_cosine_ops);
