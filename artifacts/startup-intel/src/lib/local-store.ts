import { useSyncExternalStore } from "react";

const STARTUPS_KEY = "startup-intel:startups";
const UPLOADS_KEY = "startup-intel:uploads";
const CHAT_HISTORY_KEY = "startup-intel:chat-history";
const CHANGE_EVENT = "startup-intel:local-store-change";

const remoteListCache = new Map<string, ReturnType<typeof buildListStartupsResponse>>();
const remoteJobsCache = new Map<string, ReturnType<typeof buildListJobsResponse>>();
const remoteStartupCache = new Map<number, LocalStartup>();
let remoteDashboardCache: ReturnType<typeof buildDashboardResponse> | null = null;
let remoteUploadsCache: LocalUpload[] | null = null;
const inFlight = new Set<string>();

export type EnrichmentStatus = "enriched" | "pending" | "missing";

export type LocalStartup = {
  id: number;
  name: string;
  normalizedName: string;
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
  description: string | null;
  websiteSummary: string | null;
  confidenceScore: number | null;
  enrichmentStatus: EnrichmentStatus;
  lastEnrichedAt: string | null;
  createdAt: string;
  updatedAt: string;
  sources: Array<{
    id: number;
    extractedField: string;
    extractedValue: string | null;
    sourceType: string;
    sourceUrl?: string | null;
    confidenceScore: number | null;
  }>;
  enrichmentJobs: Array<{
    id: number;
    jobType: string;
    status: string;
    createdAt: string;
    errorMessage: string | null;
  }>;
};

export type LocalUpload = {
  id: number;
  filename: string;
  rowCount: number;
  status: "completed" | "failed";
  uploadedAt: string;
};

export type LocalCsvRow = Omit<
  LocalStartup,
  | "id"
  | "normalizedName"
  | "enrichmentStatus"
  | "confidenceScore"
  | "lastEnrichedAt"
  | "createdAt"
  | "updatedAt"
  | "sources"
  | "enrichmentJobs"
>;

export type LocalCsvPreview = {
  fileId: string;
  filename: string;
  totalRows: number;
  columns: string[];
  rows: LocalCsvRow[];
};

export type LocalImportResult = {
  imported: number;
  skipped: number;
  errors: number;
};

export type LocalChatHistoryItem = {
  id: number;
  queryText: string;
  resultCount: number;
  createdAt: string;
};

export type LocalChatResponse = {
  query: string;
  parsedFilters: Record<string, unknown>;
  startups: LocalStartup[];
  totalMatched: number;
  cacheHit: boolean;
  processingMs: number;
  answer?: string | null;
  provider?: string;
  model?: string;
};

type ListStartupsOptions = {
  page: number;
  limit: number;
  keyword?: string;
  enrichmentStatus?: EnrichmentStatus;
};

type ListJobsOptions = {
  page: number;
  limit: number;
  status?: string;
};

const HEADER_ALIASES: Record<keyof LocalCsvRow, string[]> = {
  name: ["name", "company", "companyname", "startup", "startupname"],
  website: ["website", "url", "site", "companywebsite"],
  pocName: ["pocname", "contact", "contactname", "pointofcontact", "founder"],
  pocEmail: ["pocemail", "email", "contactemail"],
  linkedinUrl: ["linkedin", "linkedinurl", "linkedin_url"],
  crunchbaseUrl: ["crunchbase", "crunchbaseurl", "crunchbase_url"],
  tracxnUrl: ["tracxn", "tracxnurl", "tracxn_url"],
  domain: ["domain", "sector", "industry", "category"],
  subdomain: ["subdomain", "subsector", "subcategory"],
  hqLocation: ["hqlocation", "location", "headquarters", "city"],
  country: ["country"],
  fundingStage: ["fundingstage", "stage", "round"],
  totalFunding: ["totalfunding", "funding", "amountfunded"],
  employeeCount: ["employeecount", "employees", "teamSize", "teamsize"],
  description: ["description", "summary", "about"],
  websiteSummary: ["websitesummary", "website_summary"],
};

