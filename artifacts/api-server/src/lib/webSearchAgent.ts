import {
  canonicalWebsite,
  crawlCompanyWebsite,
  extractFacts,
  reconcileFacts,
  type CachedPage,
  type PageCache,
} from "@workspace/enrichment-core";
import { cacheCrawlPage, getCachedCrawlPage } from "./appStore";
import { logger } from "./logger";

export interface EnrichedStartupData {
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
  linkedinUrl: string | null;
  crunchbaseUrl: string | null;
  tracxnUrl: string | null;
  sources: Array<{
    sourceUrl: string | null;
    sourceType: string;
    extractedField: string;
    extractedValue: string | null;
    confidenceScore: number;
  }>;
  overallConfidence: number;
  telemetry: {
    pagesFetched: number;
    pagesFromCache: number;
    fetchFailures: number;
    bytesDownloaded: number;
    fieldsWithoutAi: number;
    llmCalls: 0;
    durationMs: number;
  };
}

interface StartupInput {
  id: number;
  name: string;
  website: string | null;
  linkedinUrl: string | null;
  crunchbaseUrl: string | null;
  tracxnUrl: string | null;
  pocName: string | null;
  pocEmail: string | null;
}

/**
 * Legacy public name retained for compatibility. This function performs bounded,
 * deterministic first-party enrichment and never calls a model or web-search agent.
 */
export async function enrichStartupViaWebSearch(startup: StartupInput): Promise<EnrichedStartupData> {
  const website = canonicalWebsite(startup.website);
  if (!website) return emptyResult();
  const cache: PageCache = {
    async get(url) {
      const row = getCachedCrawlPage(url);
      if (!row?.parsedContent) return null;
      return {
        url: row.url,
        fetchedAt: row.fetchedAt,
        expiresAt: row.expiresAt,
        etag: row.etag,
        lastModified: row.lastModified,
        parsed: row.parsedContent,
      } as CachedPage;
    },
    async set(entry) {
      cacheCrawlPage({
        url: entry.url,
        title: entry.parsed.title,
        text: entry.parsed.text,
        contentHash: entry.parsed.contentHash,
        etag: entry.etag,
        lastModified: entry.lastModified,
        parsedContent: entry.parsed,
        expiresAt: entry.expiresAt,
      });
    },
  };
  const crawl = await crawlCompanyWebsite(website, cache);
  const reconciled = reconcileFacts(extractFacts(crawl.pages));
  const values = reconciled.values;
  const confidenceValues = reconciled.selected.map((item) => confidence(item.confidence));
  const result: EnrichedStartupData = {
    domain: null,
    subdomain: null,
    hqLocation: stringValue(values.hqLocation),
    country: stringValue(values.country),
    fundingStage: null,
    totalFunding: null,
    employeeCount: typeof values.employeeCount === "number" ? values.employeeCount : null,
    founders: stringArray(values.founders),
    investors: [],
    description: stringValue(values.description),
    websiteSummary: stringValue(values.description),
    linkedinUrl: stringValue(values.linkedinUrl) ?? startup.linkedinUrl,
    crunchbaseUrl: stringValue(values.crunchbaseUrl) ?? startup.crunchbaseUrl,
    tracxnUrl: stringValue(values.tracxnUrl) ?? startup.tracxnUrl,
    sources: reconciled.selected.map((item) => ({
      sourceUrl: item.sourceUrl,
      sourceType: `${item.sourceType}:${item.method}`,
      extractedField: item.field,
      extractedValue: JSON.stringify(item.value),
      confidenceScore: confidence(item.confidence),
    })),
    overallConfidence: confidenceValues.length ? Math.min(...confidenceValues) : 0,
    telemetry: {
      pagesFetched: crawl.telemetry.pagesFetched,
      pagesFromCache: crawl.telemetry.pagesFromCache,
      fetchFailures: crawl.telemetry.fetchFailures,
      bytesDownloaded: crawl.telemetry.bytesDownloaded,
      fieldsWithoutAi: reconciled.selected.length,
      llmCalls: 0,
      durationMs: crawl.telemetry.durationMs,
    },
  };
  logger.info({ startupId: startup.id, ...result.telemetry }, "Deterministic factual enrichment completed");
  return result;
}

function emptyResult(): EnrichedStartupData {
  return {
    domain: null, subdomain: null, hqLocation: null, country: null, fundingStage: null, totalFunding: null,
    employeeCount: null, founders: [], investors: [], description: null, websiteSummary: null,
    linkedinUrl: null, crunchbaseUrl: null, tracxnUrl: null, sources: [], overallConfidence: 0,
    telemetry: { pagesFetched: 0, pagesFromCache: 0, fetchFailures: 0, bytesDownloaded: 0, fieldsWithoutAi: 0, llmCalls: 0, durationMs: 0 },
  };
}
function confidence(value: "HIGH" | "MEDIUM" | "LOW") { return value === "HIGH" ? 0.95 : value === "MEDIUM" ? 0.7 : 0.4; }
function stringValue(value: unknown) { return typeof value === "string" && value ? value : null; }
function stringArray(value: unknown) { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; }
