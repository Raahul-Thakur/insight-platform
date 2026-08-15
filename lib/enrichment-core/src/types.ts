export type Confidence = "HIGH" | "MEDIUM" | "LOW";

export type EvidenceMethod =
  | "cached"
  | "website"
  | "metadata"
  | "json_ld"
  | "deterministic_extraction"
  | "api"
  | "manual"
  | "llm_extraction"
  | "llm_inference";

export type PageType =
  | "HOME"
  | "ABOUT"
  | "TEAM"
  | "PRODUCT"
  | "PRICING"
  | "CUSTOMERS"
  | "CAREERS"
  | "BLOG"
  | "PRESS"
  | "CONTACT"
  | "OTHER";

export type FactualField =
  | "name"
  | "website"
  | "description"
  | "hqLocation"
  | "country"
  | "employeeCount"
  | "founders"
  | "linkedinUrl"
  | "crunchbaseUrl"
  | "tracxnUrl";

export type Evidence<T = unknown> = {
  field: FactualField;
  value: T;
  sourceUrl: string;
  sourceType: "official_website" | "structured_provider" | "external_source" | "manual";
  retrievedAt: string;
  confidence: Confidence;
  method: EvidenceMethod;
  observed: boolean;
};

export type ParsedPage = {
  url: string;
  canonicalUrl: string | null;
  title: string | null;
  description: string | null;
  logo: string | null;
  pageType: PageType;
  headings: string[];
  paragraphs: string[];
  text: string;
  links: Array<{ url: string; text: string }>;
  jsonLd: unknown[];
  organization: Record<string, unknown> | null;
  contentHash: string;
};

export type CachedPage = {
  url: string;
  fetchedAt: string;
  expiresAt: string;
  etag?: string | null;
  lastModified?: string | null;
  parsed: ParsedPage;
};

export type FetchResult = {
  url: string;
  status: number;
  contentType: string;
  body: string;
  bytes: number;
  etag: string | null;
  lastModified: string | null;
  notModified: boolean;
};

export type CrawlConfig = {
  maxPages: number;
  maxDepth: number;
  maxResponseBytes: number;
  fetchTimeoutMs: number;
  maxRedirects: number;
  cacheTtlMs: number;
  userAgent: string;
};

export type CrawlTelemetry = {
  pagesFetched: number;
  pagesFromCache: number;
  fetchFailures: number;
  bytesDownloaded: number;
  durationMs: number;
};

export type CrawlResult = {
  pages: ParsedPage[];
  errors: Array<{ url: string; message: string }>;
  telemetry: CrawlTelemetry;
};

export type PageCache = {
  get(url: string): Promise<CachedPage | null>;
  set(page: CachedPage): Promise<void>;
};