export function useLocalStoreVersion() {
  if (typeof window !== "undefined") {
    void refreshDashboard();
    void refreshUploads();
  }
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export async function previewCsvFile(file: File): Promise<LocalCsvPreview> {
  const text = await file.text();
  const records = parseCsv(text);
  const [headers = [], ...body] = records;
  const rows = body
    .filter((row) => row.some((cell) => cell.trim() !== ""))
    .map((row) => mapCsvRow(headers, row))
    .filter((row) => row.name);

  return {
    fileId: `${Date.now()}-${file.name}`,
    filename: file.name,
    totalRows: rows.length,
    columns: headers,
    rows,
  };
}

export async function importPreview(preview: LocalCsvPreview): Promise<LocalImportResult> {
  if (typeof window !== "undefined") {
    const response = await fetch("/api/upload/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: preview.filename,
        rows: preview.rows.map((row) => ({
          name: row.name,
          website: row.website,
          pocName: row.pocName,
          pocEmail: row.pocEmail,
          domain: row.domain,
          fundingStage: row.fundingStage,
          hqLocation: row.hqLocation,
          country: row.country,
          linkedinUrl: row.linkedinUrl,
          crunchbaseUrl: row.crunchbaseUrl,
          tracxnUrl: row.tracxnUrl,
        })),
      }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.error ?? "Import failed");
    remoteListCache.clear();
    remoteDashboardCache = null;
    await Promise.all([refreshDashboard(), refreshUploads()]);
    notifyChange();
    return {
      imported: Number(body?.imported ?? 0),
      skipped: Number(body?.skipped ?? 0),
      errors: Number(body?.errors ?? 0),
    };
  }

  const existing = readStartups();
  const seen = new Set(existing.map((startup) => startup.normalizedName));
  let imported = 0;
  let skipped = 0;
  let errors = 0;
  const now = new Date().toISOString();
  let nextId = Math.max(0, ...existing.map((startup) => startup.id)) + 1;

  const nextStartups = [...existing];

  for (const row of preview.rows) {
    if (!row.name.trim()) {
      errors += 1;
      continue;
    }

    const normalizedName = normalize(row.name);
    if (seen.has(normalizedName)) {
      skipped += 1;
      continue;
    }

    const startup: LocalStartup = {
      ...row,
      id: nextId++,
      normalizedName,
      website: row.website || "",
      domain: row.domain || inferDomain(row.website),
      enrichmentStatus: row.description || row.websiteSummary ? "enriched" : "missing",
      confidenceScore: row.description || row.websiteSummary ? 75 : null,
      lastEnrichedAt: row.description || row.websiteSummary ? now : null,
      createdAt: now,
      updatedAt: now,
      sources: buildSources(nextId, row),
      enrichmentJobs: [],
    };

    nextStartups.push(startup);
    seen.add(normalizedName);
    imported += 1;
  }

  writeStartups(nextStartups);
  writeUploads([
    {
      id: Date.now(),
      filename: preview.filename,
      rowCount: preview.totalRows,
      status: errors > 0 && imported === 0 ? "failed" : "completed",
      uploadedAt: now,
    },
    ...readUploads(),
  ]);
  notifyChange();

  return { imported, skipped, errors };
}

export function listUploads(): LocalUpload[] {
  if (typeof window !== "undefined") {
    void refreshUploads();
    return remoteUploadsCache ?? readUploads();
  }
  return readUploads();
}

export function listStartups(options: ListStartupsOptions) {
  if (typeof window !== "undefined") {
    const key = JSON.stringify(options);
    void refreshStartups(options);
    return remoteListCache.get(key) ?? buildListStartupsResponse([], options.page, options.limit, 0);
  }

  const keyword = normalize(options.keyword ?? "");
  const filtered = readStartups().filter((startup) => {
    const matchesStatus =
      !options.enrichmentStatus || startup.enrichmentStatus === options.enrichmentStatus;
    const haystack = normalize(
      [
        startup.name,
        startup.website,
        startup.domain,
        startup.hqLocation,
        startup.country,
        startup.fundingStage,
        startup.description,
      ].join(" "),
    );
    return matchesStatus && (!keyword || haystack.includes(keyword));
  });

  const start = (options.page - 1) * options.limit;
  return {
    startups: filtered.slice(start, start + options.limit),
    total: filtered.length,
    page: options.page,
    limit: options.limit,
  };
}

