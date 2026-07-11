import crypto from "node:crypto";
import { AI_LIMITS, AI_MODELS, ENRICHMENT_REFRESH_POLICY, estimateCost } from "./config";
import { roughTokenCount } from "./usage";

export const ENRICHABLE_FIELDS = [
  "domain",
  "subdomain",
  "hq_location",
  "country",
  "funding_stage",
  "total_funding",
  "employee_count",
  "founders",
  "investors",
  "description",
  "website_summary",
  "linkedin_url",
  "crunchbase_url",
  "tracxn_url",
] as const;

export type EnrichableField = typeof ENRICHABLE_FIELDS[number];

type ExistingFieldState = {
  field_name: string;
  status: string;
  confidence: number | null;
  refresh_after: string | null;
  content_hash: string | null;
  last_checked_at: string | null;
};

export type SourceSnapshot = {
  url: string;
  normalizedUrl: string;
  text: string;
  contentHash: string;
  sectionHashes: Record<string, string>;
  httpStatus: number | null;
  fetchStatus: "fetched" | "unchanged" | "failed" | "empty";
  changed: boolean;
};

const FIELD_KEYWORDS: Record<EnrichableField, string[]> = {
  domain: ["industry", "sector", "market", "vertical"],
  subdomain: ["product", "platform", "solution", "specializes"],
  hq_location: ["headquarters", "based in", "office", "location"],
  country: ["headquarters", "based in", "country", "location"],
  funding_stage: ["funding", "seed", "series", "raised", "investment", "round"],
  total_funding: ["funding", "raised", "investment", "capital", "round"],
  employee_count: ["employees", "team size", "headcount", "people", "careers"],
  founders: ["founder", "co-founder", "leadership", "team", "ceo"],
  investors: ["investors", "backed by", "funded by", "investment"],
  description: ["about", "mission", "product", "platform", "solution"],
  website_summary: ["about", "mission", "product", "platform", "solution"],
  linkedin_url: ["linkedin"],
  crunchbase_url: ["crunchbase"],
  tracxn_url: ["tracxn"],
};

export function getFieldsDueForEnrichment(startup: any, states: ExistingFieldState[] = [], sourceChanged = false): EnrichableField[] {
  const byField = new Map(states.map((state) => [state.field_name, state]));
  const manual = new Set((startup.manual_fields ?? []).map((field: string) => toSnakeField(field)));
  const now = Date.now();

  return ENRICHABLE_FIELDS.filter((field) => {
    if (manual.has(field)) return false;
    const value = startup[field];
    const missing = value == null || value === "" || (Array.isArray(value) && value.length === 0);
    if (missing) return true;

    const state = byField.get(field);
    if (state?.status === "failed" && (!state.last_checked_at || Date.parse(state.last_checked_at) < now - 24 * 60 * 60 * 1000)) return true;
    if (state?.status === "manual_review") return false;

    const policy = ENRICHMENT_REFRESH_POLICY[field];
    if (policy === null) return false;
    if (policy === "on_source_change") return sourceChanged;

    const refreshAfter = state?.refresh_after ? Date.parse(state.refresh_after) : Date.parse(startup.last_enriched_at ?? startup.updated_at ?? "");
    if (!Number.isFinite(refreshAfter)) return true;
    return refreshAfter <= now;
  });
}

