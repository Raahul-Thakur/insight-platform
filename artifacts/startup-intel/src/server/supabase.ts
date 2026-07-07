import { createClient } from "@supabase/supabase-js";

export type StartupRow = {
  id: number;
  org_id: string;
  name: string;
  normalized_name: string | null;
  website: string;
  poc_name: string | null;
  poc_email: string | null;
  linkedin_url: string | null;
  crunchbase_url: string | null;
  tracxn_url: string | null;
  domain: string | null;
  subdomain: string | null;
  hq_location: string | null;
  country: string | null;
  funding_stage: string | null;
  total_funding: string | null;
  employee_count: number | null;
  founders: string[] | null;
  investors: string[] | null;
  description: string | null;
  website_summary: string | null;
  confidence_score: number | null;
  last_enriched_at: string | null;
  manual_fields: string[] | null;
  field_confidence: Record<string, number> | null;
  field_last_verified_at: Record<string, string> | null;
  created_at: string;
  updated_at: string;
};

export type ParsedFilters = {
  domain: string | null;
  fundingStage: string | null;
  location: string | null;
  country: string | null;
  keyword: string | null;
  employeeCountMin: number | null;
  employeeCountMax: number | null;
  investor: string | null;
};

export const DEFAULT_ORG_ID = "default";

export function supabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured.");
  }

  return createClient(url, serviceKey, {
    auth: { persistSession: false },
  });
}

export function toStartup(row: StartupRow) {
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    normalizedName: row.normalized_name,
    website: row.website,
    pocName: row.poc_name,
    pocEmail: row.poc_email,
    linkedinUrl: row.linkedin_url,
    crunchbaseUrl: row.crunchbase_url,
    tracxnUrl: row.tracxn_url,
    domain: row.domain,
    subdomain: row.subdomain,
    hqLocation: row.hq_location,
    country: row.country,
    fundingStage: row.funding_stage,
    totalFunding: row.total_funding,
    employeeCount: row.employee_count,
    founders: row.founders ?? [],
    investors: row.investors ?? [],
    description: row.description,
    websiteSummary: row.website_summary,
    confidenceScore: row.confidence_score,
    lastEnrichedAt: row.last_enriched_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    manualFields: row.manual_fields ?? [],
    fieldConfidence: row.field_confidence ?? {},
    fieldLastVerifiedAt: row.field_last_verified_at ?? {},
    enrichmentStatus: row.last_enriched_at
      ? "enriched"
      : !row.domain || !row.funding_stage || !row.hq_location
        ? "missing"
        : "pending",
  };
}

export function normalizeName(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

export function generateEmbedding(text: string, dims = 128) {
  const vector = Array.from({ length: dims }, () => 0);
  const tokens = text.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 1);
  for (const token of tokens) {
    let hash = 0;
    for (let i = 0; i < token.length; i += 1) {
      hash = (hash << 5) - hash + token.charCodeAt(i);
      hash |= 0;
    }
    vector[Math.abs(hash) % dims] += 1;
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => Number((value / norm).toFixed(6)));
}

export function embeddingSql(vector: number[]) {
  return `[${vector.join(",")}]`;
}

export function json(data: unknown, init?: ResponseInit) {
  return Response.json(data, init);
}

export function errorJson(error: unknown, status = 500) {
  return json({ error: error instanceof Error ? error.message : String(error) }, { status });
}