export function queryStartups(query: string): LocalChatResponse {
  const started = performance.now();
  const normalizedQuery = query.toLowerCase();
  const tokens = normalizedQuery.split(/[^a-z0-9]+/).filter(Boolean);
  const startups = readStartups();
  const matches = startups.filter((startup) => {
    const haystack = [
      startup.name,
      startup.website,
      startup.domain,
      startup.subdomain,
      startup.hqLocation,
      startup.country,
      startup.fundingStage,
      startup.description,
      startup.websiteSummary,
    ]
      .join(" ")
      .toLowerCase();

    return tokens.length === 0 || tokens.some((token) => haystack.includes(token));
  });

  const response = {
    query,
    parsedFilters: extractFilters(query, tokens),
    startups: matches.slice(0, 50),
    totalMatched: matches.length,
    cacheHit: false,
    processingMs: Math.max(1, Math.round(performance.now() - started)),
  };

  writeChatHistory([
    {
      id: Date.now(),
      queryText: query,
      resultCount: response.totalMatched,
      createdAt: new Date().toISOString(),
    },
    ...readChatHistory().filter((item) => item.queryText !== query).slice(0, 19),
  ]);
  notifyChange();

  return response;
}

export async function queryStartupsWithModel(query: string): Promise<LocalChatResponse> {
  const started = performance.now();
  const response = await fetch("/api/chat/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error ?? "Chat model query failed");
  }

  const matches = Array.isArray(body?.startups) ? body.startups.map(normalizeRemoteStartup) : [];
  const result = {
    query,
    parsedFilters: isRecord(body?.parsedFilters) ? body.parsedFilters : {},
    startups: matches,
    totalMatched: Number(body?.totalMatched ?? matches.length),
    cacheHit: Boolean(body?.cacheHit),
    processingMs: Number(body?.processingMs ?? Math.max(1, Math.round(performance.now() - started))),
    answer: typeof body?.answer === "string" ? body.answer : null,
    provider: typeof body?.provider === "string" ? body.provider : "system",
    model: typeof body?.model === "string" ? body.model : "supabase",
  };

  writeChatHistory([
    {
      id: Date.now(),
      queryText: query,
      resultCount: result.totalMatched,
      createdAt: new Date().toISOString(),
    },
    ...readChatHistory().filter((item) => item.queryText !== query).slice(0, 19),
  ]);
  notifyChange();

  return result;
}

export function listChatHistory(): LocalChatHistoryItem[] {
  return readChatHistory();
}

export function listEnrichmentJobs(options: ListJobsOptions) {
  if (typeof window !== "undefined") {
    const key = JSON.stringify(options);
    void refreshJobs(options);
    return remoteJobsCache.get(key) ?? buildListJobsResponse([], options.page, options.limit, 0);
  }

  const jobs = readStartups()
    .flatMap((startup) =>
      startup.enrichmentJobs.map((job) => ({
        ...job,
        startupId: startup.id,
        startupName: startup.name,
        completedAt: job.status === "completed" ? job.createdAt : null,
      })),
    )
    .filter((job) => !options.status || job.status === options.status)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const start = (options.page - 1) * options.limit;
  return {
    jobs: jobs.slice(start, start + options.limit),
    total: jobs.length,
    page: options.page,
    limit: options.limit,
  };
}

export function getStartup(id: number): LocalStartup | undefined {
  if (typeof window !== "undefined") {
    void refreshStartup(id);
    return remoteStartupCache.get(id);
  }
  return readStartups().find((startup) => startup.id === id);
}

