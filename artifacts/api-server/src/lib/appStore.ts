import fs from "fs";
import path from "path";

export type AppStartup = {
  id: number;
  orgId: string;
  name: string;
  normalizedName: string | null;
  website: string;
  pocName: string | null;
  pocEmail: string | null;
  linkedinUrl: string | null;
  crunchbaseUrl: string | null;
  tracxnUrl: string | null;
  domain: string | null;
  subdomain: string | null;
  hqLocation: string | null;
  country: string | null;
  fundingStage: string | null;
  totalFunding: string | null;
  employeeCount: number | null;
  founders: string[];
  investors: string[];
  description: string | null;
  websiteSummary: string | null;
  confidenceScore: number | null;
  lastEnrichedAt: string | null;
  createdAt: string;
  updatedAt: string;
  manualFields: string[];
  fieldConfidence: Record<string, number>;
  fieldLastVerifiedAt: Record<string, string>;
};

export type AppStartupSource = {
  id: number;
  startupId: number;
  orgId: string;
  sourceType: string;
  sourceUrl: string | null;
  extractedField: string;
  extractedValue: string | null;
  confidenceScore: number | null;
  lastCheckedAt: string | null;
};

export type AppEnrichmentJob = {
  id: number;
  startupId: number;
  orgId: string;
  jobType: string;
  status: "pending" | "running" | "completed" | "failed";
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type AppUploadedFile = {
  id: number;
  orgId: string;
  filename: string;
  originalFilename: string;
  rowCount: number;
  importedCount: number;
  status: string;
  uploadedAt: string;
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

export type QueryCacheEntry = {
  id: number;
  orgId: string;
  queryText: string;
  normalizedQuery: string;
  queryEmbedding: number[];
  parsedFilters: ParsedFilters;
  resultStartupIds: number[];
  resultCount: number;
  similarityScore: number;
  queryType: "exact" | "semantic" | "hybrid";
  confidenceScore: number;
  sourceVersions: Record<string, string>;
  createdAt: string;
  expiresAt: string | null;
};

type CrawlPageCacheEntry = {
  id: number;
  orgId: string;
  url: string;
  normalizedUrl: string;
  title: string | null;
  text: string;
  fetchedAt: string;
  expiresAt: string;
};

type ExtractedFactCacheEntry = {
  id: number;
  orgId: string;
  startupId: number;
  sourceUrl: string | null;
  extractedField: string;
  extractedValue: string | null;
  confidenceScore: number;
  createdAt: string;
  expiresAt: string;
};

type EmbeddingCacheEntry = {
  id: number;
  orgId: string;
  ownerType: "startup" | "query" | "crawl_page" | "fact";
  ownerId: number | string;
  textHash: string;
  embedding: number[];
  model: string;
  createdAt: string;
  expiresAt: string;
};

type StoreState = {
  nextStartupId: number;
  nextSourceId: number;
  nextJobId: number;
  nextUploadId: number;
  nextQueryId: number;
  nextCrawlPageId: number;
  nextFactId: number;
  nextEmbeddingId: number;
  startups: AppStartup[];
  sources: AppStartupSource[];
  jobs: AppEnrichmentJob[];
  uploads: AppUploadedFile[];
  queryCache: QueryCacheEntry[];
  crawlPageCache: CrawlPageCacheEntry[];
  extractedFactCache: ExtractedFactCacheEntry[];
  embeddingCache: EmbeddingCacheEntry[];
};

const DEFAULT_ORG_ID = "default";
const VECTOR_DIMS = 128;
const EMBEDDING_MODEL = "local-hash-embedding-v1";
const QUERY_CACHE_DAYS = 30;
const RESULT_CACHE_DAYS = 7;
const FUNDING_CACHE_DAYS = 30;
const WEBSITE_CACHE_DAYS = 90;
const FACT_CACHE_DAYS = 30;
const HIGH_SIMILARITY = 0.92;

const workspaceRoot = process.cwd().endsWith(path.join("artifacts", "api-server"))
  ? path.resolve(process.cwd(), "../..")
  : process.cwd();
const dataDir = path.resolve(workspaceRoot, "artifacts/api-server/data");
const storePath = path.resolve(dataDir, "app-store.json");

let state = loadState();

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function getStartupStatus(startup: AppStartup) {
  if (startup.lastEnrichedAt) return "enriched";
  if (!startup.domain || !startup.fundingStage || !startup.hqLocation) return "missing";
  return "pending";
}

export function serializeStartup(startup: AppStartup) {
  return {
    ...startup,
    enrichmentStatus: getStartupStatus(startup),
  };
}

export function listStartups(options: {
  page: number;
  limit: number;
  domain?: string;
  fundingStage?: string;
  location?: string;
  country?: string;
  keyword?: string;
  enrichmentStatus?: string;
  sortBy?: string;
  sortDir?: "asc" | "desc";
  orgId?: string;
}) {
  const orgId = options.orgId ?? DEFAULT_ORG_ID;
  const filtered = filterStartups(
    state.startups.filter((startup) => startup.orgId === orgId),
    options,
  );
  const sorted = sortStartups(filtered, options.sortBy, options.sortDir);
  const start = (options.page - 1) * options.limit;
  return {
    startups: sorted.slice(start, start + options.limit).map(serializeStartup),
    total: sorted.length,
    page: options.page,
    limit: options.limit,
  };
}

export function getStartup(id: number) {
  return state.startups.find((startup) => startup.id === id);
}

export function getStartupDetail(id: number) {
  const startup = getStartup(id);
  if (!startup) return null;

  return {
    ...serializeStartup(startup),
    sources: state.sources
      .filter((source) => source.startupId === id)
      .sort((a, b) => (b.lastCheckedAt ?? "").localeCompare(a.lastCheckedAt ?? "")),
    enrichmentJobs: state.jobs
      .filter((job) => job.startupId === id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 20)
      .map((job) => ({
        ...job,
        startupName: startup.name,
      })),
  };
}

export function createStartup(input: Partial<AppStartup> & Pick<AppStartup, "name" | "website">) {
  const now = new Date().toISOString();
  const manualFields = new Set(input.manualFields ?? []);
  const markManual = (field: keyof AppStartup, value: unknown) => {
    if (value !== null && value !== undefined && value !== "" && !Array.isArray(value)) {
      manualFields.add(String(field));
    }
  };

  markManual("name", input.name);
  markManual("website", input.website);
  markManual("pocName", input.pocName);
  markManual("pocEmail", input.pocEmail);
  markManual("domain", input.domain);
  markManual("fundingStage", input.fundingStage);
  markManual("hqLocation", input.hqLocation);

  const startup: AppStartup = {
    id: state.nextStartupId++,
    orgId: input.orgId ?? DEFAULT_ORG_ID,
    name: input.name,
    normalizedName: input.normalizedName ?? normalizeName(input.name),
    website: input.website,
    pocName: input.pocName ?? null,
    pocEmail: input.pocEmail ?? null,
    linkedinUrl: input.linkedinUrl ?? null,
    crunchbaseUrl: input.crunchbaseUrl ?? null,
    tracxnUrl: input.tracxnUrl ?? null,
    domain: input.domain ?? null,
    subdomain: input.subdomain ?? null,
    hqLocation: input.hqLocation ?? null,
    country: input.country ?? null,
    fundingStage: input.fundingStage ?? null,
    totalFunding: input.totalFunding ?? null,
    employeeCount: input.employeeCount ?? null,
    founders: input.founders ?? [],
    investors: input.investors ?? [],
    description: input.description ?? null,
    websiteSummary: input.websiteSummary ?? null,
    confidenceScore: input.confidenceScore ?? null,
    lastEnrichedAt: input.lastEnrichedAt ?? null,
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
    manualFields: [...manualFields],
    fieldConfidence: input.fieldConfidence ?? {},
    fieldLastVerifiedAt: input.fieldLastVerifiedAt ?? {},
  };
  state.startups.push(startup);
  upsertStartupEmbedding(startup);
  persist();
  return startup;
}

export function findStartupByNormalizedName(normalizedName: string, orgId = DEFAULT_ORG_ID) {
  return state.startups.find((startup) => startup.orgId === orgId && startup.normalizedName === normalizedName);
}

export function updateStartup(id: number, updates: Partial<AppStartup>, options: { force?: boolean } = {}) {
  const startup = getStartup(id);
  if (!startup) return null;
  const protectedUpdates: Partial<AppStartup> = {};
  for (const [key, value] of Object.entries(updates) as Array<[keyof AppStartup, AppStartup[keyof AppStartup]]>) {
    if (!options.force && startup.manualFields.includes(String(key))) continue;
    protectedUpdates[key] = value as never;
  }
  Object.assign(startup, protectedUpdates, { updatedAt: new Date().toISOString() });
  upsertStartupEmbedding(startup);
  persist();
  return startup;
}

export function applyEnrichmentToStartup(
  id: number,
  enriched: Partial<AppStartup> & { overallConfidence?: number | null },
  options: { sourceType?: string; force?: boolean } = {},
) {
  const startup = getStartup(id);
  if (!startup) return null;

  const now = new Date().toISOString();
  const confidence = normalizeConfidence(enriched.overallConfidence ?? enriched.confidenceScore ?? 0.6);
  const updates: Partial<AppStartup> = {
    lastEnrichedAt: now,
    confidenceScore: Math.max(startup.confidenceScore ?? 0, confidence),
  };

  for (const field of ENRICHABLE_FIELDS) {
    const value = enriched[field];
    if (isEmptyValue(value)) continue;
    if (shouldApplyEnrichedField(startup, field, confidence, options.force)) {
      updates[field] = value as never;
      startup.fieldConfidence[field] = confidence;
      startup.fieldLastVerifiedAt[field] = now;
    }
  }

  Object.assign(startup, updates, { updatedAt: now });
  upsertStartupEmbedding(startup);
  persist();
  return startup;
}

export function addStartupSources(inputSources: Array<Omit<AppStartupSource, "id" | "orgId"> & { orgId?: string }>) {
  const created = inputSources.map((source) => ({
    ...source,
    id: state.nextSourceId++,
    orgId: source.orgId ?? getStartup(source.startupId)?.orgId ?? DEFAULT_ORG_ID,
    lastCheckedAt: source.lastCheckedAt ?? new Date().toISOString(),
  }));
  state.sources.push(...created);
  for (const source of created) {
    cacheExtractedFact({
      orgId: source.orgId,
      startupId: source.startupId,
      sourceUrl: source.sourceUrl,
      extractedField: source.extractedField,
      extractedValue: source.extractedValue,
      confidenceScore: source.confidenceScore ?? 0.5,
    });
  }
  persist();
  return created;
}

export function createEnrichmentJob(startupId: number, jobType = "full_enrich") {
  const startup = getStartup(startupId);
  const job: AppEnrichmentJob = {
    id: state.nextJobId++,
    startupId,
    orgId: startup?.orgId ?? DEFAULT_ORG_ID,
    jobType,
    status: "pending",
    errorMessage: null,
    createdAt: new Date().toISOString(),
    completedAt: null,
  };
  state.jobs.push(job);
  persist();
  return job;
}

export function updateEnrichmentJob(id: number, updates: Partial<AppEnrichmentJob>) {
  const job = state.jobs.find((item) => item.id === id);
  if (!job) return null;
  Object.assign(job, updates);
  persist();
  return job;
}

export function getEnrichmentJob(id: number) {
  return state.jobs.find((job) => job.id === id);
}

export function getPendingJobs(limit: number) {
  return state.jobs
    .filter((job) => job.status === "pending")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(0, limit);
}

export function listEnrichmentJobs(options: { page: number; limit: number; status?: string; orgId?: string }) {
  const orgId = options.orgId ?? DEFAULT_ORG_ID;
  const filtered = state.jobs
    .filter((job) => job.orgId === orgId)
    .filter((job) => !options.status || job.status === options.status)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const start = (options.page - 1) * options.limit;

  return {
    jobs: filtered.slice(start, start + options.limit).map((job) => ({
      ...job,
      startupName: getStartup(job.startupId)?.name ?? null,
    })),
    total: filtered.length,
    page: options.page,
    limit: options.limit,
  };
}

export function createUploadedFile(input: {
  filename: string;
  originalFilename: string;
  rowCount: number;
  status: string;
  orgId?: string;
}) {
  const file: AppUploadedFile = {
    id: state.nextUploadId++,
    orgId: input.orgId ?? DEFAULT_ORG_ID,
    filename: input.filename,
    originalFilename: input.originalFilename,
    rowCount: input.rowCount,
    importedCount: 0,
    status: input.status,
    uploadedAt: new Date().toISOString(),
  };
  state.uploads.push(file);
  persist();
  return file;
}

export function updateUploadedFile(id: number, updates: Partial<AppUploadedFile>) {
  const file = state.uploads.find((item) => item.id === id);
  if (!file) return null;
  Object.assign(file, updates);
  persist();
  return file;
}

export function listUploadedFiles(orgId = DEFAULT_ORG_ID) {
  return state.uploads
    .filter((upload) => upload.orgId === orgId)
    .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))
    .slice(0, 50);
}

