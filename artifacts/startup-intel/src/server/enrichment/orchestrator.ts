import {
  canonicalWebsite,
  crawlCompanyWebsite,
  extractFacts,
  normalizeDomain,
  normalizeUrl,
  reconcileFacts,
  type CachedPage,
  type Confidence,
  type Evidence,
  type PageCache,
} from "@workspace/enrichment-core";
import { DEFAULT_ORG_ID } from "@/server/supabase";
import { ENRICHMENT_REFRESH_POLICY } from "@/server/ai/config";

const FIELD_MAP: Record<string, string> = {
  name: "name",
  website: "website",
  description: "description",
  hqLocation: "hq_location",
  country: "country",
  employeeCount: "employee_count",
  founders: "founders",
  linkedinUrl: "linkedin_url",
  crunchbaseUrl: "crunchbase_url",
  tracxnUrl: "tracxn_url",
};

export type FactualEnrichmentResult = {
  updates: Record<string, unknown>;
  evidence: Evidence[];
  fieldRows: Record<string, unknown>[];
  sourceRows: Record<string, unknown>[];
  conflicts: Array<{ field: string; values: unknown[] }>;
  pages: number;
  cacheHits: number;
  fetches: number;
  failures: number;
  bytesDownloaded: number;
  durationMs: number;
  fieldsWithoutAi: number;
  errors: Array<{ url: string; message: string }>;
};

export async function enrichFactualStartup(db: any, startup: any): Promise<FactualEnrichmentResult> {
  const started = Date.now();
  const website = canonicalWebsite(startup.canonical_domain ?? startup.website);
  const empty = (): FactualEnrichmentResult => ({
    updates: {}, evidence: [], fieldRows: [], sourceRows: [], conflicts: [], pages: 0, cacheHits: 0,
    fetches: 0, failures: website ? 1 : 0, bytesDownloaded: 0, durationMs: Date.now() - started,
    fieldsWithoutAi: 0, errors: website ? [] : [{ url: "", message: "No resolvable company domain" }],
  });
  if (!website) return empty();

  const cache = createSupabasePageCache(db, startup);
  let crawl;
  try {
    crawl = await crawlCompanyWebsite(website, cache);
  } catch (error) {
    const result = empty();
    result.errors = [{ url: website, message: error instanceof Error ? error.message : String(error) }];
    return result;
  }
  const extracted = extractFacts(crawl.pages);
  const reconciled = reconcileFacts(extracted, startup.manual_fields ?? []);
  const updates: Record<string, unknown> = {
    canonical_domain: normalizeDomain(website),
    last_enriched_at: new Date().toISOString(),
  };
  const fieldConfidence = { ...(startup.field_confidence ?? {}) };
  const fieldLastVerifiedAt = { ...(startup.field_last_verified_at ?? {}) };
  const manual = new Set((startup.manual_fields ?? []).flatMap((field: string) => [field, toSnake(field)]));

  for (const item of reconciled.selected) {
    const column = FIELD_MAP[item.field];
    if (!column || manual.has(column) || manual.has(item.field)) continue;
    const current = startup[column];
    const confidence = numericConfidence(item.confidence);
    if (isEmpty(current) || confidence > Number(fieldConfidence[column] ?? 0)) {
      updates[column] = item.value;
      fieldConfidence[column] = confidence;
      fieldLastVerifiedAt[column] = item.retrievedAt;
    }
  }
  updates.field_confidence = fieldConfidence;
  updates.field_last_verified_at = fieldLastVerifiedAt;
  const confidenceValues = reconciled.selected.map((item) => numericConfidence(item.confidence));
  if (confidenceValues.length) updates.confidence_score = Math.max(startup.confidence_score ?? 0, Math.min(...confidenceValues));

  const fieldRows = reconciled.selected.map((item) => ({
    org_id: startup.org_id ?? DEFAULT_ORG_ID,
    startup_id: startup.id,
    field_name: FIELD_MAP[item.field] ?? item.field,
    field_value_json: item.value,
    source_url: item.sourceUrl,
    source_type: item.sourceType,
    confidence: numericConfidence(item.confidence),
    status: item.confidence === "LOW" ? "manual_review" : "fresh",
    last_checked_at: item.retrievedAt,
    last_changed_at: item.retrievedAt,
    refresh_after: nextRefresh(FIELD_MAP[item.field] ?? item.field),
    content_hash: crawl.pages.find((page) => page.url === item.sourceUrl)?.contentHash ?? null,
    extraction_method: item.method,
    observation_type: item.observed ? "observed" : "inferred",
    model_used: null,
    input_tokens: 0,
    output_tokens: 0,
    estimated_cost: 0,
  }));
  const sourceRows = reconciled.selected.map((item) => ({
    org_id: startup.org_id ?? DEFAULT_ORG_ID,
    startup_id: startup.id,
    source_type: `${item.sourceType}:${item.method}`,
    source_url: item.sourceUrl,
    extracted_field: FIELD_MAP[item.field] ?? item.field,
    extracted_value: JSON.stringify(item.value),
    confidence_score: numericConfidence(item.confidence),
    last_checked_at: item.retrievedAt,
  }));
  return {
    updates,
    evidence: reconciled.selected,
    fieldRows,
    sourceRows,
    conflicts: reconciled.conflicts,
    pages: crawl.pages.length,
    cacheHits: crawl.telemetry.pagesFromCache,
    fetches: crawl.telemetry.pagesFetched,
    failures: crawl.telemetry.fetchFailures,
    bytesDownloaded: crawl.telemetry.bytesDownloaded,
    durationMs: Date.now() - started,
    fieldsWithoutAi: reconciled.selected.length,
    errors: crawl.errors,
  };
}

