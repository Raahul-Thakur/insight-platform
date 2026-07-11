import crypto from "node:crypto";
import { AI_LIMITS } from "./config";
import { sha256 } from "./enrichment";

export type RouteType = "direct_lookup" | "structured_query" | "aggregate_query" | "semantic_search" | "hybrid_search" | "comparison" | "general_help" | "unsupported";

export type QueryRoute = {
  route: RouteType;
  operation: "count" | "list" | "missing_fields" | "search" | "compare";
  filters: {
    domain: string | null;
    fundingStage: string | null;
    location: string | null;
    country: string | null;
    keyword: string | null;
    employeeCountMin: number | null;
    employeeCountMax: number | null;
    investor: string | null;
  };
  limit: number;
  requiresLlmResponse: boolean;
};

export function routeStartupQuery(query: string): QueryRoute {
  const q = query.toLowerCase();
  const filters = parseFilters(query);
  const asksCount = /\b(how many|count|number of)\b/.test(q);
  const asksList = /\b(list|show|export|sort)\b/.test(q);
  const missing = /\bmissing fields?|incomplete|needs enrichment\b/.test(q);
  const comparison = /\b(compare|versus| vs\.? )\b/.test(q);
  const structured = hasStructuredFilters(filters);
  const semantic = !structured || /\b(find|search|similar|working on|using|reducing|improve|building)\b/.test(q);

  if (missing) return { route: "direct_lookup", operation: "missing_fields", filters, limit: 50, requiresLlmResponse: false };
  if (asksCount) return { route: "aggregate_query", operation: "count", filters, limit: 1, requiresLlmResponse: false };
  if (comparison) return { route: "comparison", operation: "compare", filters, limit: 10, requiresLlmResponse: true };
  if (structured && semantic && !asksList) return { route: "hybrid_search", operation: "search", filters, limit: AI_LIMITS.maxRetrievedStartups, requiresLlmResponse: false };
  if (structured) return { route: "structured_query", operation: "list", filters, limit: 50, requiresLlmResponse: false };
  return { route: "semantic_search", operation: "search", filters, limit: AI_LIMITS.maxRetrievedStartups, requiresLlmResponse: false };
}

export function createCacheHash(parts: { orgId: string; normalizedQuery: string; filters: unknown; datasetVersion: number; route: string; permissionScope?: string }) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({
      orgId: parts.orgId,
      normalizedQuery: parts.normalizedQuery,
      filters: parts.filters,
      datasetVersion: parts.datasetVersion,
      route: parts.route,
      permissionScope: parts.permissionScope ?? "default",
    }))
    .digest("hex");
}

export function normalizeQuestion(query: string) {
  return query.toLowerCase().replace(/\s+/g, " ").trim();
}

export function buildCompactConversationState(messages: Array<{ role?: string; content?: string }> = []) {
  const recent = messages.slice(-AI_LIMITS.recentMessages).map((message) => ({
    role: message.role === "assistant" ? "assistant" : "user",
    content: String(message.content ?? "").slice(0, 1000),
  }));
  const older = messages.slice(0, Math.max(0, messages.length - AI_LIMITS.recentMessages));
  return {
    recentMessages: recent,
    summary: older.length ? sha256(older.map((message) => message.content ?? "").join("\n")) : null,
    state: {
      active_filters: {},
      selected_startup_ids: [],
      current_sort: null,
      current_comparison: false,
      last_route: null,
    },
  };
}

export function compactStartupEvidence(rows: any[]) {
  return rows.slice(0, AI_LIMITS.maxStartupsSentToModel).map((row) => ({
    id: row.id,
    name: row.name,
    domain: row.domain,
    country: row.country,
    fundingStage: row.funding_stage,
    employeeCount: row.employee_count,
    description: truncate(row.description ?? row.website_summary ?? "", 280),
    lastUpdated: row.updated_at,
    confidence: row.confidence_score,
  }));
}

export function startupSearchText(row: any) {
  return [row.name, row.website, row.domain, row.subdomain, row.hq_location, row.country, row.funding_stage, row.total_funding, row.description, row.website_summary, ...(row.founders ?? []), ...(row.investors ?? [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function hasStructuredFilters(filters: QueryRoute["filters"]) {
  return Boolean(filters.domain || filters.fundingStage || filters.location || filters.country || filters.employeeCountMin != null || filters.employeeCountMax != null || filters.investor);
}

function parseFilters(query: string): QueryRoute["filters"] {
  const q = query.toLowerCase();
  const fundingStage = ["pre-seed", "seed", "series a", "series b", "series c", "bootstrapped"].find((stage) => q.includes(stage));
  const domainMap: Record<string, string> = {
    fintech: "Fintech",
    ai: "AI",
    "climate tech": "Climate",
    cleantech: "CleanTech",
    healthtech: "HealthTech",
    "health tech": "HealthTech",
    saas: "SaaS",
    agriculture: "Agriculture",
    agritech: "AgriTech",
  };
  const country = ["india", "usa", "united states", "uk", "singapore"].find((value) => q.includes(value));
  const location = ["hyderabad", "bangalore", "bengaluru", "mumbai", "delhi", "chennai", "pune"].find((city) => q.includes(city));
  const emp = q.match(/(\d+)\s*(?:-|to)\s*(\d+)\s*(employees?|people|team)/);
  const investor = q.match(/(?:investor|investors|backed by|funded by)\s+([a-z0-9 .&-]+)/i)?.[1]?.trim() ?? null;

  return {
    domain: Object.entries(domainMap).find(([key]) => q.includes(key))?.[1] ?? null,
    fundingStage: fundingStage ? titleCase(fundingStage) : null,
    location: location ? titleCase(location) : null,
    country: country ? normalizeCountry(country) : null,
    keyword: null,
    employeeCountMin: emp ? Number(emp[1]) : null,
    employeeCountMax: emp ? Number(emp[2]) : null,
    investor,
  };
}

function titleCase(value: string) {
  return value.split(" ").map((word) => word[0]!.toUpperCase() + word.slice(1)).join(" ");
}

function normalizeCountry(country: string) {
  if (country === "usa" || country === "united states") return "United States";
  if (country === "uk") return "United Kingdom";
  return titleCase(country);
}

function truncate(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}