export function getDashboardStats(orgId = DEFAULT_ORG_ID) {
  const recentCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const orgStartups = state.startups.filter((startup) => startup.orgId === orgId);
  const orgJobs = state.jobs.filter((job) => job.orgId === orgId);
  const orgUploads = state.uploads.filter((upload) => upload.orgId === orgId);
  return {
    totalStartups: orgStartups.length,
    enrichedStartups: orgStartups.filter((startup) => startup.lastEnrichedAt).length,
    pendingJobs: orgJobs.filter((job) => job.status === "pending" || job.status === "running").length,
    failedJobs: orgJobs.filter((job) => job.status === "failed").length,
    missingDataCount: orgStartups.filter(
      (startup) => !startup.domain || !startup.fundingStage || !startup.hqLocation,
    ).length,
    uploadedFiles: orgUploads.length,
    recentUploads: orgUploads.filter((file) => new Date(file.uploadedAt).getTime() > recentCutoff).length,
  };
}

export function getBreakdown(field: "domain" | "fundingStage", orgId = DEFAULT_ORG_ID) {
  const counts = new Map<string, number>();
  for (const startup of state.startups.filter((item) => item.orgId === orgId)) {
    const value = startup[field];
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([value, count]) => ({ [field]: value, count }));
}

export function getRecentActivity(orgId = DEFAULT_ORG_ID) {
  return state.startups
    .filter((startup) => startup.orgId === orgId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 10)
    .map(serializeStartup);
}