export async function enrichStartupWithOpenAI(id: number): Promise<void> {
  if (typeof window !== "undefined") {
    const response = await fetch(`/api/startups/${id}/enrich`, { method: "POST" });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.error ?? "Failed to queue enrichment");
    await fetch("/api/jobs/process", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limit: 1 }),
    }).catch(() => null);
    remoteDashboardCache = null;
    remoteJobsCache.clear();
    await Promise.all([refreshStartup(id), refreshDashboard()]);
    notifyChange();
    return;
  }

  const startup = getStartup(id);
  if (!startup) {
    throw new Error("Startup not found");
  }

  const startedAt = new Date().toISOString();
  recordEnrichmentJob(id, {
    id: Date.now(),
    jobType: "openai_web_enrichment",
    status: "running",
    createdAt: startedAt,
    errorMessage: null,
  });

  try {
    const response = await fetch("/api/web-enrichment/startup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: startup.id,
        name: startup.name,
        website: startup.website,
        linkedinUrl: startup.linkedinUrl,
        crunchbaseUrl: startup.crunchbaseUrl,
        tracxnUrl: startup.tracxnUrl,
        pocName: startup.pocName,
        pocEmail: startup.pocEmail,
      }),
    });

    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(body?.error ?? "OpenAI web enrichment failed");
    }

    applyOpenAIEnrichment(id, body);
  } catch (error) {
    recordEnrichmentJob(id, {
      id: Date.now(),
      jobType: "openai_web_enrichment",
      status: "failed",
      createdAt: new Date().toISOString(),
      errorMessage: error instanceof Error ? error.message : "OpenAI web enrichment failed",
    });
    throw error;
  }
}

export async function enrichAllStartupsWithOpenAI(
  onProgress?: (progress: { completed: number; total: number; failed: number; currentName: string }) => void,
) {
  if (typeof window !== "undefined") {
    const startupData = await fetch("/api/startups?page=1&limit=500&enrichmentStatus=missing").then((res) => res.json());
    const targets = Array.isArray(startupData?.startups) ? startupData.startups.map(normalizeRemoteStartup) : [];
    let completed = 0;
    let failed = 0;
    for (const startup of targets) {
      onProgress?.({ completed, total: targets.length, failed, currentName: startup.name });
      try {
        const queued = await fetch(`/api/startups/${startup.id}/enrich`, { method: "POST" });
        if (!queued.ok) throw new Error("Failed to queue job");
        completed += 1;
      } catch {
        failed += 1;
      }
    }
    await fetch("/api/jobs/process", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limit: 5 }),
    }).catch(() => null);
    onProgress?.({ completed, total: targets.length, failed, currentName: "" });
    remoteDashboardCache = null;
    remoteJobsCache.clear();
    remoteListCache.clear();
    await refreshDashboard();
    notifyChange();
    return { completed, failed, total: targets.length };
  }

  const targets = readStartups().filter((startup) => startup.enrichmentStatus !== "enriched");
  let completed = 0;
  let failed = 0;

  for (const startup of targets) {
    onProgress?.({ completed, total: targets.length, failed, currentName: startup.name });
    try {
      await enrichStartupWithOpenAI(startup.id);
      completed += 1;
    } catch {
      failed += 1;
    }
  }

  onProgress?.({ completed, total: targets.length, failed, currentName: "" });
  return { completed, failed, total: targets.length };
}

export function getDashboardData() {
  if (typeof window !== "undefined") {
    void refreshDashboard();
    return remoteDashboardCache ?? buildDashboardResponse();
  }

  const startups = readStartups();
  const jobs = startups.flatMap((startup) => startup.enrichmentJobs);
  return {
    stats: {
      totalStartups: startups.length,
      enrichedStartups: startups.filter((startup) => startup.enrichmentStatus === "enriched").length,
      pendingJobs: jobs.filter((job) => job.status === "pending" || job.status === "running").length,
      failedJobs: jobs.filter((job) => job.status === "failed").length,
      uploadedFiles: readUploads().length,
    },
    domainBreakdown: countBy(startups, "domain", "Unknown").map(([domain, count]) => ({
      domain,
      count,
    })),
    fundingBreakdown: countBy(startups, "fundingStage", "Unknown").map(([fundingStage, count]) => ({
      fundingStage,
      count,
    })),
    recentActivity: [...startups]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 8),
  };
}