function createSupabasePageCache(db: any, startup: any): PageCache {
  return {
    async get(url: string) {
      const normalized = normalizeUrl(url);
      const response = await db.from("startup_enrichment_sources")
        .select("source_url,last_fetched_at,content_hash,metadata_json")
        .eq("startup_id", startup.id).eq("normalized_url", normalized).maybeSingle();
      const metadata = response.data?.metadata_json;
      if (!metadata?.parsedPage || !response.data?.last_fetched_at) return null;
      return {
        url: response.data.source_url,
        fetchedAt: response.data.last_fetched_at,
        expiresAt: metadata.expiresAt ?? response.data.last_fetched_at,
        etag: metadata.etag ?? null,
        lastModified: metadata.lastModified ?? null,
        parsed: metadata.parsedPage,
      } as CachedPage;
    },
    async set(entry: CachedPage) {
      const previous = await db.from("startup_enrichment_sources").select("content_hash")
        .eq("startup_id", startup.id).eq("normalized_url", normalizeUrl(entry.url)).maybeSingle();
      const changed = previous.data?.content_hash !== entry.parsed.contentHash;
      const result = await db.from("startup_enrichment_sources").upsert({
        org_id: startup.org_id ?? DEFAULT_ORG_ID,
        startup_id: startup.id,
        source_url: entry.url,
        normalized_url: normalizeUrl(entry.url),
        source_type: "official_website",
        content_hash: entry.parsed.contentHash,
        section_hashes_json: {},
        last_fetched_at: entry.fetchedAt,
        last_changed_at: changed ? entry.fetchedAt : undefined,
        http_status: 200,
        fetch_status: changed ? "fetched" : "unchanged",
        metadata_json: { expiresAt: entry.expiresAt, etag: entry.etag, lastModified: entry.lastModified, parsedPage: entry.parsed },
      }, { onConflict: "startup_id,normalized_url" });
      if (result.error) throw result.error;
    },
  };
}

function nextRefresh(field: string) {
  const policy = ENRICHMENT_REFRESH_POLICY[field];
  if (policy == null || policy === "on_source_change") return null;
  return new Date(Date.now() + policy * 24 * 60 * 60 * 1000).toISOString();
}
function numericConfidence(value: Confidence) { return value === "HIGH" ? 0.95 : value === "MEDIUM" ? 0.7 : 0.4; }
function isEmpty(value: unknown) { return value == null || value === "" || (Array.isArray(value) && !value.length); }
function toSnake(value: string) { return value.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`); }