export function findCachedQuery(normalizedQuery: string, embedding = generateEmbedding(normalizedQuery), orgId = DEFAULT_ORG_ID) {
  const now = Date.now();
  const freshEntries = state.queryCache.filter(
    (entry) => entry.orgId === orgId && (!entry.expiresAt || new Date(entry.expiresAt).getTime() > now),
  );
  const exact = freshEntries.find((entry) => entry.normalizedQuery === normalizedQuery);
  if (exact) return { ...exact, similarityScore: 1 };

  const nearest = freshEntries
    .map((entry) => ({ entry, score: cosineSimilarity(embedding, entry.queryEmbedding) }))
    .filter(({ score }) => score >= HIGH_SIMILARITY)
    .sort((a, b) => b.score - a.score)[0];

  return nearest ? { ...nearest.entry, similarityScore: nearest.score } : null;
}

export function createCachedQuery(input: {
  queryText: string;
  normalizedQuery: string;
  parsedFilters: ParsedFilters;
  resultCount?: number;
  resultStartupIds?: number[];
  expiresAt?: string | null;
  orgId?: string;
  queryType?: "exact" | "semantic" | "hybrid";
  confidenceScore?: number;
  sourceVersions?: Record<string, string>;
}) {
  const entry: QueryCacheEntry = {
    id: state.nextQueryId++,
    orgId: input.orgId ?? DEFAULT_ORG_ID,
    queryText: input.queryText,
    normalizedQuery: input.normalizedQuery,
    queryEmbedding: generateEmbedding(input.normalizedQuery),
    parsedFilters: input.parsedFilters,
    resultStartupIds: input.resultStartupIds ?? [],
    resultCount: input.resultCount ?? input.resultStartupIds?.length ?? 0,
    similarityScore: 1,
    queryType: input.queryType ?? "exact",
    confidenceScore: input.confidenceScore ?? 0.9,
    sourceVersions: input.sourceVersions ?? getSourceVersions(input.orgId ?? DEFAULT_ORG_ID),
    createdAt: new Date().toISOString(),
    expiresAt: input.expiresAt ?? addDays(QUERY_CACHE_DAYS),
  };
  state.queryCache.unshift(entry);
  state.queryCache = state.queryCache.slice(0, 500);
  persist();
  return entry;
}

