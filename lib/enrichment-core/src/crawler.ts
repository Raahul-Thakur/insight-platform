import { assertPublicHttpUrl } from "./security";
import { normalizeUrl } from "./entity";
import { parseHtml } from "./html";
import type { CachedPage, CrawlConfig, CrawlResult, FetchResult, PageCache, ParsedPage } from "./types";

export const DEFAULT_CRAWL_CONFIG: CrawlConfig = {
  maxPages: envNumber("ENRICHMENT_MAX_PAGES", 6, 1, 20),
  maxDepth: envNumber("ENRICHMENT_MAX_DEPTH", 1, 0, 3),
  maxResponseBytes: envNumber("ENRICHMENT_MAX_RESPONSE_BYTES", 1_500_000, 10_000, 5_000_000),
  fetchTimeoutMs: envNumber("ENRICHMENT_FETCH_TIMEOUT_MS", 10_000, 1_000, 30_000),
  maxRedirects: envNumber("ENRICHMENT_MAX_REDIRECTS", 4, 0, 8),
  cacheTtlMs: envNumber("ENRICHMENT_PAGE_CACHE_TTL_MS", 7 * 24 * 60 * 60 * 1000, 60_000, 365 * 24 * 60 * 60 * 1000),
  userAgent: process.env.ENRICHMENT_USER_AGENT ?? "StartupIntelBot/2.0 (+factual-enrichment)",
};

export async function crawlCompanyWebsite(startUrl: string, cache: PageCache, overrides: Partial<CrawlConfig> = {}): Promise<CrawlResult> {
  const config = { ...DEFAULT_CRAWL_CONFIG, ...overrides };
  const started = Date.now();
  const root = await assertPublicHttpUrl(normalizeUrl(startUrl));
  const origin = root.origin;
  const queue: Array<{ url: string; depth: number; score: number }> = [{ url: root.toString(), depth: 0, score: 1000 }];
  const visited = new Set<string>();
  const pages: ParsedPage[] = [];
  const errors: Array<{ url: string; message: string }> = [];
  const telemetry = { pagesFetched: 0, pagesFromCache: 0, fetchFailures: 0, bytesDownloaded: 0, durationMs: 0 };
  let robots: string[] | null = null;

  while (queue.length && pages.length < config.maxPages) {
    queue.sort((a, b) => b.score - a.score);
    const item = queue.shift()!;
    const url = normalizeUrl(item.url);
    if (visited.has(url)) continue;
    visited.add(url);
    try {
      const cached = await cache.get(url);
      if (cached && Date.parse(cached.expiresAt) > Date.now()) {
        pages.push(cached.parsed);
        telemetry.pagesFromCache += 1;
        enqueueLinks(cached.parsed, item.depth, origin, config, queue, visited);
        continue;
      }
      robots ??= await readRobots(origin, config).catch(() => [] as string[]);
      if (disallowedByRobots(new URL(url).pathname, robots)) continue;
      const fetched = await fetchText(url, config, cached);
      if (fetched.notModified && cached) {
        const refreshed = { ...cached, fetchedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + config.cacheTtlMs).toISOString() };
        await cache.set(refreshed);
        pages.push(cached.parsed);
        telemetry.pagesFromCache += 1;
        enqueueLinks(cached.parsed, item.depth, origin, config, queue, visited);
        continue;
      }
      telemetry.pagesFetched += 1;
      telemetry.bytesDownloaded += fetched.bytes;
      const parsed = parseHtml(fetched.body, fetched.url);
      const entry: CachedPage = { url: fetched.url, parsed, etag: fetched.etag, lastModified: fetched.lastModified, fetchedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + config.cacheTtlMs).toISOString() };
      await cache.set(entry);
      if (normalizeUrl(url) !== normalizeUrl(fetched.url)) await cache.set({ ...entry, url });
      pages.push(parsed);
      enqueueLinks(parsed, item.depth, origin, config, queue, visited);
    } catch (error) {
      telemetry.fetchFailures += 1;
      errors.push({ url, message: error instanceof Error ? error.message : String(error) });
    }
  }
  telemetry.durationMs = Date.now() - started;
  return { pages, errors, telemetry };
}

