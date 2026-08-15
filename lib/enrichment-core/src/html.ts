import crypto from "node:crypto";
import type { PageType, ParsedPage } from "./types";
import { normalizeUrl } from "./entity";

export function parseHtml(html: string, sourceUrl: string): ParsedPage {
  const withoutNoise = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|canvas|iframe|template)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(nav|footer)[^>]*>[\s\S]*?<\/\1>/gi, " ");
  const title = clean(firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i));
  const description = meta(html, "description") ?? propertyMeta(html, "og:description");
  const canonical = linkHref(html, "canonical");
  const headings = matches(withoutNoise, /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi).map(clean).filter(Boolean) as string[];
  const paragraphs = matches(withoutNoise, /<(?:p|li)[^>]*>([\s\S]*?)<\/(?:p|li)>/gi)
    .map(clean).filter((value): value is string => Boolean(value && value.length > 20)).slice(0, 250);
  const links = extractLinks(html, sourceUrl);
  const jsonLd = extractJsonLd(html);
  const organization = findTypedObject(jsonLd, ["organization", "corporation", "localbusiness"]);
  const logoValue = organization?.logo;
  const logo = absoluteUrl(
    typeof logoValue === "string" ? logoValue : objectString(logoValue, "url") ?? propertyMeta(html, "og:image"),
    sourceUrl,
  );
  const text = clean([title, ...headings, ...paragraphs].filter(Boolean).join("\n")) ?? "";
  const normalizedUrl = normalizeUrl(sourceUrl);
  return {
    url: normalizedUrl,
    canonicalUrl: absoluteUrl(canonical, sourceUrl),
    title,
    description: description ?? objectString(organization?.description),
    logo,
    pageType: classifyPage(normalizedUrl, title, headings),
    headings,
    paragraphs,
    text,
    links,
    jsonLd,
    organization,
    contentHash: crypto.createHash("sha256").update(text).digest("hex"),
  };
}

export function classifyPage(url: string, title: string | null, headings: string[]): PageType {
  const pathname = new URL(url).pathname.toLowerCase();
  if (pathname === "/" || pathname === "") return "HOME";
  const haystack = `${pathname} ${title ?? ""} ${headings.slice(0, 4).join(" ")}`.toLowerCase();
  const rules: Array<[PageType, RegExp]> = [
    ["TEAM", /\b(team|leadership|founders?)\b/], ["ABOUT", /\b(about|company|our story|mission)\b/],
    ["PRICING", /\b(pricing|plans?)\b/], ["CUSTOMERS", /\b(customers?|case studies|stories)\b/],
    ["CAREERS", /\b(careers?|jobs?|join us)\b/], ["PRESS", /\b(press|newsroom|media)\b/],
    ["BLOG", /\b(blog|articles?|resources?)\b/], ["CONTACT", /\b(contact|locations?)\b/],
    ["PRODUCT", /\b(products?|platform|solutions?|features?)\b/],
  ];
  return rules.find(([, pattern]) => pattern.test(haystack))?.[0] ?? "OTHER";
}

export function findTypedObject(values: unknown[], types: string[]): Record<string, unknown> | null {
  const wanted = new Set(types.map((value) => value.toLowerCase()));
  const visit = (value: unknown): Record<string, unknown> | null => {
    if (Array.isArray(value)) {
      for (const item of value) { const found = visit(item); if (found) return found; }
      return null;
    }
    if (!value || typeof value !== "object") return null;
    const object = value as Record<string, unknown>;
    const objectTypes = Array.isArray(object["@type"]) ? object["@type"] : [object["@type"]];
    if (objectTypes.some((type) => typeof type === "string" && wanted.has(type.toLowerCase()))) return object;
    for (const nested of Object.values(object)) { const found = visit(nested); if (found) return found; }
    return null;
  };
  return visit(values);
}

function extractJsonLd(html: string): unknown[] {
  const values: unknown[] = [];
  for (const raw of matches(html, /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { values.push(JSON.parse(raw.trim())); } catch { /* malformed external data is ignored */ }
  }
  return values;
}

function extractLinks(html: string, sourceUrl: string) {
  const result: Array<{ url: string; text: string }> = [];
  const pattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html))) {
    const url = absoluteUrl(match[1], sourceUrl);
    if (url?.startsWith("http")) result.push({ url, text: clean(match[2]) ?? "" });
  }
  return result.slice(0, 500);
}

function meta(html: string, name: string) { return metaValue(html, "name", name); }
function propertyMeta(html: string, name: string) { return metaValue(html, "property", name); }
function metaValue(html: string, attr: string, value: string) {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const a = firstMatch(html, new RegExp(`<meta[^>]*${attr}=["']${escaped}["'][^>]*content=["']([^"']*)["']`, "i"));
  const b = firstMatch(html, new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*${attr}=["']${escaped}["']`, "i"));
  return clean(a ?? b);
}
function linkHref(html: string, rel: string) {
  return firstMatch(html, new RegExp(`<link[^>]*rel=["'][^"']*${rel}[^"']*["'][^>]*href=["']([^"']+)["']`, "i"));
}
function matches(value: string, pattern: RegExp) { const result: string[] = []; let match: RegExpExecArray | null; while ((match = pattern.exec(value))) result.push(match[1] ?? ""); return result; }
function firstMatch(value: string, pattern: RegExp) { return value.match(pattern)?.[1] ?? null; }
function clean(value: string | null | undefined) { if (!value) return null; return decodeEntities(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).trim() || null; }
function decodeEntities(value: string) { return value.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))); }
function absoluteUrl(value: string | null | undefined, base: string) { if (!value) return null; try { return normalizeUrl(new URL(value, base).toString()); } catch { return null; } }
function objectString(value: unknown, key?: string): string | null { if (typeof value === "string") return value; if (key && value && typeof value === "object") return objectString((value as Record<string, unknown>)[key]); return null; }