export function listChatHistory(orgId = DEFAULT_ORG_ID) {
  return state.queryCache
    .filter((entry) => entry.orgId === orgId)
    .slice(0, 20)
    .map(({ id, queryText, parsedFilters, resultCount, createdAt }) => ({
      id,
      queryText,
      parsedFilters,
      resultCount,
      cacheHit: false,
      createdAt,
    }));
}

export function queryStartups(filters: ParsedFilters, options: { orgId?: string; semanticQuery?: string } = {}) {
  const orgId = options.orgId ?? DEFAULT_ORG_ID;
  const exactMatches = filterStartups(
    state.startups.filter((startup) => startup.orgId === orgId),
    {
      domain: filters.domain ?? undefined,
      fundingStage: filters.fundingStage ?? undefined,
      location: filters.location ?? undefined,
      country: filters.country ?? undefined,
      keyword: filters.keyword ?? undefined,
      investor: filters.investor ?? undefined,
    },
  ).filter((startup) => {
    if (filters.employeeCountMin != null && (startup.employeeCount ?? 0) < filters.employeeCountMin) return false;
    if (filters.employeeCountMax != null && (startup.employeeCount ?? 0) > filters.employeeCountMax) return false;
    return true;
  });

  const hasStructuredFilters = Boolean(
    filters.domain ||
      filters.fundingStage ||
      filters.location ||
      filters.country ||
      filters.employeeCountMin != null ||
      filters.employeeCountMax != null ||
      filters.investor,
  );

  const matches = hasStructuredFilters
    ? exactMatches
    : vectorSearchStartups(options.semanticQuery ?? filters.keyword ?? "", {
        orgId,
        candidates: exactMatches.length > 0 ? exactMatches : undefined,
      });

  return matches
    .sort((a, b) => (b.confidenceScore ?? 0) - (a.confidenceScore ?? 0))
    .slice(0, 50)
    .map(serializeStartup);
}