export async function fetchSourceSnapshot(db: any, startup: any): Promise<SourceSnapshot | null> {
  if (!startup.website) return null;
  const url = startup.website.startsWith("http") ? startup.website : `https://${startup.website}`;
  const normalizedUrl = normalizeUrl(url);
  const previous = await db
    .from("startup_enrichment_sources")
    .select("content_hash, section_hashes_json")
    .eq("startup_id", startup.id)
    .eq("normalized_url", normalizedUrl)
    .maybeSingle();

  try {
    const response = await fetch(url, { headers: { "user-agent": "StartupIntelBot/1.0", accept: "text/html,text/plain" } });
    const raw = response.ok ? await response.text() : "";
    const text = normalizeSourceContent(raw).slice(0, AI_LIMITS.maxSourceChars);
    const contentHash = sha256(text);
    const sections = extractSections(text);
    const sectionHashes = Object.fromEntries(Object.entries(sections).map(([key, value]) => [key, sha256(value)]));
    const previousHash = previous.data?.content_hash ?? null;
    const changed = Boolean(text) && previousHash !== contentHash;
    const snapshot: SourceSnapshot = {
      url,
      normalizedUrl,
      text,
      contentHash,
      sectionHashes,
      httpStatus: response.status,
      fetchStatus: text ? (changed ? "fetched" : "unchanged") : "empty",
      changed,
    };

    await db.from("startup_enrichment_sources").upsert({
      org_id: startup.org_id,
      startup_id: startup.id,
      source_url: url,
      normalized_url: normalizedUrl,
      source_type: "website",
      content_hash: contentHash,
      section_hashes_json: sectionHashes,
      last_fetched_at: new Date().toISOString(),
      last_changed_at: changed ? new Date().toISOString() : undefined,
      http_status: response.status,
      fetch_status: snapshot.fetchStatus,
      metadata_json: { textLength: text.length },
    }, { onConflict: "startup_id,normalized_url" });

    return snapshot;
  } catch {
    await db.from("startup_enrichment_sources").upsert({
      org_id: startup.org_id,
      startup_id: startup.id,
      source_url: url,
      normalized_url: normalizedUrl,
      source_type: "website",
      fetch_status: "failed",
      last_fetched_at: new Date().toISOString(),
    }, { onConflict: "startup_id,normalized_url" });
    return null;
  }
}

export function buildEnrichmentPrompt(startup: any, fields: EnrichableField[], source: SourceSnapshot | null) {
  const passages = selectRelevantPassages(source?.text ?? "", fields);
  return `Return only JSON. Extract only requested fields for this startup. Do not include explanations.

Requested fields: ${fields.join(", ")}

Startup identifiers:
${JSON.stringify({
  name: startup.name,
  website: startup.website,
  domain: startup.domain,
  location: startup.hq_location,
  fundingStage: startup.funding_stage,
  linkedinUrl: startup.linkedin_url,
  crunchbaseUrl: startup.crunchbase_url,
  tracxnUrl: startup.tracxn_url,
})}

Relevant source passages:
${passages || "No relevant first-party source passages available."}

Return this exact shape:
{
  "fields": {
    "field_name": {
      "value": "string, number, boolean, array, object, or null",
      "confidence": 0.0,
      "source_url": ${JSON.stringify(source?.url ?? startup.website ?? null)}
    }
  },
  "overall_confidence": 0.0,
  "conflicts": []
}`;
}

