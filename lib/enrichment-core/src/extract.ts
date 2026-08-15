import type { Evidence, FactualField, ParsedPage } from "./types";
import { normalizeUrl } from "./entity";

export function extractFacts(pages: ParsedPage[]): Evidence[] {
  const facts: Evidence[] = [];
  for (const page of pages) {
    const org = page.organization;
    if (org) {
      add(facts, "name", stringValue(org.name), page, "json_ld", "HIGH");
      add(facts, "description", stringValue(org.description), page, "json_ld", "HIGH");
      add(facts, "website", stringValue(org.url) ?? page.canonicalUrl, page, "json_ld", "HIGH");
      const address = addressValue(org.address);
      add(facts, "hqLocation", address.location, page, "json_ld", "HIGH");
      add(facts, "country", address.country, page, "json_ld", "HIGH");
      add(facts, "employeeCount", numericValue(org.numberOfEmployees), page, "json_ld", "MEDIUM");
      const founders = peopleValue(org.founder ?? org.founders);
      add(facts, "founders", founders.length ? founders : null, page, "json_ld", "HIGH");
      for (const sameAs of arrayValue(org.sameAs)) addSocial(facts, sameAs, page, "json_ld", "HIGH");
    }
    if (page.pageType === "HOME") {
      add(facts, "description", page.description, page, "metadata", "HIGH");
      add(facts, "website", page.canonicalUrl ?? page.url, page, "metadata", "HIGH");
    }
    for (const link of page.links) addSocial(facts, link.url, page, "deterministic_extraction", "MEDIUM");
  }
  return deduplicate(facts);
}

export function reconcileFacts(evidence: Evidence[], manualFields: Iterable<string> = []) {
  const manual = new Set(manualFields);
  const byField = new Map<FactualField, Evidence[]>();
  for (const item of evidence) {
    if (manual.has(item.field) || manual.has(toSnake(item.field))) continue;
    byField.set(item.field, [...(byField.get(item.field) ?? []), item]);
  }
  const values: Partial<Record<FactualField, unknown>> = {};
  const selected: Evidence[] = [];
  const conflicts: Array<{ field: FactualField; values: unknown[] }> = [];
  for (const [field, items] of byField) {
    items.sort((a, b) => priority(b) - priority(a));
    const winner = items[0]!;
    values[field] = winner.value;
    selected.push(winner);
    const distinct = [...new Set(items.map((item) => JSON.stringify(item.value)))];
    if (distinct.length > 1 && priority(items[1]!) === priority(winner)) conflicts.push({ field, values: distinct.map((value) => JSON.parse(value)) });
  }
  return { values, selected, conflicts };
}

function add(facts: Evidence[], field: FactualField, value: unknown, page: ParsedPage, method: Evidence["method"], confidence: Evidence["confidence"]) {
  if (value == null || value === "" || (Array.isArray(value) && !value.length)) return;
  facts.push({ field, value, sourceUrl: page.url, sourceType: "official_website", retrievedAt: new Date().toISOString(), confidence, method, observed: true });
}
function addSocial(facts: Evidence[], url: string, page: ParsedPage, method: Evidence["method"], confidence: Evidence["confidence"]) {
  const field = /(^|\.)linkedin\.com$/i.test(safeHostname(url)) ? "linkedinUrl"
    : /(^|\.)crunchbase\.com$/i.test(safeHostname(url)) ? "crunchbaseUrl"
      : /(^|\.)tracxn\.com$/i.test(safeHostname(url)) ? "tracxnUrl" : null;
  if (field) add(facts, field, normalizeUrl(url), page, method, confidence);
}
function priority(item: Evidence) { const source = { manual: 500, official_website: 400, structured_provider: 300, external_source: 200 }[item.sourceType]; const method = item.method === "json_ld" ? 30 : item.method === "metadata" ? 20 : 10; const confidence = { HIGH: 3, MEDIUM: 2, LOW: 1 }[item.confidence]; return source + method + confidence; }
function deduplicate(items: Evidence[]) { const seen = new Set<string>(); return items.filter((item) => { const key = `${item.field}:${JSON.stringify(item.value)}:${item.sourceUrl}`; if (seen.has(key)) return false; seen.add(key); return true; }); }
function stringValue(value: unknown) { return typeof value === "string" && value.trim() ? value.trim() : null; }
function numericValue(value: unknown): number | null { if (typeof value === "number" && Number.isFinite(value)) return Math.round(value); if (typeof value === "string") { const parsed = Number(value.replace(/,/g, "")); return Number.isFinite(parsed) ? Math.round(parsed) : null; } if (value && typeof value === "object") return numericValue((value as Record<string, unknown>).value); return null; }
function peopleValue(value: unknown): string[] { return arrayValue(value).map((item) => typeof item === "string" ? item : item && typeof item === "object" ? stringValue((item as Record<string, unknown>).name) : null).filter((item): item is string => Boolean(item)); }
function arrayValue(value: unknown): any[] { return value == null ? [] : Array.isArray(value) ? value : [value]; }
function addressValue(value: unknown) { const object = Array.isArray(value) ? value[0] : value; if (!object || typeof object !== "object") return { location: null, country: null }; const row = object as Record<string, unknown>; const country = typeof row.addressCountry === "object" ? stringValue((row.addressCountry as Record<string, unknown>).name) : stringValue(row.addressCountry); const location = [row.streetAddress, row.addressLocality, row.addressRegion, country].map(stringValue).filter(Boolean).join(", ") || null; return { location, country }; }
function safeHostname(value: string) { try { return new URL(value).hostname; } catch { return ""; } }
function toSnake(value: string) { return value.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`); }