export function vectorSearchStartups(
  query: string,
  options: { orgId?: string; limit?: number; candidates?: AppStartup[] } = {},
) {
  const orgId = options.orgId ?? DEFAULT_ORG_ID;
  if (!query.trim()) {
    return (options.candidates ?? state.startups.filter((startup) => startup.orgId === orgId)).slice(0, options.limit ?? 50);
  }

  const embedding = generateEmbedding(query);
  const candidates = options.candidates ?? state.startups.filter((startup) => startup.orgId === orgId);
  return candidates
    .map((startup) => ({
      startup,
      score: cosineSimilarity(embedding, getStartupEmbedding(startup)),
    }))
    .filter((item) => item.score > 0.08)
    .sort((a, b) => b.score - a.score)
    .slice(0, options.limit ?? 50)
    .map((item) => item.startup);
}

export function getCachedCrawlPage(url: string, orgId = DEFAULT_ORG_ID) {
  const normalizedUrl = normalizeUrl(url);
  const now = Date.now();
  return state.crawlPageCache.find(
    (entry) => entry.orgId === orgId && entry.normalizedUrl === normalizedUrl && new Date(entry.expiresAt).getTime() > now,
  );
}

export function cacheCrawlPage(input: { url: string; title?: string | null; text: string; orgId?: string }) {
  const orgId = input.orgId ?? DEFAULT_ORG_ID;
  const normalizedUrl = normalizeUrl(input.url);
  const existing = state.crawlPageCache.find((entry) => entry.orgId === orgId && entry.normalizedUrl === normalizedUrl);
  const entry: CrawlPageCacheEntry = {
    id: existing?.id ?? state.nextCrawlPageId++,
    orgId,
    url: input.url,
    normalizedUrl,
    title: input.title ?? null,
    text: input.text,
    fetchedAt: new Date().toISOString(),
    expiresAt: addDays(WEBSITE_CACHE_DAYS),
  };
  if (existing) Object.assign(existing, entry);
  else state.crawlPageCache.unshift(entry);
  upsertEmbedding("crawl_page", entry.id, `${entry.title ?? ""}\n${entry.text}`, orgId, WEBSITE_CACHE_DAYS);
  persist();
  return entry;
}