export function selectRelevantPassages(text: string, fields: EnrichableField[]) {
  if (!text) return "";
  const keywords = new Set(fields.flatMap((field) => FIELD_KEYWORDS[field] ?? []));
  const sentences = text.split(/(?<=[.!?])\s+/).filter((sentence) => sentence.length > 30);
  const ranked = sentences
    .map((sentence) => {
      const lower = sentence.toLowerCase();
      const score = Array.from(keywords).reduce((sum, keyword) => sum + (lower.includes(keyword) ? 1 : 0), 0);
      return { sentence, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.sentence);
  const selected = ranked.length ? ranked : sentences.slice(0, 12);
  return selected.join("\n").slice(0, AI_LIMITS.maxPassageChars);
}

export function normalizeExtractedFields(raw: any, requestedFields: EnrichableField[]) {
  const payload = raw?.fields && typeof raw.fields === "object" ? raw.fields : raw;
  const requested = new Set(requestedFields);
  const result: Partial<Record<EnrichableField, { value: unknown; confidence: number; sourceUrl: string | null }>> = {};

  for (const field of requested) {
    const entry = payload?.[field];
    const value = entry && typeof entry === "object" && "value" in entry ? entry.value : entry;
    if (value == null || value === "" || (Array.isArray(value) && value.length === 0)) continue;
    result[field] = {
      value,
      confidence: clampConfidence(Number(entry?.confidence ?? raw?.overall_confidence ?? 0.5)),
      sourceUrl: typeof entry?.source_url === "string" ? entry.source_url : null,
    };
  }

  return result;
}

export function nextRefreshAfter(field: EnrichableField) {
  const policy = ENRICHMENT_REFRESH_POLICY[field];
  if (policy === null || policy === "on_source_change") return null;
  return new Date(Date.now() + policy * 24 * 60 * 60 * 1000).toISOString();
}

export function createFieldMetadataRows(startup: any, fields: ReturnType<typeof normalizeExtractedFields>, source: SourceSnapshot | null, model: string, prompt: string, outputText: string) {
  const inputTokens = roughTokenCount(prompt);
  const outputTokens = roughTokenCount(outputText);
  return Object.entries(fields).map(([fieldName, entry]) => ({
    org_id: startup.org_id,
    startup_id: startup.id,
    field_name: fieldName,
    field_value_json: entry!.value,
    source_url: entry!.sourceUrl ?? source?.url ?? startup.website ?? null,
    source_type: source ? "website" : "model_search",
    confidence: entry!.confidence,
    status: entry!.confidence >= 0.45 ? "fresh" : "manual_review",
    last_checked_at: new Date().toISOString(),
    last_changed_at: new Date().toISOString(),
    refresh_after: nextRefreshAfter(fieldName as EnrichableField),
    content_hash: source?.contentHash ?? null,
    model_used: model,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    estimated_cost: estimateCost(model, inputTokens, outputTokens),
  }));
}

export function shouldEscalate(fields: ReturnType<typeof normalizeExtractedFields>) {
  const values = Object.values(fields);
  return values.length === 0 || values.some((entry) => entry.confidence < 0.55);
}

export function normalizeSourceContent(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/cookie policy|accept cookies|all rights reserved|copyright \d{4}/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\b20\d{2}\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildSearchDocument(startup: any) {
  return [
    startup.name,
    startup.website,
    startup.domain,
    startup.subdomain,
    startup.hq_location,
    startup.country,
    startup.funding_stage,
    startup.total_funding,
    startup.employee_count ? `${startup.employee_count} employees` : null,
    ...(startup.founders ?? []),
    ...(startup.investors ?? []),
    startup.description,
    startup.website_summary,
  ].filter(Boolean).join("\n").slice(0, 4000);
}

export function sha256(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function modelForExtraction(escalated = false) {
  return escalated ? AI_MODELS.escalationModel : AI_MODELS.extractionModel;
}

function extractSections(text: string) {
  const lower = text.toLowerCase();
  return {
    about: matchingWindow(text, lower, ["about", "mission", "platform", "solution"]),
    team: matchingWindow(text, lower, ["founder", "co-founder", "leadership", "team", "ceo"]),
    funding: matchingWindow(text, lower, ["funding", "raised", "investment", "seed", "series"]),
    product: matchingWindow(text, lower, ["product", "platform", "solution", "technology"]),
    careers: matchingWindow(text, lower, ["careers", "employees", "team size", "headcount"]),
  };
}

function matchingWindow(text: string, lower: string, terms: string[]) {
  const index = terms.map((term) => lower.indexOf(term)).find((position) => position >= 0) ?? -1;
  if (index < 0) return "";
  return text.slice(Math.max(0, index - 500), index + 1500);
}

function normalizeUrl(url: string) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.search = "";
    parsed.hostname = parsed.hostname.replace(/^www\./, "");
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return url.toLowerCase();
  }
}

function toSnakeField(field: string) {
  return field.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`);
}

function clampConfidence(value: number) {
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}