function readStartups(): LocalStartup[] {
  return readJson(STARTUPS_KEY, []);
}

function buildListStartupsResponse(startups: LocalStartup[] = [], page = 1, limit = 20, total = startups.length) {
  return { startups, total, page, limit };
}

function buildListJobsResponse(jobs: any[] = [], page = 1, limit = 20, total = jobs.length) {
  return { jobs, total, page, limit };
}

function buildDashboardResponse() {
  return {
    stats: {
      totalStartups: 0,
      enrichedStartups: 0,
      pendingJobs: 0,
      failedJobs: 0,
      uploadedFiles: 0,
    },
    domainBreakdown: [] as Array<{ domain: string; count: number }>,
    fundingBreakdown: [] as Array<{ fundingStage: string; count: number }>,
    recentActivity: [] as LocalStartup[],
  };
}

async function refreshDashboard() {
  await once("dashboard", async () => {
    const response = await fetch("/api/dashboard");
    if (!response.ok) return;
    remoteDashboardCache = await response.json();
    notifyChange();
  });
}

async function refreshUploads() {
  await once("uploads", async () => {
    const response = await fetch("/api/uploaded-files");
    if (!response.ok) return;
    remoteUploadsCache = await response.json();
    notifyChange();
  });
}

async function refreshStartups(options: ListStartupsOptions) {
  const key = JSON.stringify(options);
  await once(`startups:${key}`, async () => {
    const params = new URLSearchParams({
      page: String(options.page),
      limit: String(options.limit),
    });
    if (options.keyword) params.set("keyword", options.keyword);
    if (options.enrichmentStatus) params.set("enrichmentStatus", options.enrichmentStatus);
    const response = await fetch(`/api/startups?${params}`);
    if (!response.ok) return;
    const body = await response.json();
    remoteListCache.set(key, {
      startups: Array.isArray(body.startups) ? body.startups.map(normalizeRemoteStartup) : [],
      total: Number(body.total ?? 0),
      page: Number(body.page ?? options.page),
      limit: Number(body.limit ?? options.limit),
    });
    notifyChange();
  });
}

async function refreshJobs(options: ListJobsOptions) {
  const key = JSON.stringify(options);
  await once(`jobs:${key}`, async () => {
    const params = new URLSearchParams({
      page: String(options.page),
      limit: String(options.limit),
    });
    if (options.status) params.set("status", options.status);
    const response = await fetch(`/api/enrichment-jobs?${params}`);
    if (!response.ok) return;
    remoteJobsCache.set(key, await response.json());
    notifyChange();
  });
}

async function refreshStartup(id: number) {
  await once(`startup:${id}`, async () => {
    const response = await fetch(`/api/startups/${id}`);
    if (!response.ok) return;
    remoteStartupCache.set(id, normalizeRemoteStartup(await response.json()));
    notifyChange();
  });
}

async function once(key: string, task: () => Promise<void>) {
  if (inFlight.has(key)) return;
  inFlight.add(key);
  try {
    await task();
  } finally {
    inFlight.delete(key);
  }
}