export async function fetchText(input: string, config: CrawlConfig = DEFAULT_CRAWL_CONFIG, cached?: CachedPage | null): Promise<FetchResult> {
  let url = await assertPublicHttpUrl(input);
  const headers: Record<string, string> = { accept: "text/html,application/xhtml+xml,text/plain;q=0.8", "user-agent": config.userAgent };
  if (cached?.etag) headers["if-none-match"] = cached.etag;
  if (cached?.lastModified) headers["if-modified-since"] = cached.lastModified;
  for (let redirect = 0; redirect <= config.maxRedirects; redirect += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.fetchTimeoutMs);
    let response: Response;
    try { response = await fetch(url, { headers, redirect: "manual", signal: controller.signal }); } finally { clearTimeout(timeout); }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || redirect === config.maxRedirects) throw new Error("Redirect limit exceeded");
      url = await assertPublicHttpUrl(new URL(location, url).toString());
      continue;
    }
    if (response.status === 304) return result(url, response, "", 0, true);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.startsWith("text/html") && !contentType.startsWith("application/xhtml+xml") && !contentType.startsWith("text/plain")) throw new Error(`Unsupported content type: ${contentType || "unknown"}`);
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > config.maxResponseBytes) throw new Error("Response exceeds size limit");
    const reader = response.body?.getReader();
    if (!reader) return result(url, response, "", 0, false);
    const chunks: Uint8Array[] = []; let bytes = 0;
    while (true) { const { done, value } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > config.maxResponseBytes) { await reader.cancel(); throw new Error("Response exceeds size limit"); } chunks.push(value); }
    const body = new TextDecoder("utf-8", { fatal: false }).decode(concat(chunks, bytes));
    return result(url, response, body, bytes, false);
  }
  throw new Error("Redirect limit exceeded");
}

function enqueueLinks(page: ParsedPage, depth: number, origin: string, config: CrawlConfig, queue: Array<{ url: string; depth: number; score: number }>, visited: Set<string>) {
  if (depth >= config.maxDepth) return;
  for (const link of page.links) { try { const url = new URL(link.url); if (url.origin !== origin || visited.has(normalizeUrl(url.toString())) || binaryPath(url.pathname)) continue; const score = linkScore(url.pathname, link.text); if (score > 0) queue.push({ url: url.toString(), depth: depth + 1, score }); } catch { /* ignore malformed links */ } }
}
function linkScore(path: string, text: string) { const value = `${path} ${text}`.toLowerCase(); const rules: Array<[RegExp, number]> = [[/\b(about|company|our-story)\b/, 100], [/\b(team|leadership|founders?)\b/, 95], [/\b(product|platform|solutions?|features?)\b/, 90], [/\b(pricing|plans?)\b/, 85], [/\b(customers?|case-studies)\b/, 75], [/\b(careers?|jobs?)\b/, 70], [/\b(contact|locations?)\b/, 60], [/\b(press|newsroom)\b/, 50]]; return rules.find(([pattern]) => pattern.test(value))?.[1] ?? 0; }
function binaryPath(path: string) { return /\.(?:png|jpe?g|gif|webp|svg|ico|pdf|zip|gz|mp4|mp3|woff2?|ttf|eot)$/i.test(path); }
async function readRobots(origin: string, config: CrawlConfig) { const robotsConfig = { ...config, maxResponseBytes: Math.min(config.maxResponseBytes, 200_000), maxRedirects: 2 }; const response = await fetchText(`${origin}/robots.txt`, robotsConfig); return response.body.split(/\r?\n/).map((line) => line.match(/^\s*disallow\s*:\s*(\S+)/i)?.[1]).filter((value): value is string => Boolean(value)); }
function disallowedByRobots(path: string, rules: string[]) { return rules.some((rule) => rule !== "/" && path.startsWith(rule)) || rules.includes("/"); }
function concat(chunks: Uint8Array[], total: number) { const output = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; } return output; }
function result(url: URL, response: Response, body: string, bytes: number, notModified: boolean): FetchResult { return { url: normalizeUrl(url.toString()), status: response.status, contentType: response.headers.get("content-type") ?? "", body, bytes, etag: response.headers.get("etag"), lastModified: response.headers.get("last-modified"), notModified }; }
function envNumber(name: string, fallback: number, min: number, max: number) { const value = Number(process.env[name] ?? fallback); return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback; }