export function cacheExtractedFact(input: {
  startupId: number;
  sourceUrl: string | null;
  extractedField: string;
  extractedValue: string | null;
  confidenceScore: number;
  orgId?: string;
}) {
  const orgId = input.orgId ?? getStartup(input.startupId)?.orgId ?? DEFAULT_ORG_ID;
  const expiresAt = input.extractedField === "fundingStage" || input.extractedField === "totalFunding"
    ? addDays(FUNDING_CACHE_DAYS)
    : addDays(FACT_CACHE_DAYS);
  const entry: ExtractedFactCacheEntry = {
    id: state.nextFactId++,
    orgId,
    startupId: input.startupId,
    sourceUrl: input.sourceUrl,
    extractedField: input.extractedField,
    extractedValue: input.extractedValue,
    confidenceScore: input.confidenceScore,
    createdAt: new Date().toISOString(),
    expiresAt,
  };
  state.extractedFactCache.unshift(entry);
  if (input.extractedValue) {
    upsertEmbedding("fact", entry.id, `${input.extractedField}: ${input.extractedValue}`, orgId, FACT_CACHE_DAYS);
  }
  state.extractedFactCache = state.extractedFactCache.slice(0, 2000);
  return entry;
}

function filterStartups(
  items: AppStartup[],
  filters: {
    domain?: string | null;
    fundingStage?: string | null;
    location?: string | null;
    country?: string | null;
    keyword?: string | null;
    investor?: string | null;
    enrichmentStatus?: string | null;
  },
) {
  return items.filter((startup) => {
    if (filters.domain && !includes(startup.domain, filters.domain)) return false;
    if (filters.fundingStage && !includes(startup.fundingStage, filters.fundingStage)) return false;
    if (filters.location && !includes(startup.hqLocation, filters.location)) return false;
    if (filters.country && !includes(startup.country, filters.country)) return false;
    if (filters.investor && !startup.investors.some((investor) => includes(investor, filters.investor!))) return false;
    if (filters.enrichmentStatus && filters.enrichmentStatus !== "all") {
      const status = getStartupStatus(startup);
      if (filters.enrichmentStatus === "missing") {
        if (status !== "missing") return false;
      } else if (status !== filters.enrichmentStatus) {
        return false;
      }
    }
    if (filters.keyword) {
      const haystack = startupSearchText(startup).toLowerCase();
      if (!haystack.includes(filters.keyword.toLowerCase())) return false;
    }
    return true;
  });
}