function normalizeRemoteStartup(value: any): LocalStartup {
  return {
    id: Number(value.id),
    name: String(value.name ?? ""),
    normalizedName: String(value.normalizedName ?? value.normalized_name ?? ""),
    website: String(value.website ?? ""),
    pocName: value.pocName ?? value.poc_name ?? null,
    pocEmail: value.pocEmail ?? value.poc_email ?? null,
    linkedinUrl: value.linkedinUrl ?? value.linkedin_url ?? null,
    crunchbaseUrl: value.crunchbaseUrl ?? value.crunchbase_url ?? null,
    tracxnUrl: value.tracxnUrl ?? value.tracxn_url ?? null,
    domain: value.domain ?? null,
    subdomain: value.subdomain ?? null,
    hqLocation: value.hqLocation ?? value.hq_location ?? null,
    country: value.country ?? null,
    fundingStage: value.fundingStage ?? value.funding_stage ?? null,
    totalFunding: value.totalFunding ?? value.total_funding ?? null,
    employeeCount: value.employeeCount ?? value.employee_count ?? null,
    description: value.description ?? null,
    websiteSummary: value.websiteSummary ?? value.website_summary ?? null,
    confidenceScore: value.confidenceScore ?? value.confidence_score ?? null,
    enrichmentStatus: value.enrichmentStatus ?? "missing",
    lastEnrichedAt: value.lastEnrichedAt ?? value.last_enriched_at ?? null,
    createdAt: value.createdAt ?? value.created_at ?? new Date().toISOString(),
    updatedAt: value.updatedAt ?? value.updated_at ?? new Date().toISOString(),
    sources: Array.isArray(value.sources) ? value.sources : [],
    enrichmentJobs: Array.isArray(value.enrichmentJobs) ? value.enrichmentJobs : [],
  };
}

function writeStartups(startups: LocalStartup[]) {
  localStorage.setItem(STARTUPS_KEY, JSON.stringify(startups));
}

function readUploads(): LocalUpload[] {
  return readJson(UPLOADS_KEY, []);
}

function writeUploads(uploads: LocalUpload[]) {
  localStorage.setItem(UPLOADS_KEY, JSON.stringify(uploads));
}

function readChatHistory(): LocalChatHistoryItem[] {
  return readJson(CHAT_HISTORY_KEY, []);
}

function writeChatHistory(history: LocalChatHistoryItem[]) {
  localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(history));
}

function applyOpenAIEnrichment(id: number, enriched: any) {
  const now = new Date().toISOString();
  const startups = readStartups();
  const next = startups.map((startup) => {
    if (startup.id !== id) return startup;

    const score = normalizeConfidence(enriched?.overallConfidence);
    return {
      ...startup,
      domain: enriched?.domain ?? startup.domain,
      subdomain: enriched?.subdomain ?? startup.subdomain,
      hqLocation: enriched?.hqLocation ?? startup.hqLocation,
      country: enriched?.country ?? startup.country,
      fundingStage: enriched?.fundingStage ?? startup.fundingStage,
      totalFunding: enriched?.totalFunding ?? startup.totalFunding,
      employeeCount:
        typeof enriched?.employeeCount === "number" ? enriched.employeeCount : startup.employeeCount,
      description: enriched?.description ?? startup.description,
      websiteSummary: enriched?.websiteSummary ?? startup.websiteSummary,
      linkedinUrl: enriched?.linkedinUrl ?? startup.linkedinUrl,
      crunchbaseUrl: enriched?.crunchbaseUrl ?? startup.crunchbaseUrl,
      confidenceScore: score ?? startup.confidenceScore,
      enrichmentStatus: "enriched" as const,
      lastEnrichedAt: now,
      updatedAt: now,
      sources: [
        ...buildOpenAISources(enriched?.sources),
        ...startup.sources,
      ],
      enrichmentJobs: [
        {
          id: Date.now(),
          jobType: "openai_web_enrichment",
          status: "completed",
          createdAt: now,
          errorMessage: null,
        },
        ...startup.enrichmentJobs.filter((job) => job.status !== "running"),
      ],
    };
  });

  writeStartups(next);
  notifyChange();
}

function recordEnrichmentJob(id: number, job: LocalStartup["enrichmentJobs"][number]) {
  const startups = readStartups();
  const next = startups.map((startup) =>
    startup.id === id
      ? {
          ...startup,
          enrichmentJobs: [
            job,
            ...startup.enrichmentJobs.filter((existing) => existing.status !== "running"),
          ],
        }
      : startup,
  );
  writeStartups(next);
  notifyChange();
}

function buildOpenAISources(sources: unknown): LocalStartup["sources"] {
  if (!Array.isArray(sources)) return [];
  const seed = Date.now();
  return sources.map((source: any, index: number) => ({
    id: seed + index,
    extractedField: String(source?.extractedField ?? "unknown"),
    extractedValue: source?.extractedValue == null ? null : String(source.extractedValue),
    sourceType: "openai_web_search",
    sourceUrl: source?.sourceUrl == null ? null : String(source.sourceUrl),
    confidenceScore: normalizeConfidence(source?.confidenceScore),
  }));
}

function normalizeConfidence(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.round(value <= 1 ? value * 100 : value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function subscribe(callback: () => void) {
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

function getSnapshot() {
  return [
    localStorage.getItem(STARTUPS_KEY) ?? "",
    localStorage.getItem(UPLOADS_KEY) ?? "",
    localStorage.getItem(CHAT_HISTORY_KEY) ?? "",
  ].join(":");
}

function notifyChange() {
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function extractFilters(query: string, tokens: string[]) {
  const filters: Record<string, string> = {};
  const startups = readStartups();
  const lowerQuery = query.toLowerCase();
  const stages = uniqueValues(startups.map((startup) => startup.fundingStage));
  const domains = uniqueValues(startups.map((startup) => startup.domain));
  const countries = uniqueValues(startups.map((startup) => startup.country));

  const stage = stages.find((value) => lowerQuery.includes(value.toLowerCase()));
  const domain = domains.find((value) => lowerQuery.includes(value.toLowerCase()));
  const country = countries.find((value) => lowerQuery.includes(value.toLowerCase()));
  if (stage) filters.fundingStage = stage;
  if (domain) filters.domain = domain;
  if (country) filters.country = country;
  if (tokens.length > 0) filters.keywords = tokens.slice(0, 5).join(", ");
  return filters;
}

function uniqueValues(values: Array<string | null>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(cell.trim());
      cell = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  if (cell || row.length > 0) {
    row.push(cell.trim());
    rows.push(row);
  }

  return rows;
}

function mapCsvRow(headers: string[], row: string[]): LocalCsvRow {
  const normalizedHeaders = headers.map(normalize);
  const pick = (field: keyof LocalCsvRow) => {
    const aliases = HEADER_ALIASES[field];
    const index = normalizedHeaders.findIndex((header) => aliases.includes(header));
    return index >= 0 ? clean(row[index]) : null;
  };

  return {
    name: pick("name") ?? "",
    website: pick("website") ?? "",
    pocName: pick("pocName"),
    pocEmail: pick("pocEmail"),
    linkedinUrl: pick("linkedinUrl"),
    crunchbaseUrl: pick("crunchbaseUrl"),
    tracxnUrl: pick("tracxnUrl"),
    domain: pick("domain"),
    subdomain: pick("subdomain"),
    hqLocation: pick("hqLocation"),
    country: pick("country"),
    fundingStage: pick("fundingStage"),
    totalFunding: pick("totalFunding"),
    employeeCount: parseNumber(pick("employeeCount")),
    description: pick("description"),
    websiteSummary: pick("websiteSummary"),
  };
}

function buildSources(seed: number, row: LocalCsvRow): LocalStartup["sources"] {
  return Object.entries(row)
    .filter(([, value]) => value !== null && value !== "")
    .map(([field, value], index) => ({
      id: seed * 100 + index,
      extractedField: field,
      extractedValue: String(value),
      sourceType: "csv",
      confidenceScore: 90,
    }));
}

function countBy<T extends Record<string, unknown>>(items: T[], field: keyof T, fallback: string) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = String(item[field] || fallback);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
}

function clean(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function parseNumber(value: string | null) {
  if (!value) return null;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function inferDomain(website: string | null) {
  if (!website) return null;
  try {
    const url = new URL(website.startsWith("http") ? website : `https://${website}`);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return website.replace(/^https?:\/\/(www\.)?/, "").split("/")[0] || null;
  }
}