function sortStartups(items: AppStartup[], sortBy?: string, sortDir: "asc" | "desc" = "desc") {
  const direction = sortDir === "asc" ? 1 : -1;
  const field = sortBy ?? "createdAt";
  return [...items].sort((a, b) => {
    const av = String(a[field as keyof AppStartup] ?? "");
    const bv = String(b[field as keyof AppStartup] ?? "");
    return av.localeCompare(bv) * direction;
  });
}

function includes(value: string | null, query: string) {
  return Boolean(value?.toLowerCase().includes(query.toLowerCase()));
}

const ENRICHABLE_FIELDS = [
  "linkedinUrl",
  "crunchbaseUrl",
  "tracxnUrl",
  "domain",
  "subdomain",
  "hqLocation",
  "country",
  "fundingStage",
  "totalFunding",
  "employeeCount",
  "founders",
  "investors",
  "description",
  "websiteSummary",
] as const;

function shouldApplyEnrichedField(
  startup: AppStartup,
  field: typeof ENRICHABLE_FIELDS[number],
  confidence: number,
  force = false,
) {
  if (force) return true;
  if (startup.manualFields.includes(field)) return false;
  const existing = startup[field];
  if (isEmptyValue(existing)) return true;
  return confidence > (startup.fieldConfidence[field] ?? 0);
}

function isEmptyValue(value: unknown) {
  if (value === null || value === undefined || value === "") return true;
  return Array.isArray(value) && value.length === 0;
}

function normalizeConfidence(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0.5;
  return value > 1 ? Math.min(1, value / 100) : Math.max(0, Math.min(1, value));
}

function startupSearchText(startup: AppStartup) {
  return [
    startup.name,
    startup.website,
    startup.domain,
    startup.subdomain,
    startup.hqLocation,
    startup.country,
    startup.fundingStage,
    startup.totalFunding,
    startup.description,
    startup.websiteSummary,
    startup.founders.join(" "),
    startup.investors.join(" "),
  ]
    .filter(Boolean)
    .join(" ");
}

function getStartupEmbedding(startup: AppStartup) {
  const existing = state.embeddingCache.find(
    (entry) => entry.ownerType === "startup" && entry.ownerId === startup.id && entry.orgId === startup.orgId,
  );
  return existing?.embedding ?? upsertStartupEmbedding(startup).embedding;
}

function upsertStartupEmbedding(startup: AppStartup) {
  return upsertEmbedding("startup", startup.id, startupSearchText(startup), startup.orgId, WEBSITE_CACHE_DAYS);
}

function upsertEmbedding(
  ownerType: EmbeddingCacheEntry["ownerType"],
  ownerId: number | string,
  text: string,
  orgId: string,
  ttlDays: number,
) {
  const textHash = hashText(text);
  const existing = state.embeddingCache.find(
    (entry) => entry.orgId === orgId && entry.ownerType === ownerType && entry.ownerId === ownerId,
  );
  if (existing && existing.textHash === textHash) return existing;

  const entry: EmbeddingCacheEntry = {
    id: existing?.id ?? state.nextEmbeddingId++,
    orgId,
    ownerType,
    ownerId,
    textHash,
    embedding: generateEmbedding(text),
    model: EMBEDDING_MODEL,
    createdAt: new Date().toISOString(),
    expiresAt: addDays(ttlDays),
  };
  if (existing) Object.assign(existing, entry);
  else state.embeddingCache.unshift(entry);
  state.embeddingCache = state.embeddingCache.slice(0, 4000);
  return entry;
}

function generateEmbedding(text: string) {
  const vector = Array.from({ length: VECTOR_DIMS }, () => 0);
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1);

  for (const token of tokens) {
    const hash = hashNumber(token);
    const index = Math.abs(hash) % VECTOR_DIMS;
    vector[index] += 1 + Math.min(token.length, 12) / 12;
  }

  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => Number((value / norm).toFixed(6)));
}

function cosineSimilarity(a: number[], b: number[]) {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  let an = 0;
  let bn = 0;
  for (let i = 0; i < length; i += 1) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    an += (a[i] ?? 0) ** 2;
    bn += (b[i] ?? 0) ** 2;
  }
  return dot / ((Math.sqrt(an) || 1) * (Math.sqrt(bn) || 1));
}

function hashText(text: string) {
  return String(hashNumber(text));
}

function hashNumber(text: string) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

function normalizeUrl(url: string) {
  try {
    const parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
    parsed.hash = "";
    parsed.search = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return url.trim().toLowerCase();
  }
}

function getSourceVersions(orgId: string) {
  const orgStartups = state.startups.filter((startup) => startup.orgId === orgId);
  const orgSources = state.sources.filter((source) => source.orgId === orgId);
  return {
    startupsUpdatedAt: orgStartups.map((startup) => startup.updatedAt).sort().at(-1) ?? "",
    sourcesCheckedAt: orgSources.map((source) => source.lastCheckedAt ?? "").sort().at(-1) ?? "",
  };
}

function addDays(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function defaultState(): StoreState {
  return {
    nextStartupId: 1,
    nextSourceId: 1,
    nextJobId: 1,
    nextUploadId: 1,
    nextQueryId: 1,
    nextCrawlPageId: 1,
    nextFactId: 1,
    nextEmbeddingId: 1,
    startups: [],
    sources: [],
    jobs: [],
    uploads: [],
    queryCache: [],
    crawlPageCache: [],
    extractedFactCache: [],
    embeddingCache: [],
  };
}

function loadState(): StoreState {
  try {
    if (!fs.existsSync(storePath)) return defaultState();
    const parsed = JSON.parse(fs.readFileSync(storePath, "utf-8")) as Partial<StoreState>;
    const next = { ...defaultState(), ...parsed };
    next.startups = (next.startups ?? []).map((startup) => ({
      ...startup,
      orgId: startup.orgId ?? DEFAULT_ORG_ID,
      founders: startup.founders ?? [],
      investors: startup.investors ?? [],
      manualFields: startup.manualFields ?? [],
      fieldConfidence: startup.fieldConfidence ?? {},
      fieldLastVerifiedAt: startup.fieldLastVerifiedAt ?? {},
    }));
    next.sources = (next.sources ?? []).map((source) => ({
      ...source,
      orgId: source.orgId ?? next.startups.find((startup) => startup.id === source.startupId)?.orgId ?? DEFAULT_ORG_ID,
    }));
    next.jobs = (next.jobs ?? []).map((job) => ({
      ...job,
      orgId: job.orgId ?? next.startups.find((startup) => startup.id === job.startupId)?.orgId ?? DEFAULT_ORG_ID,
    }));
    next.uploads = (next.uploads ?? []).map((upload) => ({
      ...upload,
      orgId: upload.orgId ?? DEFAULT_ORG_ID,
    }));
    next.nextStartupId = Math.max(next.nextStartupId, ...next.startups.map((item) => item.id + 1), 1);
    next.nextSourceId = Math.max(next.nextSourceId, ...next.sources.map((item) => item.id + 1), 1);
    next.nextJobId = Math.max(next.nextJobId, ...next.jobs.map((item) => item.id + 1), 1);
    next.nextUploadId = Math.max(next.nextUploadId, ...next.uploads.map((item) => item.id + 1), 1);
    return next;
  } catch {
    return defaultState();
  }
}

function persist() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const tmpPath = `${storePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2));
  fs.renameSync(tmpPath, storePath);
}
